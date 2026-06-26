import mongoose from 'mongoose';

const TransactionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['INCOME', 'EXPENSE', 'TRANSFER', 'VIRTUAL_TRANSFER', 'REAL_TRANSFER'],
    required: true
  },
  // Core Spec ids
  sourceCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: false
  },
  destCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: false
  },
  sourceAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: false
  },
  destAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: false
  },
  // SRD ids
  sourceBucketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: false
  },
  destinationBucketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: false
  },
  sourceAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: false
  },
  destinationAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: false
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  cycleString: {
    type: String,
    required: true
  },
  billingCycle: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Middleware to keep the dual specification systems synchronized
TransactionSchema.pre('save', function (next) {
  // Sync categories
  if (this.sourceCategory && !this.sourceBucketId) this.sourceBucketId = this.sourceCategory;
  if (this.sourceBucketId && !this.sourceCategory) this.sourceCategory = this.sourceBucketId;
  
  if (this.destCategory && !this.destinationBucketId) this.destinationBucketId = this.destCategory;
  if (this.destinationBucketId && !this.destCategory) this.destCategory = this.destinationBucketId;

  // Sync accounts
  if (this.sourceAccount && !this.sourceAccountId) this.sourceAccountId = this.sourceAccount;
  if (this.sourceAccountId && !this.sourceAccount) this.sourceAccount = this.sourceAccountId;

  if (this.destAccount && !this.destinationAccountId) this.destinationAccountId = this.destAccount;
  if (this.destinationAccountId && !this.destAccount) this.destAccount = this.destinationAccountId;

  // Sync date/timestamp
  if (this.date && !this.timestamp) this.timestamp = this.date;
  if (this.timestamp && !this.date) this.date = this.timestamp;

  // Sync cycles
  if (this.cycleString && !this.billingCycle) this.billingCycle = this.cycleString;
  if (this.billingCycle && !this.cycleString) this.cycleString = this.billingCycle;

  next();
});

export default mongoose.model('Transaction', TransactionSchema);
