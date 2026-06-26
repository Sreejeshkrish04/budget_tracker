import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';

dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/budget-app-db';

async function zeroBalances() {
  try {
    console.log(`Connecting to MongoDB at: ${mongoURI}`);
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB successfully.');

    // 1. Zero out Category currentAllocatedBalance and allocatedBalance (keeping dual-fields in sync)
    console.log('Zeroing out Category balances...');
    const categoryResult = await Category.updateMany(
      {},
      { $set: { currentAllocatedBalance: 0, allocatedBalance: 0 } }
    );
    console.log(`Updated Categories: ${categoryResult.modifiedCount || categoryResult.nModified}`);

    // 2. Zero out Account actualBankBalance and balance (keeping dual-fields in sync)
    console.log('Zeroing out Account balances...');
    const accountResult = await Account.updateMany(
      {},
      { $set: { actualBankBalance: 0, balance: 0 } }
    );
    console.log(`Updated Accounts: ${accountResult.modifiedCount || accountResult.nModified}`);

    // 3. Clear any transactions (e.g. default seed transactions)
    console.log('Deleting all Transactions...');
    const transactionResult = await Transaction.deleteMany({});
    console.log(`Deleted Transactions: ${transactionResult.deletedCount}`);

    console.log('Production ready: All balances zeroed and transactions cleared.');
    
    // Disconnect and exit
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Error executing zeroBalances script:', error);
    process.exit(1);
  }
}

zeroBalances();
