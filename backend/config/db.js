import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';

let isMockMode = false;
let accountsData = [];
let categoriesData = [];
let transactionsData = [];

export async function connectDB() {
  const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/budget-app-db';
  try {
    // Attempt standard connection with 2s timeout
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 2000
    });
    console.log('MongoDB connected successfully to:', mongoURI);
    
    // Seed initial data if DB is empty
    await seedInitialData();
  } catch (error) {
    console.warn('\n================================================================');
    console.warn('WARNING: Could not connect to MongoDB server.');
    console.warn('Reason:', error.message);
    console.warn('ACTIVATING: Transparent In-Memory Mock Database Fallback!');
    console.warn('================================================================\n');
    
    isMockMode = true;
    setupMockDatabase();
    await seedInitialData();
  }
}

function makeDocument(data, listName) {
  if (!data) return null;
  const doc = JSON.parse(JSON.stringify(data));
  doc._id = doc._id ? new mongoose.Types.ObjectId(doc._id.toString()) : new mongoose.Types.ObjectId();
  
  doc.save = async function(opts = {}) {
    let list = listName === 'accounts' ? accountsData : listName === 'categories' ? categoriesData : transactionsData;
    const idx = list.findIndex(item => item._id.toString() === doc._id.toString());
    
    // Keep dual fields in sync
    if (listName === 'accounts') {
      doc.actualBankBalance = doc.balance;
    }
    if (listName === 'categories') {
      doc.allocatedBalance = doc.currentAllocatedBalance;
    }
    if (listName === 'transactions') {
      if (doc.sourceCategory && !doc.sourceBucketId) doc.sourceBucketId = doc.sourceCategory;
      if (doc.sourceBucketId && !doc.sourceCategory) doc.sourceCategory = doc.sourceBucketId;
      if (doc.destCategory && !doc.destinationBucketId) doc.destinationBucketId = doc.destCategory;
      if (doc.destinationBucketId && !doc.destCategory) doc.destCategory = doc.destinationBucketId;
      if (doc.sourceAccount && !doc.sourceAccountId) doc.sourceAccountId = doc.sourceAccount;
      if (doc.sourceAccountId && !doc.sourceAccount) doc.sourceAccount = doc.sourceAccountId;
      if (doc.destAccount && !doc.destinationAccountId) doc.destinationAccountId = doc.destAccount;
      if (doc.destinationAccountId && !doc.destAccount) doc.destAccount = doc.destinationAccountId;
      if (doc.date && !doc.timestamp) doc.timestamp = doc.date;
      if (doc.timestamp && !doc.date) doc.date = doc.timestamp;
      if (doc.cycleString && !doc.billingCycle) doc.billingCycle = doc.cycleString;
      if (doc.billingCycle && !doc.cycleString) doc.cycleString = doc.billingCycle;
    }

    if (idx >= 0) {
      list[idx] = JSON.parse(JSON.stringify(doc));
    } else {
      list.push(JSON.parse(JSON.stringify(doc)));
    }
    return makeDocument(doc, listName);
  };

  doc.populate = function() {
    return this;
  };
  doc.session = function() {
    return this;
  };

  return doc;
}

function setupMockDatabase() {
  // Override Account operations
  Account.find = async function() {
    return accountsData.map(a => makeDocument(a, 'accounts'));
  };
  
  Account.findById = function(id) {
    const item = accountsData.find(a => a._id.toString() === id.toString());
    const doc = makeDocument(item, 'accounts');
    const p = Promise.resolve(doc);
    p.session = function() { return p; };
    return p;
  };

  Account.findOne = function(query) {
    const item = accountsData.find(a => {
      for (let key in query) {
        if (a[key] !== query[key]) return false;
      }
      return true;
    });
    const doc = makeDocument(item, 'accounts');
    const p = Promise.resolve(doc);
    p.session = function() { return p; };
    return p;
  };
  
  Account.countDocuments = async function() {
    return accountsData.length;
  };
  
  Account.create = async function(data) {
    const doc = makeDocument(data, 'accounts');
    accountsData.push(JSON.parse(JSON.stringify(doc)));
    return doc;
  };
  
  Account.deleteMany = async function() {
    accountsData = [];
  };

  // Override Category operations
  Category.find = function() {
    const populated = categoriesData.map(c => {
      const doc = makeDocument(c, 'categories');
      if (c.parentAccount) {
        doc.parentAccount = accountsData.find(a => a._id.toString() === c.parentAccount.toString());
      }
      if (c.subBucketParent) {
        doc.subBucketParent = categoriesData.find(parent => parent._id.toString() === c.subBucketParent.toString());
      }
      return doc;
    });

    const p = Promise.resolve(populated);
    p.populate = function() { return p; };
    return p;
  };

  Category.findById = function(id) {
    const item = categoriesData.find(c => c._id.toString() === id.toString());
    const doc = makeDocument(item, 'categories');
    if (doc && item.parentAccount) {
      doc.parentAccount = makeDocument(accountsData.find(a => a._id.toString() === item.parentAccount.toString()), 'accounts');
    }
    const p = Promise.resolve(doc);
    p.populate = function() { return p; };
    p.session = function() { return p; };
    return p;
  };

  Category.findOne = function(query) {
    let item;
    if (query && query['meta.subBucketTag']) {
      item = categoriesData.find(c => c.meta && c.meta.subBucketTag === query['meta.subBucketTag']);
    } else {
      item = categoriesData.find(c => {
        for (let key in query) {
          if (c[key] !== query[key]) return false;
        }
        return true;
      });
    }
    const doc = makeDocument(item, 'categories');
    const p = Promise.resolve(doc);
    p.session = function() { return p; };
    return p;
  };

  Category.countDocuments = async function() {
    return categoriesData.length;
  };

  Category.create = async function(data) {
    const doc = makeDocument(data, 'categories');
    categoriesData.push(JSON.parse(JSON.stringify(doc)));
    return doc;
  };

  Category.deleteMany = async function() {
    categoriesData = [];
  };

  Category.deleteOne = async function(query) {
    const id = query._id ? query._id.toString() : null;
    if (id) {
      categoriesData = categoriesData.filter(c => c._id.toString() !== id);
    }
    return { deletedCount: 1 };
  };

  Account.deleteOne = async function(query) {
    const id = query._id ? query._id.toString() : null;
    if (id) {
      accountsData = accountsData.filter(a => a._id.toString() !== id);
    }
    return { deletedCount: 1 };
  };

  Transaction.deleteOne = async function(query) {
    const id = query._id ? query._id.toString() : null;
    if (id) {
      transactionsData = transactionsData.filter(t => t._id.toString() !== id);
    }
    return { deletedCount: 1 };
  };

  // Override Transaction operations
  Transaction.find = function(query) {
    let filtered = [...transactionsData];
    if (query && query.cycleString) {
      filtered = filtered.filter(tx => tx.cycleString === query.cycleString);
    }
    if (query && query.sourceCategory) {
      filtered = filtered.filter(tx => tx.sourceCategory && tx.sourceCategory.toString() === query.sourceCategory.toString());
    }

    const populated = filtered.map(tx => {
      const doc = makeDocument(tx, 'transactions');
      if (tx.sourceCategory) {
        doc.sourceCategory = categoriesData.find(c => c._id.toString() === tx.sourceCategory.toString());
      }
      if (tx.destCategory) {
        doc.destCategory = categoriesData.find(c => c._id.toString() === tx.destCategory.toString());
      }
      if (tx.sourceAccount) {
        doc.sourceAccount = accountsData.find(a => a._id.toString() === tx.sourceAccount.toString());
      }
      if (tx.destAccount) {
        doc.destAccount = accountsData.find(a => a._id.toString() === tx.destAccount.toString());
      }
      return doc;
    });

    const p = Promise.resolve(populated);
    p.populate = function() { return p; };
    p.sort = function() { return p; };
    p.session = function() { return p; };
    return p;
  };

  Transaction.findOne = function(query) {
    const item = transactionsData.find(t => {
      for (let key in query) {
        if (t[key] !== query[key]) return false;
      }
      return true;
    });
    const doc = makeDocument(item, 'transactions');
    // populate references if found
    if (doc && item) {
      if (item.sourceCategory) {
        doc.sourceCategory = categoriesData.find(c => c._id.toString() === item.sourceCategory.toString());
      }
      if (item.destCategory) {
        doc.destCategory = categoriesData.find(c => c._id.toString() === item.destCategory.toString());
      }
      if (item.sourceAccount) {
        doc.sourceAccount = accountsData.find(a => a._id.toString() === item.sourceAccount.toString());
      }
      if (item.destAccount) {
        doc.destAccount = accountsData.find(a => a._id.toString() === item.destAccount.toString());
      }
    }
    const p = Promise.resolve(doc);
    p.session = function() { return p; };
    return p;
  };
  
  Transaction.create = async function(data) {
    const doc = makeDocument(data, 'transactions');
    transactionsData.push(JSON.parse(JSON.stringify(doc)));
    return doc;
  };

  Transaction.deleteMany = async function() {
    transactionsData = [];
  };
  
  Transaction.prototype.save = async function(opts = {}) {
    const doc = makeDocument(this, 'transactions');
    transactionsData.push(JSON.parse(JSON.stringify(doc)));
    return doc;
  };
}

async function seedInitialData() {
  const bankAExists = isMockMode 
    ? accountsData.some(a => a.type === 'INCOME_VAULT')
    : await Account.findOne({ type: 'INCOME_VAULT' });
  const bankBExists = isMockMode 
    ? accountsData.some(a => a.type === 'EXPENSE_WALLET')
    : await Account.findOne({ type: 'EXPENSE_WALLET' });
    
  if (bankAExists && bankBExists) {
    console.log('Database already populated with core accounts. Skipping seeding.');
    return;
  }

  console.log('Core accounts missing. Clearing database and seeding initial accounts and categories...');

  if (!isMockMode) {
    await Account.deleteMany({});
    await Category.deleteMany({});
    await Transaction.deleteMany({});
  } else {
    accountsData = [];
    categoriesData = [];
    transactionsData = [];
  }

  // 1. Create Core Accounts
  const bankA = await Account.create({
    name: 'Bank A (Income Vault)',
    type: 'INCOME_VAULT',
    balance: 0,
    actualBankBalance: 0
  });

  const bankB = await Account.create({
    name: 'Bank B (Expense Wallet)',
    type: 'EXPENSE_WALLET',
    balance: 0,
    actualBankBalance: 0
  });

  console.log('Seeded Accounts successfully.');

  // 2. Create Core Categories
  // Bank 1 (Income Vault) Permanent Categories
  await Category.create({
    name: 'Emergency Bucket',
    type: 'EMERGENCY_FUND',
    parentAccount: bankA._id,
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 0,
    isPermanent: true,
    systemRole: 'emergency',
    modelType: 'BUCKET'
  });

  await Category.create({
    name: 'Investment Bucket',
    type: 'INVESTMENT',
    parentAccount: bankA._id,
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 0,
    isPermanent: true,
    systemRole: 'investment',
    modelType: 'BUCKET'
  });

  await Category.create({
    name: 'Bank 1 Free Spend',
    type: 'INCOME',
    parentAccount: bankA._id,
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 0,
    isPermanent: true,
    systemRole: 'b1_free_spend',
    modelType: 'BUCKET'
  });

  // Bank 1 Allowed Custom Bucket
  await Category.create({
    name: 'Salary / Income Bucket',
    type: 'INCOME',
    parentAccount: bankA._id,
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 0,
    modelType: 'BUCKET'
  });

  // Bank 2 (Expense Wallet) Permanent Categories
  await Category.create({
    name: 'Monthly Expense Bucket',
    type: 'EXPENSE',
    parentAccount: bankB._id,
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 1000,
    isPermanent: true,
    systemRole: 'monthly_expense',
    modelType: 'BUCKET'
  });

  await Category.create({
    name: 'Bank 2 Free Spend',
    type: 'EXPENSE',
    parentAccount: bankB._id,
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 0,
    isPermanent: true,
    systemRole: 'b2_free_spend',
    modelType: 'BUCKET'
  });

  // External Expense Categories (modelType: EXPENSE_TRACKER)
  await Category.create({
    name: 'Groceries',
    type: 'EXPENSE',
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 500,
    modelType: 'EXPENSE_TRACKER',
    spent: 0
  });

  await Category.create({
    name: 'Rent & Utilities',
    type: 'EXPENSE',
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 1500,
    modelType: 'EXPENSE_TRACKER',
    spent: 0
  });

  await Category.create({
    name: 'Entertainment',
    type: 'EXPENSE',
    currentAllocatedBalance: 0,
    allocatedBalance: 0,
    monthlyBudgetLimit: 300,
    modelType: 'EXPENSE_TRACKER',
    spent: 0
  });

  console.log('Seeded Categories successfully.');
}
