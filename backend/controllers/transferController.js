import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import { getCycleString } from '../utils/cycleHelper.js';

// Graceful transaction runner that falls back to standard execution if replica sets are not configured
async function executeTransaction(callback) {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    const isTransUnsupported = 
      error.message && 
      (error.message.includes('replica set') || 
       error.message.includes('transaction') || 
       error.message.includes('Session'));
       
    if (isTransUnsupported) {
      console.warn('MongoDB Transactions not supported in this environment. Running operations sequentially.');
      return await callback(null);
    }
    if (session) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
}

/**
 * Handles physical/virtual inter-bank transfers (Bank A <-> Bank B).
 */
export async function bankToBankTransfer(req, res) {
  try {
    const { amount, sourceAccountId, destinationAccountId, sourceBucketId, destinationBucketId } = req.body;

    if (!amount || !sourceAccountId || !destinationAccountId) {
      return res.status(400).json({ error: 'Missing required transfer fields: amount, sourceAccountId, destinationAccountId' });
    }

    const txAmount = Number(amount);
    if (isNaN(txAmount) || txAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    if (sourceAccountId === destinationAccountId) {
      return res.status(400).json({ error: 'Source and destination accounts must be different' });
    }

    const today = new Date();
    const cycleStr = getCycleString(today);

    const result = await executeTransaction(async (session) => {
      const opts = session ? { session } : {};

      const sourceAcc = await Account.findById(sourceAccountId).session(session);
      const destAcc = await Account.findById(destinationAccountId).session(session);

      if (!sourceAcc || !destAcc) {
        throw new Error('One or both physical accounts not found');
      }

      if (sourceAcc.balance < txAmount) {
        throw new Error(`Insufficient funds in source account: ${sourceAcc.name}. Available: ${sourceAcc.balance}`);
      }

      // Fetch Source Bucket
      let sourceBucket = null;
      if (sourceBucketId) {
        sourceBucket = await Category.findById(sourceBucketId).session(session);
      } else {
        if (sourceAcc.type === 'INCOME_VAULT') {
          sourceBucket = await Category.findOne({ systemRole: 'b1_free_spend' }).session(session);
        } else {
          sourceBucket = await Category.findOne({ systemRole: 'b2_free_spend' }).session(session);
        }
      }

      // Fetch Destination Bucket
      let destBucket = null;
      if (destinationBucketId) {
        destBucket = await Category.findById(destinationBucketId).session(session);
      } else {
        if (destAcc.type === 'INCOME_VAULT') {
          destBucket = await Category.findOne({ systemRole: 'b1_free_spend' }).session(session);
        } else {
          destBucket = await Category.findOne({ systemRole: 'b2_free_spend' }).session(session);
        }
      }

      if (!sourceBucket || !destBucket) {
        throw new Error('Associated virtual buckets not found for transfer');
      }

      if (sourceBucket.currentAllocatedBalance < txAmount) {
        throw new Error(`Insufficient funds in source bucket: ${sourceBucket.name}. Available: ${sourceBucket.currentAllocatedBalance}`);
      }

      // Update balances
      sourceAcc.balance -= txAmount;
      destAcc.balance += txAmount;

      await sourceAcc.save(opts);
      await destAcc.save(opts);

      // Update virtual bucket balances
      sourceBucket.currentAllocatedBalance -= txAmount;
      destBucket.currentAllocatedBalance += txAmount;

      await sourceBucket.save(opts);
      await destBucket.save(opts);

      // Create transaction log (REAL_TRANSFER/VIRTUAL_TRANSFER depending on model definitions, we will label it 'TRANSFER')
      const newTx = new Transaction({
        title: `Inter-Bank Transfer: ${sourceAcc.name} (${sourceBucket.name}) to ${destAcc.name} (${destBucket.name})`,
        amount: txAmount,
        type: 'TRANSFER', // satisfies enum requirement ('INCOME' | 'EXPENSE' | 'TRANSFER')
        sourceCategory: sourceBucket._id,
        destCategory: destBucket._id,
        sourceAccount: sourceAcc._id,
        destAccount: destAcc._id,
        // duplicate tracking for SRD
        sourceBucketId: sourceBucket._id,
        destinationBucketId: destBucket._id,
        sourceAccountId: sourceAcc._id,
        destinationAccountId: destAcc._id,
        date: today,
        timestamp: today,
        cycleString: cycleStr,
        billingCycle: cycleStr
      });

      await newTx.save(opts);

      return {
        transaction: newTx,
        sourceAccount: sourceAcc,
        destAccount: destAcc,
        sourceBucket,
        destBucket
      };
    });

    res.json({
      message: 'Bank-to-bank transfer executed successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
