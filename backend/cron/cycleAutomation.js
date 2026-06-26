import cron from 'node-cron';
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
      console.warn('[CRON] MongoDB Transactions not supported in this environment. Running operations sequentially.');
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
 * Executes the automatic rollover sweep.
 */
export async function executeAutoSweep() {
  console.log('[CRON] Running Automatic Cycle Rollover Sweep...');
  try {
    // 1. Try to find the Monthly Expense Bucket and Bank 2 Free Spend
    const tempMonthlyExpense = await Category.findOne({ systemRole: 'monthly_expense' });
    const tempB2FreeSpend = await Category.findOne({ systemRole: 'b2_free_spend' });

    if (!tempMonthlyExpense || !tempB2FreeSpend) {
      console.error('[CRON] Automatic Sweep aborted: Could not find Monthly Expense Bucket or Bank 2 Free Spend bucket.');
      return;
    }

    const sweptAmount = tempMonthlyExpense.currentAllocatedBalance || 0;

    // Determine cycleString for the cycle that just ended (using date 1 minute ago to avoid midnight boundary edge cases)
    const yesterday = new Date(Date.now() - 60000);
    const cycleString = getCycleString(yesterday);

    await executeTransaction(async (session) => {
      const opts = session ? { session } : {};

      // Fetch documents inside the session to avoid caching outdated session information on document instances
      let monthlyExpenseQuery = Category.findOne({ systemRole: 'monthly_expense' });
      let b2FreeSpendQuery = Category.findOne({ systemRole: 'b2_free_spend' });

      if (session) {
        monthlyExpenseQuery = monthlyExpenseQuery.session(session);
        b2FreeSpendQuery = b2FreeSpendQuery.session(session);
      }

      const monthlyExpenseCategory = await monthlyExpenseQuery;
      const b2FreeSpendCategory = await b2FreeSpendQuery;

      if (sweptAmount > 0 && monthlyExpenseCategory && b2FreeSpendCategory) {
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
        console.log(`[CRON] Rollover Sweep completed successfully. Swept ₹${sweptAmount} into Bank 2 Free Spend for cycle ${cycleString}`);
      } else {
        console.log('[CRON] Monthly Expense Bucket has zero balance. No funds swept.');
      }

      // Reset spent tracker for external categories
      await Category.updateMany(
        { modelType: 'EXPENSE_TRACKER' },
        { $set: { spent: 0 } },
        opts
      );
      console.log('[CRON] Reset spent values for all expense trackers.');
    });

  } catch (error) {
    console.error('[CRON] Error executing Automatic Cycle Rollover Sweep:', error);
  }
}

/**
 * Initializes the cycle rollover sweep cron job.
 * Runs at midnight (00:00) on the 26th of every month: "0 0 26 * *"
 */
export function initCycleCron() {
  cron.schedule('0 0 26 * *', executeAutoSweep);
  console.log('[CRON] Cycle Rollover Sweep Cron Job Initialized (0 0 26 * *).');
}
