import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import Account from './models/Account.js';
import Category from './models/Category.js';
import mongoose from 'mongoose';
import Transaction from './models/Transaction.js';
import { getCycleString } from './utils/cycleHelper.js';
import { getTransactions, postTransaction } from './controllers/transactionController.js';
import { bankToBankTransfer } from './controllers/transferController.js';
import { executeRollover, redistributeSubBuckets } from './controllers/cycleController.js';
import { initCycleCron } from './cron/cycleAutomation.js';
import { getAnalyticsReport } from './controllers/analyticsController.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors());
// Parse incoming JSON requests
app.use(express.json());

// Connect to Database
connectDB();

// Initialize automatic rollover sweep cron
initCycleCron();

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

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Accounts endpoints
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await Account.find();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Categories endpoints
const getCategories = async (req, res) => {
  try {
    const { cycleString } = req.query;
    const categories = await Category.find().populate('parentAccount subBucketParent');

    const targetCycle = cycleString || getCycleString(new Date());

    // Aggregate spent amounts for all EXPENSE transactions in the active cycle
    const expenseSummary = await Transaction.aggregate([
      { 
        $match: { 
          type: 'EXPENSE', 
          cycleString: targetCycle 
        } 
      },
      { 
        $group: { 
          _id: '$destCategory', 
          totalSpent: { $sum: '$amount' } 
        } 
      }
    ]);

    const spentMap = new Map();
    expenseSummary.forEach(item => {
      if (item._id) {
        spentMap.set(item._id.toString(), item.totalSpent);
      }
    });

    const result = categories.map(cat => {
      const catObj = cat.toObject();
      if (catObj.modelType === 'EXPENSE_TRACKER') {
        catObj.spent = spentMap.get(cat._id.toString()) || 0;
      }
      return catObj;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

app.get('/api/categories', getCategories);
app.get('/api/categories/balances', getCategories);

// Custom Category Creation with Strict Bank Validation
app.post('/api/categories', async (req, res) => {
  try {
    const { name, type, targetGoal, monthlyBudgetLimit, modelType, parentAccount, hasTarget } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Category name and type are required' });
    }

    if (type !== 'INCOME' && type !== 'EXPENSE') {
      return res.status(400).json({ error: 'Type must be either INCOME or EXPENSE' });
    }

    const mType = modelType || 'BUCKET';
    let resolvedParentAccountId = null;

    if (mType === 'BUCKET') {
      if (parentAccount) {
        resolvedParentAccountId = parentAccount;
      } else {
        // Resolve Bank based on Type
        let bank = null;
        if (type === 'INCOME') {
          bank = await Account.findOne({ type: 'INCOME_VAULT' });
        } else {
          bank = await Account.findOne({ type: 'EXPENSE_WALLET' });
        }

        if (!bank) {
          return res.status(404).json({ error: `Associated bank account for ${type} not found` });
        }
        resolvedParentAccountId = bank._id;
      }
    }

    const limit = Number(monthlyBudgetLimit) || 0;
    const resolvedHasTarget = hasTarget || false;
    const goal = resolvedHasTarget ? (Number(targetGoal) || 0) : 0;

    const newCategory = new Category({
      name,
      type,
      parentAccount: resolvedParentAccountId,
      currentAllocatedBalance: 0,
      allocatedBalance: 0,
      monthlyBudgetLimit: limit,
      targetGoal: goal,
      hasTarget: resolvedHasTarget,
      isSubBucket: false,
      isPermanent: false,
      modelType: mType,
      spent: 0
    });

    await newCategory.save();
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Category Deletion with Respective Free Spend Sweep Protocol
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const result = await executeTransaction(async (session) => {
      const opts = session ? { session } : {};

      const catToDelete = await Category.findById(req.params.id).session(session);
      if (!catToDelete) {
        throw new Error('Category not found');
      }

      // Deletion Protection for Core Free Spend Buckets
      const isFreeSpend = 
        catToDelete.systemRole === 'b1_free_spend' || 
        catToDelete.systemRole === 'b2_free_spend' ||
        (catToDelete.meta && catToDelete.meta.subBucketTag === 'free_spend') ||
        catToDelete.name === 'Free Spend Balance' ||
        catToDelete.name === 'Bank 1 Free Spend' ||
        catToDelete.name === 'Bank 2 Free Spend';

      if (isFreeSpend) {
        throw new Error('The permanent Free Spend bucket cannot be deleted.');
      }

      // If it is an Expense Tracker, delete immediately without sweeping
      if (catToDelete.modelType === 'EXPENSE_TRACKER') {
        await Category.deleteOne({ _id: catToDelete._id }, opts);
        return {
          message: `Expense tracker category "${catToDelete.name}" deleted successfully.`,
          sweptAmount: 0
        };
      }

      // Resolve which Bank Free Spend bucket to sweep to
      let freeSpend = null;
      if (catToDelete.parentAccount) {
        const parentAcc = await Account.findById(catToDelete.parentAccount).session(session);
        if (parentAcc) {
          if (parentAcc.type === 'INCOME_VAULT') {
            freeSpend = await Category.findOne({ systemRole: 'b1_free_spend' }).session(session);
          } else if (parentAcc.type === 'EXPENSE_WALLET') {
            freeSpend = await Category.findOne({ systemRole: 'b2_free_spend' }).session(session);
          }
        }
      }
      
      // Fallback to legacy free spend
      if (!freeSpend) {
        freeSpend = await Category.findOne({ 'meta.subBucketTag': 'free_spend' }).session(session) ||
                    await Category.findOne({ name: 'Free Spend Balance' }).session(session);
      }

      if (!freeSpend) {
        throw new Error('Destination Free Spend category not found for deletion sweep.');
      }

      const sweptAmount = catToDelete.currentAllocatedBalance || 0;

      if (sweptAmount > 0) {
        // Add balance to Free Spend
        freeSpend.currentAllocatedBalance += sweptAmount;
        await freeSpend.save(opts);

        // Log the sweep transaction for full transparency
        const today = new Date();
        const cycleStr = getCycleString(today);

        const sweepTx = new Transaction({
          title: `Deletion Sweep: ${catToDelete.name} to ${freeSpend.name}`,
          amount: sweptAmount,
          type: 'TRANSFER',
          sourceCategory: catToDelete._id,
          destCategory: freeSpend._id,
          sourceAccount: catToDelete.parentAccount,
          destAccount: freeSpend.parentAccount,
          sourceBucketId: catToDelete._id,
          destinationBucketId: freeSpend._id,
          sourceAccountId: catToDelete.parentAccount,
          destinationAccountId: freeSpend.parentAccount,
          date: today,
          timestamp: today,
          cycleString: cycleStr,
          billingCycle: cycleStr
        });
        await sweepTx.save(opts);
      }

      // Delete the category document
      await Category.deleteOne({ _id: catToDelete._id }, opts);

      return {
        message: `Category ${catToDelete.name} deleted successfully. Swept ₹${sweptAmount} into ${freeSpend.name}.`,
        sweptAmount
      };
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Category Editing (PUT) API
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { name, monthlyBudgetLimit, targetGoal, spent, hasTarget } = req.body;
    const catToUpdate = await Category.findById(req.params.id);
    if (!catToUpdate) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (name) catToUpdate.name = name;
    if (monthlyBudgetLimit !== undefined) catToUpdate.monthlyBudgetLimit = Number(monthlyBudgetLimit) || 0;
    if (hasTarget !== undefined) catToUpdate.hasTarget = hasTarget;
    if (targetGoal !== undefined) {
      const resolvedHasTarget = hasTarget !== undefined ? hasTarget : catToUpdate.hasTarget;
      catToUpdate.targetGoal = resolvedHasTarget ? (Number(targetGoal) || 0) : 0;
    } else if (hasTarget === false) {
      catToUpdate.targetGoal = 0;
    }
    if (spent !== undefined) catToUpdate.spent = Number(spent) || 0;

    await catToUpdate.save();
    res.json(catToUpdate);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Transaction endpoints
app.get('/api/transactions', getTransactions);
app.post('/api/transactions', postTransaction);

// Virtual Inter-Bank Transfer endpoint
app.post('/api/transfers/bank-to-bank', bankToBankTransfer);

// Cycle Rollover (Sweep) endpoint
app.post('/api/cycles/rollover', executeRollover);

// Sub-bucket Redistribution endpoint
app.post('/api/subbuckets/redistribute', redistributeSubBuckets);

// Visual Analytics endpoint
app.get('/api/analytics/report', getAnalyticsReport);

// Simple Health Check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'UP', message: 'Budget App API is running' });
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export { app, server };
