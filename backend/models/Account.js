import mongoose from 'mongoose';

const AccountSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['INCOME_VAULT', 'EXPENSE_WALLET'],
    required: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0
  },
  actualBankBalance: {
    type: Number,
    required: true,
    default: 0
  }
}, {
  timestamps: true
});

// Middleware to keep balance and actualBankBalance synced
AccountSchema.pre('save', function (next) {
  if (this.isModified('balance')) {
    this.actualBankBalance = this.balance;
  } else if (this.isModified('actualBankBalance')) {
    this.balance = this.actualBankBalance;
  }
  next();
});

export default mongoose.model('Account', AccountSchema);
