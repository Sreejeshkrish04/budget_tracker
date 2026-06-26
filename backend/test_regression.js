import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import axios from 'axios';
import Account from './models/Account.js';
import Category from './models/Category.js';
import Transaction from './models/Transaction.js';

const TEST_PORT = 5099;
const API_BASE = `http://localhost:${TEST_PORT}/api`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runRegressionSuite() {
  console.log('\n========================================================');
  console.log('STARTING AUTOMATED REGRESSION TEST SUITE (VAULTFLOW)');
  console.log('========================================================\n');

  let mongoServer;
  let serverInstance;

  try {
    // 1. Spin up MongoMemoryServer
    console.log('Step 1: Initializing temporary MongoDB In-Memory Server...');
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    
    // Set environment variables for testing
    process.env.MONGO_URI = mongoUri;
    process.env.PORT = TEST_PORT;

    console.log(`In-memory database running at: ${mongoUri}`);
    console.log(`Booting VaultFlow Express server on port ${TEST_PORT}...`);

    // 2. Import server.js to boot the app
    const serverModule = await import('./server.js');
    serverInstance = serverModule.server;

    // Wait a brief moment for database connection and seeding to finish
    await new Promise(resolve => setTimeout(resolve, 1500));

    // To align with the zero-balance production initialization seeder, we manually inject test funds for the regression test
    await Account.updateOne({ type: 'INCOME_VAULT' }, { $set: { balance: 10000, actualBankBalance: 10000 } });
    await Account.updateOne({ type: 'EXPENSE_WALLET' }, { $set: { balance: 3000, actualBankBalance: 3000 } });
    await Category.updateOne({ systemRole: 'emergency' }, { $set: { currentAllocatedBalance: 5000, allocatedBalance: 5000 } });
    await Category.updateOne({ systemRole: 'investment' }, { $set: { currentAllocatedBalance: 2000, allocatedBalance: 2000 } });
    await Category.updateOne({ systemRole: 'b1_free_spend' }, { $set: { currentAllocatedBalance: 3000, allocatedBalance: 3000 } });
    await Category.updateOne({ systemRole: 'monthly_expense' }, { $set: { currentAllocatedBalance: 1000, allocatedBalance: 1000 } });
    await Category.updateOne({ systemRole: 'b2_free_spend' }, { $set: { currentAllocatedBalance: 1000, allocatedBalance: 1000 } });

    // --------------------------------------------------------
    // PHASE 1: Architecture & Seeding
    // --------------------------------------------------------
    console.log('\n--- PHASE 1: Architecture & Seeding ---');
    
    // Verify accounts are auto-seeded
    const accountsRes = await axios.get(`${API_BASE}/accounts`);
    const accounts = accountsRes.data;
    assert(accounts.length === 2, `Seeded exactly 2 physical accounts (found ${accounts.length})`);
    
    const bankA = accounts.find(a => a.type === 'INCOME_VAULT');
    const bankB = accounts.find(a => a.type === 'EXPENSE_WALLET');
    
    assert(bankA !== undefined, "Bank A (Income Vault) is seeded");
    assert(bankB !== undefined, "Bank B (Expense Wallet) is seeded");
    assert(bankA.balance === 10000, `Bank A has initial balance of ₹10000 (found ₹${bankA.balance})`);
    assert(bankB.balance === 3000, `Bank B has initial balance of ₹3000 (found ₹${bankB.balance})`);

    // Verify system categories
    const categoriesRes = await axios.get(`${API_BASE}/categories`);
    const categories = categoriesRes.data;
    
    const emergency = categories.find(c => c.systemRole === 'emergency');
    const monthlyExpense = categories.find(c => c.systemRole === 'monthly_expense');
    const b1FreeSpend = categories.find(c => c.systemRole === 'b1_free_spend');
    const b2FreeSpend = categories.find(c => c.systemRole === 'b2_free_spend');

    assert(emergency !== undefined, "Emergency Bucket is created");
    assert(monthlyExpense !== undefined, "Monthly Expense Bucket is created");
    assert(b1FreeSpend !== undefined, "Bank 1 Free Spend bucket is created");
    assert(b2FreeSpend !== undefined, "Bank 2 Free Spend bucket is created");

    assert(emergency.parentAccount._id === bankA._id, "Emergency Bucket is linked to Bank A");
    assert(b1FreeSpend.parentAccount._id === bankA._id, "Bank 1 Free Spend is linked to Bank A");
    assert(monthlyExpense.parentAccount._id === bankB._id, "Monthly Expense Bucket is linked to Bank B");
    assert(b2FreeSpend.parentAccount._id === bankB._id, "Bank 2 Free Spend is linked to Bank B");

    console.log('Phase 1 Completed successfully!');

    // --------------------------------------------------------
    // PHASE 2: Category Management & The Deletion Sweep
    // --------------------------------------------------------
    console.log('\n--- PHASE 2: Category Management & The Deletion Sweep ---');

    // Create custom savings bucket in Bank 1
    const newBucketRes = await axios.post(`${API_BASE}/categories`, {
      name: "Europe Trip Fund",
      type: "INCOME",
      modelType: "BUCKET",
      parentAccount: bankA._id
    });
    const customBucket = newBucketRes.data;
    assert(customBucket.name === "Europe Trip Fund", "Custom savings bucket created successfully");
    assert(customBucket.parentAccount === bankA._id, "Custom bucket is correctly linked to Bank A");

    // Create custom EXPENSE_TRACKER category
    const newTrackerRes = await axios.post(`${API_BASE}/categories`, {
      name: "Groceries Tracker Test",
      type: "EXPENSE",
      modelType: "EXPENSE_TRACKER",
      monthlyBudgetLimit: 1200
    });
    const customTracker = newTrackerRes.data;
    assert(customTracker.name === "Groceries Tracker Test", "Custom EXPENSE_TRACKER category created successfully");
    assert(customTracker.modelType === "EXPENSE_TRACKER", "Category modelType is EXPENSE_TRACKER");
    assert(customTracker.monthlyBudgetLimit === 1200, "Category monthlyBudgetLimit is ₹1200");

    // Allocate ₹600 to the custom savings bucket via direct DB save (simulating seed/app behavior)
    const bucketInDb = await Category.findById(customBucket._id);
    bucketInDb.currentAllocatedBalance = 600;
    await bucketInDb.save();
    console.log(`  Allocated ₹600 to custom bucket "${bucketInDb.name}" directly in DB for sweep test`);

    // Fetch Bank 1 Free Spend balance before deletion
    const b1FreeSpendBefore = await Category.findOne({ systemRole: 'b1_free_spend' });
    const b1FreeSpendBalBefore = b1FreeSpendBefore.currentAllocatedBalance;

    // Delete custom savings bucket
    const deleteRes = await axios.delete(`${API_BASE}/categories/${customBucket._id}`);
    assert(deleteRes.data.sweptAmount === 600, `Deletion response logs swept amount of ₹600 (found ₹${deleteRes.data.sweptAmount})`);

    // Verify deletion and sweep
    const deletedCheck = await Category.findById(customBucket._id);
    assert(deletedCheck === null, "Custom bucket was deleted from DB");

    const b1FreeSpendAfter = await Category.findOne({ systemRole: 'b1_free_spend' });
    assert(b1FreeSpendAfter.currentAllocatedBalance === b1FreeSpendBalBefore + 600, 
      `Bank 1 Free Spend balance increased by ₹600 to ₹${b1FreeSpendAfter.currentAllocatedBalance} (previously ₹${b1FreeSpendBalBefore})`
    );

    // Verify deletion sweep transaction log
    const deletionSweepTx = await Transaction.findOne({
      title: `Deletion Sweep: ${bucketInDb.name} to ${b1FreeSpendAfter.name}`
    });
    assert(deletionSweepTx !== null, "Deletion sweep transaction logged successfully");
    assert(deletionSweepTx.amount === 600, `Deletion sweep transaction logged ₹600 (found ₹${deletionSweepTx.amount})`);

    console.log('Phase 2 Completed successfully!');

    // --------------------------------------------------------
    // PHASE 3: The Transaction Engine
    // --------------------------------------------------------
    console.log('\n--- PHASE 3: The Transaction Engine ---');

    // 1. INCOME Transaction
    console.log('  Testing INCOME Transaction...');
    // Find Salary / Income Bucket
    const salaryBucket = categories.find(c => c.name === 'Salary / Income Bucket');
    const bankABalBeforeIncome = (await Account.findById(bankA._id)).balance;
    const salaryBalBefore = (await Category.findById(salaryBucket._id)).currentAllocatedBalance;

    const incomeTxRes = await axios.post(`${API_BASE}/transactions`, {
      title: "Salary Inflow",
      amount: 4000,
      type: "INCOME",
      destCategory: salaryBucket._id,
      date: "2026-06-26"
    });
    assert(incomeTxRes.status === 201, "INCOME transaction posted successfully (201)");

    const salaryBalAfter = (await Category.findById(salaryBucket._id)).currentAllocatedBalance;
    const bankABalAfterIncome = (await Account.findById(bankA._id)).balance;

    assert(salaryBalAfter === salaryBalBefore + 4000, `Salary Bucket increased by ₹4000 to ₹${salaryBalAfter}`);
    assert(bankABalAfterIncome === bankABalBeforeIncome + 4000, `Bank A physical balance increased by ₹4000 to ₹${bankABalAfterIncome}`);

    // 2. EXPENSE Transaction
    console.log('  Testing EXPENSE Transaction...');
    // We will spend ₹250 from Emergency Bucket, target "Groceries Tracker Test"
    const emergencyBalBeforeExpense = (await Category.findById(emergency._id)).currentAllocatedBalance;
    const bankABalBeforeExpense = (await Account.findById(bankA._id)).balance;
    const customTrackerBalBeforeExpense = (await Category.findById(customTracker._id)).currentAllocatedBalance;

    const expenseTxRes = await axios.post(`${API_BASE}/transactions`, {
      title: "Grocery Shopping",
      amount: 250,
      type: "EXPENSE",
      sourceCategory: emergency._id,
      destCategory: customTracker._id,
      date: "2026-06-26"
    });
    assert(expenseTxRes.status === 201, "EXPENSE transaction posted successfully (201)");

    const emergencyBalAfterExpense = (await Category.findById(emergency._id)).currentAllocatedBalance;
    const bankABalAfterExpense = (await Account.findById(bankA._id)).balance;
    const customTrackerBalAfterExpense = (await Category.findById(customTracker._id)).currentAllocatedBalance;

    assert(emergencyBalAfterExpense === emergencyBalBeforeExpense - 250, `Emergency Bucket decreased by ₹250 to ₹${emergencyBalAfterExpense}`);
    assert(bankABalAfterExpense === bankABalBeforeExpense - 250, `Bank A physical balance decreased by ₹250 to ₹${bankABalAfterExpense}`);
    assert(customTrackerBalAfterExpense === customTrackerBalBeforeExpense, `Expense Tracker category balance remains untouched (₹${customTrackerBalAfterExpense})`);

    // 3. INTERNAL TRANSFER Transaction
    console.log('  Testing INTERNAL TRANSFER Transaction...');
    // Transfer ₹500 from Bank 1 Free Spend to Emergency Bucket (both inside Bank 1)
    const emergencyBalBeforeInt = (await Category.findById(emergency._id)).currentAllocatedBalance;
    const b1FreeSpendBalBeforeInt = (await Category.findOne({ systemRole: 'b1_free_spend' })).currentAllocatedBalance;
    const bankABalBeforeInt = (await Account.findById(bankA._id)).balance;

    const b1FreeSpendDoc = await Category.findOne({ systemRole: 'b1_free_spend' });

    const intTransferRes = await axios.post(`${API_BASE}/transactions`, {
      title: "Allocate to Emergency",
      amount: 500,
      type: "TRANSFER",
      sourceCategory: b1FreeSpendDoc._id,
      destCategory: emergency._id,
      date: "2026-06-26"
    });
    assert(intTransferRes.status === 201, "Internal TRANSFER transaction posted successfully (201)");

    const emergencyBalAfterInt = (await Category.findById(emergency._id)).currentAllocatedBalance;
    const b1FreeSpendBalAfterInt = (await Category.findOne({ systemRole: 'b1_free_spend' })).currentAllocatedBalance;
    const bankABalAfterInt = (await Account.findById(bankA._id)).balance;

    assert(emergencyBalAfterInt === emergencyBalBeforeInt + 500, `Destination Emergency Bucket increased by ₹500 to ₹${emergencyBalAfterInt}`);
    assert(b1FreeSpendBalAfterInt === b1FreeSpendBalBeforeInt - 500, `Source Free Spend bucket decreased by ₹500 to ₹${b1FreeSpendBalAfterInt}`);
    assert(bankABalAfterInt === bankABalBeforeInt, `Bank A physical balance remains exactly the same: ₹${bankABalAfterInt}`);

    // 4. CROSS-BANK TRANSFER Transaction
    console.log('  Testing CROSS-BANK TRANSFER (Virtual Inter-Bank)...');
    // Transfer ₹1000 from Bank 1 (Income Vault) Free Spend to Bank 2 (Expense Wallet) Free Spend
    const bankABalBeforeCross = (await Account.findById(bankA._id)).balance;
    const bankBBalBeforeCross = (await Account.findById(bankB._id)).balance;
    const b1FreeSpendBalBeforeCross = (await Category.findOne({ systemRole: 'b1_free_spend' })).currentAllocatedBalance;
    const b2FreeSpendBalBeforeCross = (await Category.findOne({ systemRole: 'b2_free_spend' })).currentAllocatedBalance;

    const b2FreeSpendDoc = await Category.findOne({ systemRole: 'b2_free_spend' });

    const crossTransferRes = await axios.post(`${API_BASE}/transfers/bank-to-bank`, {
      amount: 1000,
      sourceAccountId: bankA._id,
      destinationAccountId: bankB._id,
      sourceBucketId: b1FreeSpendDoc._id,
      destinationBucketId: b2FreeSpendDoc._id
    });
    assert(crossTransferRes.status === 200, "Cross-bank transfer executed successfully (200)");

    const bankABalAfterCross = (await Account.findById(bankA._id)).balance;
    const bankBBalAfterCross = (await Account.findById(bankB._id)).balance;
    const b1FreeSpendBalAfterCross = (await Category.findOne({ systemRole: 'b1_free_spend' })).currentAllocatedBalance;
    const b2FreeSpendBalAfterCross = (await Category.findOne({ systemRole: 'b2_free_spend' })).currentAllocatedBalance;

    assert(bankABalAfterCross === bankABalBeforeCross - 1000, `Bank A physical balance decreased by ₹1000 to ₹${bankABalAfterCross}`);
    assert(bankBBalAfterCross === bankBBalBeforeCross + 1000, `Bank B physical balance increased by ₹1000 to ₹${bankBBalAfterCross}`);
    assert(b1FreeSpendBalAfterCross === b1FreeSpendBalBeforeCross - 1000, `Bank 1 Free Spend bucket balance decreased by ₹1000 to ₹${b1FreeSpendBalAfterCross}`);
    assert(b2FreeSpendBalAfterCross === b2FreeSpendBalBeforeCross + 1000, `Bank 2 Free Spend bucket balance increased by ₹1000 to ₹${b2FreeSpendBalAfterCross}`);

    console.log('Phase 3 Completed successfully!');

    // --------------------------------------------------------
    // PHASE 4: Aggregation & Rollover
    // --------------------------------------------------------
    console.log('\n--- PHASE 4: Aggregation & Rollover ---');

    // 1. Dynamic spent aggregation based on cycleString
    console.log('  Testing dynamic spent aggregation query...');
    const targetCycle = "2026-06-26_NX";
    
    // Query /api/categories/balances (alias) with cycleString query parameter
    const balRes = await axios.get(`${API_BASE}/categories/balances`, {
      params: { cycleString: targetCycle }
    });
    const balancesList = balRes.data;
    const groceriesTrackerCheck = balancesList.find(c => c._id.toString() === customTracker._id.toString());
    
    assert(groceriesTrackerCheck !== undefined, "Custom tracker found in response list");
    assert(groceriesTrackerCheck.spent === 250, `Spent amount for "Groceries Tracker Test" is dynamically calculated as ₹250 (found ₹${groceriesTrackerCheck.spent})`);

    // Verify that querying another cycle returns ₹0 spent (preserving past data)
    const legacyCycleRes = await axios.get(`${API_BASE}/categories/balances`, {
      params: { cycleString: "2026-05-26_NX" }
    });
    const groceriesTrackerLegacy = legacyCycleRes.data.find(c => c._id.toString() === customTracker._id.toString());
    assert(groceriesTrackerLegacy.spent === 0, `Spent amount for other cycle "2026-05-26_NX" is dynamically calculated as ₹0 (found ₹${groceriesTrackerLegacy.spent})`);

    // 2. Manual Rollover Sweep
    console.log('  Testing manual Rollover Sweep...');
    // Verify Monthly Expense Bucket balance before rollover
    const monthlyExpDoc = await Category.findOne({ systemRole: 'monthly_expense' });
    const b2FreeSpendBeforeRoll = await Category.findOne({ systemRole: 'b2_free_spend' });
    
    const monthlyExpBalBefore = monthlyExpDoc.currentAllocatedBalance;
    const b2FreeSpendBalBeforeRoll = b2FreeSpendBeforeRoll.currentAllocatedBalance;
    
    assert(monthlyExpBalBefore > 0, `Monthly Expense Bucket has positive balance: ₹${monthlyExpBalBefore}`);

    // Trigger Rollover Sweep endpoint
    const rolloverRes = await axios.post(`${API_BASE}/cycles/rollover`, {
      cycleString: targetCycle
    });
    assert(rolloverRes.status === 200, "Rollover Sweep endpoint executed successfully (200)");
    assert(rolloverRes.data.totalSweptAmount === monthlyExpBalBefore, `Swept exact amount of ₹${monthlyExpBalBefore}`);

    const monthlyExpAfter = await Category.findOne({ systemRole: 'monthly_expense' });
    const b2FreeSpendAfterRoll = await Category.findOne({ systemRole: 'b2_free_spend' });

    assert(monthlyExpAfter.currentAllocatedBalance === 0, `Monthly Expense Bucket balance drained to ₹0 (previously ₹${monthlyExpBalBefore})`);
    assert(b2FreeSpendAfterRoll.currentAllocatedBalance === b2FreeSpendBalBeforeRoll + monthlyExpBalBefore, 
      `Bank 2 Free Spend bucket balance increased by ₹${monthlyExpBalBefore} to ₹${b2FreeSpendAfterRoll.currentAllocatedBalance} (previously ₹${b2FreeSpendBalBeforeRoll})`
    );

    // Verify sweep transaction log
    const rolloverTx = await Transaction.findOne({
      title: 'Rollover Sweep: Monthly Expense to Bank 2 Free Spend',
      cycleString: targetCycle
    });
    assert(rolloverTx !== null, "Rollover Sweep transaction logged successfully");
    assert(rolloverTx.amount === monthlyExpBalBefore, `Rollover transaction logged ₹${monthlyExpBalBefore} (found ₹${rolloverTx.amount})`);

    console.log('Phase 4 Completed successfully!');

    console.log('\n========================================================');
    console.log('ALL REGRESSION TESTS PASSED SUCCESSFULLY! NO ERRORS FOUND.');
    console.log('========================================================\n');

  } catch (error) {
    console.error('\n========================================================');
    console.error(`REGRESSION TEST SUITE FAILED AT STEP: ${error.message}`);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    console.error('========================================================\n');
    process.exit(1);
  } finally {
    // Cleanup connection and servers
    console.log('Cleaning up in-memory resources...');
    if (mongoose.connection) {
      await mongoose.connection.close();
    }
    if (serverInstance) {
      await new Promise(resolve => serverInstance.close(resolve));
      console.log('Express server closed.');
    }
    if (mongoServer) {
      await mongoServer.stop();
      console.log('Mongo In-Memory Server stopped.');
    }
    process.exit(0);
  }
}

// Run regression suite
runRegressionSuite();
