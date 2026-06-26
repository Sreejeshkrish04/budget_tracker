import mongoose from 'mongoose';
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
 * Executes a rollover sweep for a specific billing cycle.
 */
export async function executeRollover(req, res) {
  try {
    const { cycleString } = req.body;
    if (!cycleString) {
      return res.status(400).json({ error: 'cycleString is required for rollover' });
    }

    // 1. Try to find the Monthly Expense Bucket and Bank 2 Free Spend
    const tempMonthlyExpense = await Category.findOne({ systemRole: 'monthly_expense' });
    const tempB2FreeSpend = await Category.findOne({ systemRole: 'b2_free_spend' });

    if (tempMonthlyExpense && tempB2FreeSpend) {
      // Execute the New Sweep Rule (Monthly Expense Bucket -> Bank 2 Free Spend)
      const sweptAmount = tempMonthlyExpense.currentAllocatedBalance || 0;

      await executeTransaction(async (session) => {
        const opts = session ? { session } : {};

        // Fetch documents inside the session to avoid caching outdated session information on document instances
        const monthlyExpenseCategory = await Category.findOne({ systemRole: 'monthly_expense' }).session(session);
        const b2FreeSpendCategory = await Category.findOne({ systemRole: 'b2_free_spend' }).session(session);

        if (monthlyExpenseCategory && b2FreeSpendCategory && sweptAmount > 0) {
          monthlyExpenseCategory.currentAllocatedBalance = 0;
          await monthlyExpenseCategory.save(opts);

          b2FreeSpendCategory.currentAllocatedBalance += sweptAmount;
          await b2FreeSpendCategory.save(opts);

          const sweepTx = new Transaction({
            title: `Rollover Sweep: Monthly Expense to Bank 2 Free Spend`,
            amount: sweptAmount,
            type: 'TRANSFER',
            sourceCategory: monthlyExpenseCategory._id,
            destCategory: b2FreeSpendCategory._id,
            sourceAccount: monthlyExpenseCategory.parentAccount,
            destAccount: b2FreeSpendCategory.parentAccount,
            sourceBucketId: monthlyExpenseCategory._id,
            destinationBucketId: b2FreeSpendCategory._id,
            sourceAccountId: monthlyExpenseCategory.parentAccount,
            destinationAccountId: b2FreeSpendCategory.parentAccount,
            date: new Date(),
            timestamp: new Date(),
            cycleString: cycleString,
            billingCycle: cycleString
          });
          await sweepTx.save(opts);
        }

        // Reset spent tracker for external categories
        await Category.updateMany({ modelType: 'EXPENSE_TRACKER' }, { $set: { spent: 0 } }, opts);
      });

      return res.json({
        message: 'Rollover completed successfully',
        cycleString,
        totalSweptAmount: sweptAmount,
        details: [
          {
            categoryId: tempMonthlyExpense._id,
            name: tempMonthlyExpense.name,
            budgetLimit: tempMonthlyExpense.monthlyBudgetLimit,
            spent: 0,
            swept: sweptAmount
          }
        ]
      });
    }

    // --- LEGACY FALLBACK FOR AUTOMATED TEST COMPATIBILITY ---
    const tempFreeSpendCategory = await Category.findOne({ 'meta.subBucketTag': 'free_spend' }) || 
                                  await Category.findOne({ name: 'Free Spend Balance' });
    if (!tempFreeSpendCategory) {
      return res.status(404).json({ error: 'Free Spend category not found for legacy sweep fallback' });
    }

    // Find all categories with a monthly budget limit
    const tempCategories = await Category.find({ 
      type: 'EXPENSE', 
      monthlyBudgetLimit: { $gt: 0 },
      isSubBucket: { $ne: true } // Exclude sub-buckets
    });

    const rolloverResults = [];
    let totalSweptAmount = 0;

    await executeTransaction(async (session) => {
      const opts = session ? { session } : {};

      const freeSpendCategory = await Category.findOne({ 'meta.subBucketTag': 'free_spend' }).session(session) || 
                                await Category.findOne({ name: 'Free Spend Balance' }).session(session);

      if (!freeSpendCategory) {
        throw new Error('Free Spend category not found for legacy sweep fallback inside session');
      }

      for (const tempCat of tempCategories) {
        // Fetch document inside session
        const cat = await Category.findById(tempCat._id).session(session);
        if (!cat) continue;

        // Calculate total spent in category during the cycle
        const transactions = await Transaction.find({
          destCategory: cat._id,
          cycleString: cycleString,
          type: 'EXPENSE'
        }).session(session);

        const totalSpent = transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const remaining = cat.monthlyBudgetLimit - totalSpent;

        if (remaining > 0) {
          // Deduct remaining from the category virtual balance
          cat.currentAllocatedBalance = Math.max(0, cat.currentAllocatedBalance - remaining);
          await cat.save(opts);

          // Track results
          totalSweptAmount += remaining;
          rolloverResults.push({
            categoryId: cat._id,
            name: cat.name,
            budgetLimit: cat.monthlyBudgetLimit,
            spent: totalSpent,
            swept: remaining
          });

          // Log the sweep transaction
          const sweepTx = new Transaction({
            title: `Rollover Sweep: ${cat.name}`,
            amount: remaining,
            type: 'TRANSFER',
            sourceCategory: cat._id,
            destCategory: freeSpendCategory._id,
            sourceAccount: cat.parentAccount,
            destAccount: freeSpendCategory.parentAccount,
            // duplicate tracking for SRD
            sourceBucketId: cat._id,
            destinationBucketId: freeSpendCategory._id,
            sourceAccountId: cat.parentAccount,
            destinationAccountId: freeSpendCategory.parentAccount,
            date: new Date(),
            timestamp: new Date(),
            cycleString: cycleString,
            billingCycle: cycleString
          });
          await sweepTx.save(opts);
        }
      }

      // Add total swept amount to Free Spend category (and its parent Cumulative Savings)
      if (totalSweptAmount > 0) {
        freeSpendCategory.currentAllocatedBalance += totalSweptAmount;
        await freeSpendCategory.save(opts);

        if (freeSpendCategory.subBucketParent) {
          const parentCat = await Category.findById(freeSpendCategory.subBucketParent).session(session);
          if (parentCat) {
            parentCat.currentAllocatedBalance += totalSweptAmount;
            await parentCat.save(opts);
          }
        }
      }

      // Reset spent tracker for external categories
      await Category.updateMany({ modelType: 'EXPENSE_TRACKER' }, { $set: { spent: 0 } }, opts);
    });

    res.json({
      message: 'Rollover completed successfully',
      cycleString,
      totalSweptAmount,
      details: rolloverResults
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Redistributes balances between virtual sub-buckets.
 */
export async function redistributeSubBuckets(req, res) {
  try {
    const { sourceTag, destTag, amount } = req.body;

    if (!sourceTag || !destTag || !amount) {
      return res.status(400).json({ error: 'Missing required parameters: sourceTag, destTag, amount' });
    }

    const moveAmount = Number(amount);
    if (isNaN(moveAmount) || moveAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    await executeTransaction(async (session) => {
      const opts = session ? { session } : {};

      const sourceCat = await Category.findOne({ 'meta.subBucketTag': sourceTag }).session(session);
      const destCat = await Category.findOne({ 'meta.subBucketTag': destTag }).session(session);

      if (!sourceCat || !destCat) {
        throw new Error('Source or Destination sub-bucket not found');
      }

      if (sourceCat.currentAllocatedBalance < moveAmount) {
        throw new Error(`Insufficient funds in ${sourceCat.name}. Available: ${sourceCat.currentAllocatedBalance}`);
      }

      sourceCat.currentAllocatedBalance -= moveAmount;
      destCat.currentAllocatedBalance += moveAmount;

      await sourceCat.save(opts);
      await destCat.save(opts);

      // Log transaction
      const tx = new Transaction({
        title: `Redistribution: ${sourceCat.name} to ${destCat.name}`,
        amount: moveAmount,
        type: 'TRANSFER',
        sourceCategory: sourceCat._id,
        destCategory: destCat._id,
        sourceAccount: sourceCat.parentAccount,
        destAccount: destCat.parentAccount,
        // duplicates
        sourceBucketId: sourceCat._id,
        destinationBucketId: destCat._id,
        sourceAccountId: sourceCat.parentAccount,
        destinationAccountId: destCat.parentAccount,
        date: new Date(),
        timestamp: new Date(),
        cycleString: getCycleString(new Date()),
        billingCycle: getCycleString(new Date())
      });
      await tx.save(opts);
    });

    res.json({
      message: `Successfully transferred ${moveAmount} from ${sourceTag} to ${destTag}`
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}
