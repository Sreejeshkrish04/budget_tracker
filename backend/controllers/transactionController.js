import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Category from '../models/Category.js';
import Account from '../models/Account.js';
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
 * Gets transactions for a given cycle.
 */
export async function getTransactions(req, res) {
  try {
    const { cycleString } = req.query;
    if (!cycleString) {
      return res.status(400).json({ error: 'cycleString query parameter is required' });
    }

    const transactions = await Transaction.find({ cycleString })
      .populate('sourceCategory destCategory sourceAccount destAccount')
      .sort({ date: -1 });

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Posts a transaction (INCOME, EXPENSE, TRANSFER).
 */
export async function postTransaction(req, res) {
  try {
    console.log("Received Body:", req.body);
    const { title, amount, type, date } = req.body;
    const sourceCategory = req.body.sourceCategoryId || req.body.sourceCategory;
    const destCategory = req.body.destinationCategoryId || req.body.destCategory;

    if (!title || !amount || !type || !date) {
      return res.status(400).json({ error: 'Missing required transaction fields: title, amount, type, date' });
    }

    const txAmount = Number(amount);
    if (isNaN(txAmount) || txAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const calculatedCycle = getCycleString(date);

    const result = await executeTransaction(async (session) => {
      const opts = session ? { session } : {};

      let srcCat = null;
      let dstCat = null;
      let srcAcc = null;
      let dstAcc = null;

      // 1. Process EXPENSE
      if (type === 'EXPENSE') {
        if (!sourceCategory) {
          throw new Error('sourceCategory is required for EXPENSE transactions');
        }

        srcCat = await Category.findById(sourceCategory).populate('parentAccount').session(session);
        if (!srcCat) {
          throw new Error('Source Category not found');
        }

        if (srcCat.currentAllocatedBalance < txAmount) {
          throw new Error(`Insufficient funds in bucket: ${srcCat.name}. Available: ${srcCat.currentAllocatedBalance}`);
        }

        // Deduct from Category
        srcCat.currentAllocatedBalance -= txAmount;
        await srcCat.save(opts);

        // If it is a sub-bucket under Cumulative Savings, deduct from parent Cumulative Savings as well
        if (srcCat.isSubBucket && srcCat.subBucketParent) {
          const parentCat = await Category.findById(srcCat.subBucketParent).session(session);
          if (parentCat) {
            parentCat.currentAllocatedBalance -= txAmount;
            await parentCat.save(opts);
          }
        }

        // Deduct from Physical Account
        if (srcCat.parentAccount) {
          srcAcc = srcCat.parentAccount;
          srcAcc.balance -= txAmount;
          await srcAcc.save(opts);
        }

        // Load destination expense category if provided
        if (destCategory) {
          dstCat = await Category.findById(destCategory).session(session);
          if (!dstCat) {
            throw new Error('Destination Category not found');
          }
          // Increment spent tracker on the external category
          dstCat.spent = (dstCat.spent || 0) + txAmount;
          await dstCat.save(opts);
        }

      // 2. Process INCOME
      } else if (type === 'INCOME') {
        if (!destCategory) {
          throw new Error('destCategory is required for INCOME transactions');
        }

        dstCat = await Category.findById(destCategory).populate('parentAccount').session(session);
        if (!dstCat) {
          throw new Error('Destination Category not found');
        }

        // Add to Category
        dstCat.currentAllocatedBalance += txAmount;
        await dstCat.save(opts);

        // Add to Physical Account
        if (dstCat.parentAccount) {
          dstAcc = dstCat.parentAccount;
          dstAcc.balance += txAmount;
          await dstAcc.save(opts);
        }

      // 3. Process TRANSFER (Virtual/Category-to-Category Transfer)
      } else if (type === 'TRANSFER') {
        if (!sourceCategory || !destCategory) {
          throw new Error('Both sourceCategory and destCategory are required for TRANSFER transactions');
        }

        srcCat = await Category.findById(sourceCategory).populate('parentAccount').session(session);
        dstCat = await Category.findById(destCategory).populate('parentAccount').session(session);

        if (!srcCat || !dstCat) {
          throw new Error('Source or Destination Category not found');
        }

        if (srcCat.currentAllocatedBalance < txAmount) {
          throw new Error(`Insufficient funds in source bucket: ${srcCat.name}. Available: ${srcCat.currentAllocatedBalance}`);
        }

        // Deduct from source category
        srcCat.currentAllocatedBalance -= txAmount;
        await srcCat.save(opts);

        // Add to destination category
        dstCat.currentAllocatedBalance += txAmount;
        await dstCat.save(opts);

        // Handle sub-bucket parent sync if either category is sub-bucket
        if (srcCat.isSubBucket && srcCat.subBucketParent) {
          const parentCat = await Category.findById(srcCat.subBucketParent).session(session);
          if (parentCat) {
            parentCat.currentAllocatedBalance -= txAmount;
            await parentCat.save(opts);
          }
        }
        if (dstCat.isSubBucket && dstCat.subBucketParent) {
          const parentCat = await Category.findById(dstCat.subBucketParent).session(session);
          if (parentCat) {
            parentCat.currentAllocatedBalance += txAmount;
            await parentCat.save(opts);
          }
        }

        // Adjust parent physical accounts if they differ
        const srcAccIdStr = srcCat.parentAccount ? srcCat.parentAccount._id.toString() : null;
        const dstAccIdStr = dstCat.parentAccount ? dstCat.parentAccount._id.toString() : null;

        if (srcAccIdStr && dstAccIdStr && srcAccIdStr !== dstAccIdStr) {
          srcAcc = srcCat.parentAccount;
          dstAcc = dstCat.parentAccount;

          srcAcc.balance -= txAmount;
          dstAcc.balance += txAmount;

          await srcAcc.save(opts);
          await dstAcc.save(opts);
        }
      }

      // Create new transaction document
      const newTx = new Transaction({
        title,
        amount: txAmount,
        type,
        sourceCategory: srcCat ? srcCat._id : null,
        destCategory: dstCat ? dstCat._id : null,
        sourceAccount: srcAcc ? srcAcc._id : null,
        destAccount: dstAcc ? dstAcc._id : null,
        date: new Date(date),
        cycleString: calculatedCycle,
        // Sync fields for duplicate configurations
        sourceBucketId: srcCat ? srcCat._id : null,
        destinationBucketId: dstCat ? dstCat._id : null,
        sourceAccountId: srcAcc ? srcAcc._id : null,
        destinationAccountId: dstAcc ? dstAcc._id : null,
        timestamp: new Date(date),
        billingCycle: calculatedCycle
      });

      await newTx.save(opts);
      return newTx;
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
