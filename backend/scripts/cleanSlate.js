import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';

dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/budget-app-db';

async function cleanSlate() {
  try {
    console.log(`Connecting to MongoDB at: ${mongoURI}`);
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB successfully.');

    console.log('Starting clean slate process...');

    // 1. Wipe all transactions
    const transactionResult = await Transaction.deleteMany({});
    console.log(`Wiped all transaction history: Deleted ${transactionResult.deletedCount} Transactions.`);

    // 2. Reset all account balances to exactly 0 (keeping dual-fields in sync)
    const accountResult = await Account.updateMany(
      {},
      { $set: { actualBankBalance: 0, balance: 0 } }
    );
    console.log(`Reset all Account balances to 0: Updated ${accountResult.modifiedCount || accountResult.nModified} Accounts.`);

    // 3. Reset Category allocated balances to exactly 0 (keeping dual-fields in sync)
    const categoryResult = await Category.updateMany(
      {},
      { $set: { currentAllocatedBalance: 0, allocatedBalance: 0 } }
    );
    console.log(`Reset all Category balances to 0: Updated ${categoryResult.modifiedCount || categoryResult.nModified} Categories.`);

    console.log('Clean slate process complete. All transaction history wiped and balances reset to 0 while keeping categories intact.');

    // Disconnect and exit
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Error executing clean slate script:', error);
    process.exit(1);
  }
}

cleanSlate();
