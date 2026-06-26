import mongoose from 'mongoose';

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true // INCOME, EXPENSE, INVESTMENT, EMERGENCY_FUND, CUMULATIVE_SAVINGS
  },
  parentAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: false
  },
  currentAllocatedBalance: {
    type: Number,
    required: true,
    default: 0
  },
  allocatedBalance: {
    type: Number,
    required: true,
    default: 0
  },
  monthlyBudgetLimit: {
    type: Number,
    required: true,
    default: 0
  },
  targetGoal: {
    type: Number,
    required: false,
    default: 0
  },
  hasTarget: {
    type: Boolean,
    default: false
  },
  isSubBucket: {
    type: Boolean,
    default: false
  },
  subBucketParent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: false
  },
  isTargetedSavings: {
    type: Boolean,
    default: false
  },
  isPermanent: {
    type: Boolean,
    default: false
  },
  systemRole: {
    type: String,
    enum: ['emergency', 'investment', 'b1_free_spend', 'monthly_expense', 'b2_free_spend', null],
    default: null
  },
  modelType: {
    type: String,
    enum: ['BUCKET', 'EXPENSE_TRACKER'],
    default: 'BUCKET'
  },
  spent: {
    type: Number,
    default: 0
  },
  meta: {
    isCumulativeSubBucket: {
      type: Boolean,
      default: false
    },
    subBucketTag: {
      type: String, // e.g., "trip_1", "trip_2", "free_spend"
      default: null
    }
  }
}, {
  timestamps: true
});

// Sync allocatedBalance and currentAllocatedBalance
CategorySchema.pre('save', function (next) {
  if (this.isModified('currentAllocatedBalance')) {
    this.allocatedBalance = this.currentAllocatedBalance;
  } else if (this.isModified('allocatedBalance')) {
    this.currentAllocatedBalance = this.allocatedBalance;
  }
  next();
});

export default mongoose.model('Category', CategorySchema);
