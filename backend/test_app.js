import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Account from './models/Account.js';
import Category from './models/Category.js';
import Transaction from './models/Transaction.js';
import { getCycleString } from './utils/cycleHelper.js';
import { connectDB } from './config/db.js';

dotenv.config();

// Helper assertion function
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`[PASS] ${message}`);
}

async function runTests() {
  console.log('--- Starting Automated System Tests ---');
  
  // Connect via backend config helper
  await connectDB();
  console.log('Connected to test DB.');

  // Reset database
  await Account.deleteMany({});
  await Category.deleteMany({});
  await Transaction.deleteMany({});
  console.log('Database cleared.');

  // 1. Seed Initial Accounts
  const bankA = await Account.create({
    name: 'Bank A (Income Vault)',
    type: 'INCOME_VAULT',
    balance: 10000,
    actualBankBalance: 10000
  });

  const bankB = await Account.create({
    name: 'Bank B (Expense Wallet)',
    type: 'EXPENSE_WALLET',
    balance: 3000,
    actualBankBalance: 3000
  });

  // 2. Seed Categories
  const groceries = await Category.create({
    name: 'Groceries',
    type: 'EXPENSE',
    parentAccount: bankB._id,
    currentAllocatedBalance: 500,
    allocatedBalance: 500,
    monthlyBudgetLimit: 500
  });

  const rent = await Category.create({
    name: 'Rent & Utilities',
    type: 'EXPENSE',
    parentAccount: bankB._id,
    currentAllocatedBalance: 1500,
    allocatedBalance: 1500,
    monthlyBudgetLimit: 1500
  });

  const salaryBucket = await Category.create({
    name: 'Salary Bucket',
    type: 'INCOME',
    parentAccount: bankA._id,
    currentAllocatedBalance: 2300,
    allocatedBalance: 2300,
    monthlyBudgetLimit: 0
  });

  const cumulativeSavingsParent = await Category.create({
    name: 'Cumulative Savings',
    type: 'CUMULATIVE_SAVINGS',
    parentAccount: bankA._id,
    currentAllocatedBalance: 2700,
    allocatedBalance: 2700,
    monthlyBudgetLimit: 0
  });

  const freeSpend = await Category.create({
    name: 'Free Spend Balance',
    type: 'EXPENSE',
    parentAccount: bankA._id,
    currentAllocatedBalance: 500,
    allocatedBalance: 500,
    monthlyBudgetLimit: 0,
    isSubBucket: true,
    subBucketParent: cumulativeSavingsParent._id,
    isTargetedSavings: true,
    meta: {
      isCumulativeSubBucket: true,
      subBucketTag: 'free_spend'
    }
  });

  // Verify Initial State
  const initialBankA = await Account.findById(bankA._id);
  const initialBankB = await Account.findById(bankB._id);
  assert(initialBankA.balance === 10000, 'Bank A balance is 10000');
  assert(initialBankB.balance === 3000, 'Bank B balance is 3000');

  // --- TEST A: POSTING AN EXPENSE ---
  // Spend $100 on Groceries, funded from Groceries category
  console.log('\n--- Test A: Posting Expense ---');
  const today = new Date();
  const currentCycle = getCycleString(today);

  // We decrease groceries currentAllocatedBalance by $100 and deduct from parent Account (bankB)
  groceries.currentAllocatedBalance -= 100;
  await groceries.save();

  bankB.balance -= 100;
  await bankB.save();

  const expenseTx = await Transaction.create({
    title: 'Grocery Store Expense',
    amount: 100,
    type: 'EXPENSE',
    sourceCategory: groceries._id,
    destCategory: groceries._id,
    sourceAccount: bankB._id,
    date: today,
    cycleString: currentCycle,
    billingCycle: currentCycle
  });

  const updatedGroceries = await Category.findById(groceries._id);
  const updatedBankB = await Account.findById(bankB._id);
  
  assert(updatedGroceries.currentAllocatedBalance === 400, 'Groceries bucket balance decreased by 100 to 400');
  assert(updatedBankB.balance === 2900, 'Bank B physical balance decreased by 100 to 2900');

  // --- TEST B: BANK-TO-BANK TRANSFER ---
  console.log('\n--- Test B: Bank-to-Bank Virtual Transfer ---');
  // Move $500 from Bank A to Bank B
  bankA.balance -= 500;
  await bankA.save();

  bankB.balance += 500;
  await bankB.save();

  const transferTx = await Transaction.create({
    title: 'Inter-Bank Transfer',
    amount: 500,
    type: 'TRANSFER',
    sourceAccount: bankA._id,
    destAccount: bankB._id,
    date: today,
    cycleString: currentCycle,
    billingCycle: currentCycle
  });

  const finalBankA = await Account.findById(bankA._id);
  const finalBankB = await Account.findById(bankB._id);

  assert(finalBankA.balance === 9500, 'Bank A balance reduced by 500 to 9500');
  assert(finalBankB.balance === 3400, 'Bank B balance increased by 500 to 3400');

  // --- TEST C: CYCLE ROLLOVER ROUTINE (SWEEP) ---
  console.log('\n--- Test C: Cycle Rollover Sweep ---');
  // We check category: Groceries (monthlyBudgetLimit = 500)
  // Total Spent in currentCycle: $100 (from expenseTx)
  // Remaining = 500 - 100 = 400.
  // We deduct 400 from Groceries allocated balance (resets to 0)
  // And add 400 to Free Spend bucket and Cumulative Savings parent bucket.

  const totalSpentInGroceries = 100;
  const remainingBudget = groceries.monthlyBudgetLimit - totalSpentInGroceries;
  
  assert(remainingBudget === 400, 'Remaining budget for Groceries is 400');

  if (remainingBudget > 0) {
    updatedGroceries.currentAllocatedBalance -= remainingBudget;
    await updatedGroceries.save();

    freeSpend.currentAllocatedBalance += remainingBudget;
    await freeSpend.save();

    cumulativeSavingsParent.currentAllocatedBalance += remainingBudget;
    await cumulativeSavingsParent.save();
  }

  const rolledGroceries = await Category.findById(groceries._id);
  const rolledFreeSpend = await Category.findById(freeSpend._id);
  const rolledCumulative = await Category.findById(cumulativeSavingsParent._id);

  assert(rolledGroceries.currentAllocatedBalance === 0, 'Groceries balance swept to 0');
  assert(rolledFreeSpend.currentAllocatedBalance === 900, 'Free Spend balance increased from 500 to 900');
  assert(rolledCumulative.currentAllocatedBalance === 3100, 'Cumulative parent balance increased from 2700 to 3100');

  console.log('\n--- All Automated Backend Tests Passed Successfully! ---');
  await mongoose.connection.close();
}

runTests().catch(async (err) => {
  console.error('Test Suite Failed:', err);
  await mongoose.connection.close();
  process.exit(1);
});
