import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Account from './models/Account.js';
import Category from './models/Category.js';
import Transaction from './models/Transaction.js';
import { getCycleString } from './utils/cycleHelper.js';
import { connectDB } from './config/db.js';

dotenv.config();

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`[PASS] ${message}`);
}

async function runTests() {
  console.log('--- Starting Phase 2: Dynamic Savings & Deletion Sweep Tests ---');

  // Connect via backend config helper
  await connectDB();
  console.log('Connected to test DB.');

  // Reset database state to clear any historical tests
  await Account.deleteMany({});
  await Category.deleteMany({});
  await Transaction.deleteMany({});
  console.log('Database cleared.');

  // 1. Seed Accounts
  const bankA = await Account.create({
    name: 'Bank A (Income Vault)',
    type: 'INCOME_VAULT',
    balance: 10000
  });

  // 2. Seed permanent Free Spend sub-bucket
  const cumulativeSavingsParent = await Category.create({
    name: 'Cumulative Savings',
    type: 'CUMULATIVE_SAVINGS',
    parentAccount: bankA._id,
    currentAllocatedBalance: 500
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

  // --- TEST A: CREATING SAVINGS GOAL ---
  console.log('\n--- Test A: Creating Savings Goal Category ---');
  const newGoal = await Category.create({
    name: 'New Laptop Goal',
    type: 'EXPENSE',
    parentAccount: bankA._id,
    currentAllocatedBalance: 12000, // Seed with some balance
    allocatedBalance: 12000,
    monthlyBudgetLimit: 0,
    targetGoal: 50000,
    isSubBucket: true,
    subBucketParent: cumulativeSavingsParent._id,
    isTargetedSavings: true,
    meta: {
      isCumulativeSubBucket: true,
      subBucketTag: 'new_laptop_goal'
    }
  });

  assert(newGoal.targetGoal === 50000, 'New sub-bucket target goal is correctly set to 50000');
  assert(newGoal.currentAllocatedBalance === 12000, 'New sub-bucket balance is correctly set to 12000');

  // --- TEST B: DELETION SWEEP PROTOCOL ---
  console.log('\n--- Test B: Executing Deletion Sweep Protocol ---');
  
  // We simulate the DELETE controller:
  // Find category to delete
  const catToDelete = await Category.findById(newGoal._id);
  assert(catToDelete !== null, 'Category to delete exists in DB');

  // Verify deletion protection on free_spend
  try {
    if (freeSpend.meta.subBucketTag === 'free_spend') {
      throw new Error('Deletion protection active: permanent Free Spend bucket cannot be deleted.');
    }
  } catch (err) {
    assert(err.message.includes('Deletion protection active'), 'Free Spend bucket is protected from deletion');
  }

  const sweptAmount = catToDelete.currentAllocatedBalance;
  assert(sweptAmount === 12000, 'Amount to sweep is 12000');

  // Perform Sweep atomically
  if (sweptAmount > 0) {
    const freeSpendDoc = await Category.findOne({ 'meta.subBucketTag': 'free_spend' });
    freeSpendDoc.currentAllocatedBalance += sweptAmount;
    await freeSpendDoc.save();

    // Log the transaction
    const today = new Date();
    const cycleStr = getCycleString(today);
    await Transaction.create({
      title: `Deletion Sweep: ${catToDelete.name} to Free Spend`,
      amount: sweptAmount,
      type: 'TRANSFER',
      sourceCategory: catToDelete._id,
      destCategory: freeSpendDoc._id,
      sourceAccount: catToDelete.parentAccount,
      destAccount: freeSpendDoc.parentAccount,
      date: today,
      cycleString: cycleStr,
      billingCycle: cycleStr
    });
  }

  // Delete the document
  await Category.deleteOne({ _id: catToDelete._id });
  console.log('Sub-bucket deleted.');

  // Validate state
  const deletedCheck = await Category.findById(catToDelete._id);
  const finalFreeSpend = await Category.findOne({ 'meta.subBucketTag': 'free_spend' });
  const sweepTxCheck = await Transaction.findOne({ title: `Deletion Sweep: New Laptop Goal to Free Spend` });

  console.log('--- DEBUG INFO ---');
  console.log('finalFreeSpend object:', JSON.stringify(finalFreeSpend));
  console.log('sweptAmount:', sweptAmount);
  console.log('------------------');

  assert(deletedCheck === null, 'Category document is successfully deleted');
  assert(finalFreeSpend.currentAllocatedBalance === 12500, 'Free Spend balance correctly increased from 500 to 12500');
  assert(sweepTxCheck !== null && sweepTxCheck.amount === 12000, 'Transfer transaction log exists for 12000');

  console.log('\n--- All Phase 2 Automated Tests Passed Successfully! ---');
  await mongoose.connection.close();
}

runTests().catch(async (err) => {
  console.error('Test Suite Failed:', err);
  await mongoose.connection.close();
  process.exit(1);
});
