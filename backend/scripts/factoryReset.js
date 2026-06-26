import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';

dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/budget-app-db';

async function factoryReset() {
  try {
    console.log(`Connecting to MongoDB at: ${mongoURI}`);
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB successfully.');

    console.log('Starting factory reset (wiping all collections)...');

    // 1. Delete all Transactions
    const transactionResult = await Transaction.deleteMany({});
    console.log(`Deleted ${transactionResult.deletedCount} Transactions.`);

    // 2. Delete all Categories
    const categoryResult = await Category.deleteMany({});
    console.log(`Deleted ${categoryResult.deletedCount} Categories.`);

    // 3. Delete all Accounts
    const accountResult = await Account.deleteMany({});
    console.log(`Deleted ${accountResult.deletedCount} Accounts.`);

    console.log('Factory reset complete. The database is now completely empty.');

    // Disconnect and exit
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Error executing factory reset:', error);
    process.exit(1);
  }
}

factoryReset();
