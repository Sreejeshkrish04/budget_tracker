import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';

dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/budget-app-db';

async function cleanSlateData() {
  try {
    console.log(`Connecting to MongoDB at: ${mongoURI}`);
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB successfully.');

    console.log('Resetting all transactions and balances...');

    // 1. Wipe all transactions
    const transactionResult = await Transaction.deleteMany({});
    console.log(`Wiped all transactions: Deleted ${transactionResult.deletedCount} documents.`);

    // 2. Reset Account actualBankBalance and balance
    const accountResult = await Account.updateMany(
      {},
      { $set: { actualBankBalance: 0, balance: 0 } }
    );
    console.log(`Reset all Account balances to 0: Updated ${accountResult.modifiedCount || accountResult.nModified} Accounts.`);

    // 3. Reset Category currentAllocatedBalance and allocatedBalance
    const categoryResult = await Category.updateMany(
      {},
      { $set: { currentAllocatedBalance: 0, allocatedBalance: 0 } }
    );
    console.log(`Reset all Category balances to 0: Updated ${categoryResult.modifiedCount || categoryResult.nModified} Categories.`);

    console.log('Data cleanup complete. Transactions deleted and balances zeroed.');

    // Disconnect and exit
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Error executing cleanSlateData script:', error);
    process.exit(1);
  }
}

cleanSlateData();
