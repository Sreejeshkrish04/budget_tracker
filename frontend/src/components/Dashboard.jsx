import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  TrendingUp, 
  TrendingDown, 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  Plus, 
  RefreshCw, 
  Wallet, 
  Layers, 
  Percent, 
  Compass, 
  DollarSign,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { getBillingCycleRange, getCycleString } from '../utils/cycleHelper';
import AnalyticsDashboard from './AnalyticsDashboard';

const API_BASE = 'http://localhost:5000/api';

const getLocalDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function Dashboard() {
  // Date State for cycle shifting
  const [viewDate, setViewDate] = useState(new Date());
  
  // Navigation View State ('budget' or 'analytics')
  const [currentView, setCurrentView] = useState('budget');
  
  // App Data State
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Inline Bucket Management States
  const [addingBucketAccountId, setAddingBucketAccountId] = useState(null);
  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketHasTarget, setNewBucketHasTarget] = useState(false);
  const [newBucketTargetGoal, setNewBucketTargetGoal] = useState('');
  const [editingBucketId, setEditingBucketId] = useState(null);
  const [editBucketName, setEditBucketName] = useState('');
  const [editBucketHasTarget, setEditBucketHasTarget] = useState(false);
  const [editBucketTargetGoal, setEditBucketTargetGoal] = useState('');

  // Modal States
  const [showTxModal, setShowTxModal] = useState(false);
  const [showRedistributeModal, setShowRedistributeModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);

  // Form States - Transaction
  const [txForm, setTxForm] = useState({
    title: '',
    amount: '',
    type: 'EXPENSE', // EXPENSE, INCOME, TRANSFER
    sourceCategory: '', // Funding Source
    destCategory: '', // Target Category
    date: getLocalDateString()
  });

  // Form States - Sub-bucket Redistribution
  const [redistributeForm, setRedistributeForm] = useState({
    amount: '',
    sourceTag: 'free_spend',
    destTag: 'trip_1'
  });

  // Form States - New Savings Goal
  const [goalForm, setGoalForm] = useState({
    name: '',
    targetGoal: ''
  });

  // Form States - Category Manager
  const [newCatForm, setNewCatForm] = useState({
    name: '',
    type: 'EXPENSE',
    monthlyBudgetLimit: '',
    targetGoal: ''
  });
  const [editForm, setEditForm] = useState({
    name: '',
    monthlyBudgetLimit: '',
    targetGoal: ''
  });

  // Compute Cycle Range
  const { startDate, endDate } = getBillingCycleRange(viewDate);
  const currentCycleString = getCycleString(viewDate);

  // Global INR Currency Formatter Helper
  const formatCurrency = (amount) => {
    const val = Number(amount);
    if (isNaN(val)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  };

  // Format Date for Display
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Helper: Get categories belonging to a specific bank account
  const getAccountCategories = (accId) => {
    return categories.filter(c => {
      const parentId = c.parentAccount?._id || c.parentAccount;
      return parentId && parentId.toString() === accId.toString() && c.modelType === 'BUCKET';
    });
  };

  // Fetch Data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Accounts with cycleString query parameter
      const accountsRes = await axios.get(`${API_BASE}/accounts`, {
        params: { cycleString: currentCycleString }
      });
      setAccounts(accountsRes.data);

      // 2. Fetch Categories with cycleString query parameter
      const categoriesRes = await axios.get(`${API_BASE}/categories`, {
        params: { cycleString: currentCycleString }
      });
      setCategories(categoriesRes.data);

      // 3. Fetch Transactions for the cycle
      const txRes = await axios.get(`${API_BASE}/transactions`, {
        params: { cycleString: currentCycleString }
      });
      setTransactions(txRes.data);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to fetch financial data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentCycleString]);

  // Reset the transaction form date to local today's date when the modal is opened
  useEffect(() => {
    if (showTxModal) {
      setTxForm(prev => ({
        ...prev,
        date: getLocalDateString()
      }));
    }
  }, [showTxModal]);

  // Navigation handlers
  const handlePrevCycle = () => {
    setViewDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  };

  const handleNextCycle = () => {
    setViewDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  };

  const handleResetToCurrent = () => {
    setViewDate(new Date());
  };

  // Toast message helper
  const triggerToast = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Rollover Trigger Handler
  const handleRollover = async () => {
    if (!window.confirm(`Are you sure you want to trigger the Rollover Sweep for the cycle ${currentCycleString}? This will transfer remaining balances from expense budgets to Bank 2 Free Spend.`)) {
      return;
    }
    try {
      const res = await axios.post(`${API_BASE}/cycles/rollover`, {
        cycleString: currentCycleString
      });
      triggerToast(`Rollover complete! Swept ${formatCurrency(res.data.totalSweptAmount)} into Bank 2 Free Spend.`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Rollover failed.');
    }
  };

  // Post Transaction Handler
  const handleTxSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        title: txForm.title,
        amount: Number(txForm.amount),
        type: txForm.type,
        date: txForm.date,
        sourceCategory: txForm.type === 'INCOME' ? undefined : (txForm.sourceCategory || undefined),
        destCategory: txForm.destCategory || undefined
      };

      if (txForm.type === 'TRANSFER') {
        payload.sourceCategory = txForm.sourceCategory || undefined;
      }

      console.log("Sending Payload:", payload);

      await axios.post(`${API_BASE}/transactions`, payload);
      triggerToast('Transaction posted successfully!');
      setShowTxModal(false);
      // Reset Form
      setTxForm({
        title: '',
        amount: '',
        type: 'EXPENSE',
        sourceCategory: '',
        destCategory: '',
        date: getLocalDateString()
      });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to post transaction.');
    }
  };

  // Add Category Handler
  const handleAddCategorySubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/categories`, {
        name: newCatForm.name,
        type: 'EXPENSE',
        modelType: 'EXPENSE_TRACKER',
        monthlyBudgetLimit: Number(newCatForm.monthlyBudgetLimit) || 0
      });
      triggerToast(`Expense Category "${newCatForm.name}" created successfully!`);
      setShowAddCategoryModal(false);
      setNewCatForm({ name: '', type: 'EXPENSE', monthlyBudgetLimit: '', targetGoal: '' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create category.');
    }
  };

  // Inline edit saving
  const handleSaveInlineEdit = async (catId) => {
    if (!editBucketName.trim()) {
      alert('Bucket name cannot be empty');
      return;
    }
    try {
      await axios.put(`${API_BASE}/categories/${catId}`, {
        name: editBucketName,
        hasTarget: editBucketHasTarget,
        targetGoal: editBucketHasTarget ? (Number(editBucketTargetGoal) || 0) : 0
      });
      triggerToast('Bucket updated successfully!');
      setEditingBucketId(null);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update bucket.');
    }
  };

  // Inline create saving
  const handleCreateInlineBucket = async (accId, accType) => {
    if (!newBucketName.trim()) {
      alert('Bucket name cannot be empty');
      return;
    }
    try {
      const type = accType === 'INCOME_VAULT' ? 'INCOME' : 'EXPENSE';
      await axios.post(`${API_BASE}/categories`, {
        name: newBucketName,
        type,
        modelType: 'BUCKET',
        parentAccount: accId,
        hasTarget: newBucketHasTarget,
        targetGoal: newBucketHasTarget ? (Number(newBucketTargetGoal) || 0) : 0
      });
      triggerToast(`Bucket "${newBucketName}" created successfully!`);
      setAddingBucketAccountId(null);
      setNewBucketName('');
      setNewBucketHasTarget(false);
      setNewBucketTargetGoal('');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create bucket.');
    }
  };

  // Edit Category Handler
  const handleEditCategorySubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_BASE}/categories/${editingCategory._id}`, {
        name: editForm.name,
        monthlyBudgetLimit: Number(editForm.monthlyBudgetLimit) || 0,
        targetGoal: Number(editForm.targetGoal) || 0
      });
      triggerToast('Category updated successfully!');
      setEditingCategory(null);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update category.');
    }
  };

  // Delete Category Handler
  const handleDeleteCategory = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the custom category "${name}"? Remaining funds will sweep automatically into the respective bank's Free Spend bucket.`)) {
      return;
    }
    try {
      const res = await axios.delete(`${API_BASE}/categories/${id}`);
      triggerToast(res.data.message || 'Category deleted and swept.');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete category.');
    }
  };

  const handleStartEdit = (cat) => {
    setEditingCategory(cat);
    setEditForm({
      name: cat.name,
      monthlyBudgetLimit: cat.monthlyBudgetLimit || '',
      targetGoal: cat.targetGoal || ''
    });
  };



  // Redistribute sub-buckets Handler
  const handleRedistributeSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/subbuckets/redistribute`, {
        amount: Number(redistributeForm.amount),
        sourceTag: redistributeForm.sourceTag,
        destTag: redistributeForm.destTag
      });
      triggerToast(`Redistributed ${formatCurrency(redistributeForm.amount)} successfully!`);
      setShowRedistributeModal(false);
      setRedistributeForm({ amount: '', sourceTag: 'free_spend', destTag: 'trip_1' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Redistribution failed.');
    }
  };

  // Create Savings Goal handler
  const handleGoalSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/categories`, {
        name: goalForm.name,
        targetGoal: Number(goalForm.targetGoal)
      });
      triggerToast(`Savings Goal "${goalForm.name}" created!`);
      setShowGoalModal(false);
      setGoalForm({ name: '', targetGoal: '' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create goal.');
    }
  };

  // Delete Savings Goal handler (Deletion Sweep Protocol)
  const handleDeleteSubBucket = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the savings bucket "${name}"? Remaining funds will sweep automatically into the Free Spend bucket.`)) {
      return;
    }
    try {
      const res = await axios.delete(`${API_BASE}/categories/${id}`);
      triggerToast(res.data.message || 'Savings bucket deleted and swept.');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete bucket.');
    }
  };

  // Helper: Aggregate spending for a category in the current cycle
  const getCategorySpending = (catId) => {
    return transactions
      .filter(tx => tx.type === 'EXPENSE' && (tx.destCategory?._id === catId || tx.destinationBucketId === catId))
      .reduce((sum, tx) => sum + tx.amount, 0);
  };

  // Separate categories
  const expenseCategories = categories.filter(c => c.modelType === 'EXPENSE_TRACKER');
  const subBuckets = categories.filter(c => c.isSubBucket);

  // Dynamic dropdown logic: Filter funding sources based on chosen target category / type
  const getFundingSourceOptions = () => {
    return categories.filter(c => c.modelType === 'BUCKET');
  };

  const isTxFormInvalid = () => {
    if (txForm.type === 'TRANSFER') {
      if (!txForm.sourceCategory || !txForm.destCategory) return true;
      if (txForm.sourceCategory === txForm.destCategory) return true;
      
      const srcBucket = categories.find(c => c._id === txForm.sourceCategory);
      if (srcBucket && txForm.amount && srcBucket.currentAllocatedBalance < Number(txForm.amount)) {
        return true;
      }
    }
    return false;
  };

  // Calculation of Base balance metrics
  const totalBankBalance = accounts.reduce((sum, acc) => sum + (acc.actualBankBalance || 0), 0);
  const totalFreeSpend = categories
    .filter(c => {
      const nameMatch = c.name && c.name.toLowerCase().includes('free spend');
      const roleMatch = c.systemRole === 'b1_free_spend' || c.systemRole === 'b2_free_spend';
      return (nameMatch || roleMatch) && c.modelType === 'BUCKET';
    })
    .reduce((sum, c) => sum + (c.currentAllocatedBalance || 0), 0);
  const baseBalance = totalBankBalance - totalFreeSpend;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 relative">
      
      {/* Toast Notification */}
      {successMsg && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-emerald-500 text-white px-4 py-3 rounded-xl shadow-2xl shadow-emerald-500/20 border border-emerald-400/30 animate-bounce">
          <TrendingUp className="w-5 h-5" />
          <span className="font-semibold text-sm">{successMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 w-full">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent">
            VaultFlow
          </h1>
          <p className="text-slate-450 text-xs sm:text-sm mt-1">Multi-Bucket Personal Ledger & Rollover Engine</p>
        </div>
        
        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3">
          <button
            onClick={() => setShowTxModal(true)}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-base sm:text-sm px-4 h-12 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-600/20 active:scale-95"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>

          <button
            onClick={handleRollover}
            className="flex items-center justify-center gap-2 bg-purple-900/60 hover:bg-purple-950/80 text-purple-200 border border-purple-800/60 font-semibold text-base sm:text-sm px-4 h-12 rounded-xl transition-all duration-200"
          >
            <RefreshCw className="w-4 h-4" /> Sweep Rollover
          </button>
        </div>
      </div>

      {/* View Selector Tabs */}
      <div className="flex border-b border-slate-800 mb-6 w-full">
        <button
          onClick={() => setCurrentView('budget')}
          className={`flex-1 py-3.5 px-4 text-center text-base sm:text-sm font-semibold border-b-2 transition-all ${
            currentView === 'budget'
              ? 'border-indigo-500 text-white font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Budget Planner
        </button>
        <button
          onClick={() => setCurrentView('analytics')}
          className={`flex-1 py-3.5 px-4 text-center text-base sm:text-sm font-semibold border-b-2 transition-all ${
            currentView === 'analytics'
              ? 'border-indigo-500 text-white font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Visual Analytics
        </button>
      </div>

      {currentView === 'budget' ? (
        <>
          {/* Cycle Navigation Widget */}
      <div className="glass-panel p-4 mb-8 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-indigo-400">
          <Calendar className="w-5 h-5" />
          <span className="font-semibold text-sm tracking-wide uppercase">Cycle Window</span>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={handlePrevCycle}
            className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-800"
            title="Previous Cycle"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="text-center">
            <div className="font-bold text-base text-white">
              {formatDate(startDate)} &ndash; {formatDate(endDate)}
            </div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              ID: {currentCycleString}
            </div>
          </div>
          
          <button 
            onClick={handleNextCycle}
            className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-800"
            title="Next Cycle"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div>
          <button
            onClick={handleResetToCurrent}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline"
          >
            Jump to Today
          </button>
        </div>
      </div>

      {/* Base Balance Metric Container */}
      <div className="w-full bg-gradient-to-r from-slate-900/90 to-indigo-950/40 backdrop-blur-md rounded-2xl p-5 sm:p-6 mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-slate-800/80 shadow-xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-bl-full pointer-events-none group-hover:bg-indigo-500/10 transition-colors duration-300"></div>
        <div>
          <div className="flex items-center gap-2 text-indigo-400 mb-1">
            <Layers className="w-4 h-4" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">Metrics</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Base</h2>
          <p className="text-slate-400 text-xs mt-0.5">Total bank balance minus Free Spend buckets</p>
        </div>
        <div className="text-left sm:text-right w-full sm:w-auto border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0">
          <div className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-150 to-indigo-350 tracking-tight">
            {formatCurrency(baseBalance)}
          </div>
          <div className="text-[10px] sm:text-xs text-slate-500 font-medium mt-1">
            Allocated: {formatCurrency(totalFreeSpend)} / Total: {formatCurrency(totalBankBalance)}
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {accounts.map(acc => {
          const accCategories = getAccountCategories(acc._id);
          const calculatedBankTotal = accCategories.reduce((sum, bucket) => sum + (bucket.currentAllocatedBalance || 0), 0);
          return (
            <div key={acc._id} className="glass-panel p-4 sm:p-6 relative overflow-hidden group flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-bl-full pointer-events-none group-hover:bg-indigo-500/20 transition-colors duration-300"></div>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] sm:text-xs font-semibold tracking-wider text-slate-400 uppercase bg-slate-950/60 px-2.5 py-1 rounded-full border border-slate-800">
                    {acc.type === 'INCOME_VAULT' ? 'Bank 1 (Income Vault)' : 'Bank 2 (Expense Wallet)'}
                  </span>
                  <Wallet className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="text-xs sm:text-sm font-semibold text-slate-400">{acc.name}</h3>
                <div className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-1">
                  {formatCurrency(calculatedBankTotal)}
                </div>

                 {/* Visual Breakdown of Internal Buckets */}
                <div className="mt-6 border-t border-slate-850 pt-4 space-y-2 relative z-10">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Internal Buckets</h4>
                  </div>
                  {accCategories.length === 0 ? (
                    <p className="text-xs text-slate-650 italic">No buckets mapped to this bank.</p>
                  ) : (
                    accCategories.map(cat => {
                      const isEditing = editingBucketId === cat._id;
                      return (
                        <div key={cat._id} className="flex justify-between items-center text-xs py-1.5 px-2.5 rounded-lg bg-slate-950/40 border border-slate-800/40">
                          {isEditing ? (
                            <div className="flex flex-col gap-2 w-full py-1">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editBucketName}
                                  onChange={e => setEditBucketName(e.target.value)}
                                  className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-0.5 w-full text-xs focus:outline-none focus:border-indigo-500"
                                  autoFocus
                                />
                              </div>
                              <div className="flex items-center gap-2 text-slate-300">
                                <input
                                  type="checkbox"
                                  id={`edit-hasTarget-${cat._id}`}
                                  checked={editBucketHasTarget}
                                  onChange={e => {
                                    setEditBucketHasTarget(e.target.checked);
                                    if (!e.target.checked) setEditBucketTargetGoal('');
                                  }}
                                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                                />
                                <label htmlFor={`edit-hasTarget-${cat._id}`} className="text-[10px] font-semibold select-none cursor-pointer">
                                  Set a savings target
                                </label>
                              </div>
                              {editBucketHasTarget && (
                                <div>
                                  <input
                                    type="number"
                                    placeholder="Target Goal (₹)"
                                    value={editBucketTargetGoal}
                                    onChange={e => setEditBucketTargetGoal(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-0.5 w-full text-xs focus:outline-none focus:border-indigo-500"
                                  />
                                </div>
                              )}
                              <div className="flex justify-end gap-2 pt-1 border-t border-slate-800/60">
                                <button
                                  onClick={() => setEditingBucketId(null)}
                                  className="text-slate-400 hover:text-slate-350 font-bold px-2 py-0.5 text-xs"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleSaveInlineEdit(cat._id)}
                                  className="text-emerald-400 hover:text-emerald-350 font-bold px-2 py-0.5 text-xs"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200">{cat.name}</span>
                                {cat.isPermanent && (
                                  <span className="text-[9px] bg-indigo-500/15 text-indigo-300 font-bold px-1.5 py-0.5 rounded border border-indigo-500/20">
                                    System
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                {(() => {
                                  const balance = Number(cat.currentAllocatedBalance) || 0;
                                  const target = Number(cat.targetGoal) || 0;
                                  return cat.hasTarget ? (
                                    <span className={`font-bold ${balance < target ? 'text-red-400' : 'text-green-400'}`}>
                                      {formatCurrency(balance)} / {formatCurrency(target)}
                                    </span>
                                  ) : (
                                    <span className="font-bold text-slate-100">{formatCurrency(balance)}</span>
                                  );
                                })()}
                                  <div className="flex items-center gap-1.5 opacity-65 hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => {
                                        setEditingBucketId(cat._id);
                                        setEditBucketName(cat.name);
                                        setEditBucketHasTarget(cat.hasTarget || false);
                                        setEditBucketTargetGoal(cat.targetGoal || '');
                                      }}
                                      className="text-indigo-400 hover:text-indigo-300 text-[10px] font-bold"
                                      title="Edit bucket name"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDeleteCategory(cat._id, cat.name)}
                                      className="text-slate-500 hover:text-red-400"
                                      title={`Delete ${cat.name}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}

                  {/* Add Inline Custom Bucket Form */}
                  {addingBucketAccountId === acc._id ? (
                    <div className="mt-2.5 p-3 bg-slate-900/60 border border-slate-800 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Bucket Name"
                          value={newBucketName}
                          onChange={e => setNewBucketName(e.target.value)}
                          className="bg-slate-950 border border-slate-850 text-white rounded px-2 py-1 w-full text-xs focus:outline-none focus:border-indigo-500"
                          autoFocus
                        />
                      </div>
                      <div className="flex items-center gap-2 text-slate-300">
                        <input
                          type="checkbox"
                          id={`hasTarget-${acc._id}`}
                          checked={newBucketHasTarget}
                          onChange={e => {
                            setNewBucketHasTarget(e.target.checked);
                            if (!e.target.checked) setNewBucketTargetGoal('');
                          }}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <label htmlFor={`hasTarget-${acc._id}`} className="text-[10px] font-semibold select-none cursor-pointer">
                          Set a savings target
                        </label>
                      </div>
                      {newBucketHasTarget && (
                        <div>
                          <input
                            type="number"
                            placeholder="Target Goal (₹)"
                            value={newBucketTargetGoal}
                            onChange={e => setNewBucketTargetGoal(e.target.value)}
                            className="bg-slate-950 border border-slate-850 text-white rounded px-2 py-1 w-full text-xs focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      )}
                      <div className="flex justify-end gap-2 pt-1 border-t border-slate-800/60">
                        <button
                          onClick={() => setAddingBucketAccountId(null)}
                          className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-2 py-1"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleCreateInlineBucket(acc._id, acc.type)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAddingBucketAccountId(acc._id);
                        setNewBucketName('');
                        setNewBucketHasTarget(false);
                        setNewBucketTargetGoal('');
                      }}
                      className="w-full mt-2 py-1.5 border border-dashed border-slate-800 hover:border-slate-700 bg-slate-900/10 hover:bg-slate-900/40 text-slate-400 hover:text-slate-300 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Custom Bucket
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Split Layout: Categories & Cumulative savings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Targets & Categories (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" /> Category Budgets
            </h2>
          </div>

          {loading ? (
            <div className="glass-panel p-12 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-500" />
              Loading cycle records...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {expenseCategories.map(cat => {
                const spent = getCategorySpending(cat._id);
                const limit = cat.monthlyBudgetLimit;
                const percent = limit > 0 ? (spent / limit) * 100 : 0;
                
                // Determine styling classes based on budget conditions
                const isOverBudget = spent > limit;
                
                // USER SPECIFIED CLASSES FOR OVER/UNDER LIMIT
                const indicatorClasses = isOverBudget
                  ? 'text-red-600 bg-red-50 border-red-500'
                  : 'text-green-600 bg-green-50 border-green-500';

                return (
                  <div 
                    key={cat._id} 
                    className={`p-4 sm:p-5 rounded-xl border flex flex-col justify-between transition-all duration-300 ${indicatorClasses}`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <span className="font-bold text-sm sm:text-base leading-tight">{cat.name}</span>
                        <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-black/5 shrink-0">
                          Limit: {formatCurrency(limit)}
                        </span>
                      </div>
                      
                      <div className="text-xl sm:text-2xl font-extrabold tracking-tight mb-3">
                        {formatCurrency(spent)} <span className="text-xs font-normal opacity-85">spent</span>
                      </div>
                    </div>

                    <div>
                      {/* Progress Bar */}
                      <div className="w-full bg-black/10 rounded-full h-2 mb-2 overflow-hidden">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${isOverBudget ? 'bg-red-600' : 'bg-green-600'}`}
                          style={{ width: `${Math.min(100, percent)}%` }}
                        ></div>
                      </div>
                      
                      <div className="flex justify-between text-[11px] font-semibold opacity-85">
                        <span>{percent.toFixed(0)}% Cap</span>
                        <span>
                          {isOverBudget 
                            ? `Over by ${formatCurrency(spent - limit)}` 
                            : `Left: ${formatCurrency(limit - spent)}`
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Category Manager (1/3 width) */}
        <div>
          <div className="glass-panel p-4 sm:p-6 h-full flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-bl-full pointer-events-none"></div>
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-purple-400" /> Category Manager
                </h2>
              </div>

              {/* List of Categories in Manager */}
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                {categories.filter(c => c.modelType === 'EXPENSE_TRACKER').map(cat => {
                  const isPermanent = cat.isPermanent;
                  return (
                    <div key={cat._id} className={`p-4 border rounded-xl transition-all duration-300 ${
                      isPermanent ? 'border-slate-800 bg-slate-900/30' : 'border-indigo-500/20 bg-indigo-950/5'
                    }`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-sm text-slate-200 block">{cat.name}</span>
                          <span className="text-[10px] text-slate-400 uppercase font-mono block">
                            Type: {cat.type} | {isPermanent ? 'Permanent' : 'Custom'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleStartEdit(cat)}
                            className="text-indigo-400 hover:text-indigo-300 p-1 rounded text-xs transition-colors font-bold"
                            title="Edit"
                          >
                            Edit
                          </button>
                          {!isPermanent && (
                            <button
                              onClick={() => handleDeleteCategory(cat._id, cat.name)}
                              className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors"
                              title={`Delete ${cat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {cat.monthlyBudgetLimit > 0 && (
                        <div className="text-xs text-slate-400 mt-1 font-semibold">
                          Limit: {formatCurrency(cat.monthlyBudgetLimit)}
                        </div>
                      )}
                      {cat.targetGoal > 0 && (
                        <div className="text-xs text-slate-400 mt-1 font-semibold">
                          Goal: {formatCurrency(cat.targetGoal)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={() => setShowAddCategoryModal(true)}
                className="w-full bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-650 hover:to-indigo-650 text-white font-bold text-base sm:text-sm h-12 rounded-xl transition-all duration-200"
              >
                + Add Custom Category
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Transaction History Table */}
      <div className="glass-panel p-4 sm:p-6 mt-8">
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-400" /> Transaction Stream for Cycle
        </h2>

        {transactions.length === 0 ? (
          <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
            No transactions found in this billing cycle.
          </div>
        ) : (
          <>
            {/* Mobile Stacked Summary List (Visible only on mobile) */}
            <div className="space-y-3 sm:hidden">
              {transactions.map(tx => {
                let typeColor = 'text-indigo-400';
                if (tx.type === 'INCOME') typeColor = 'text-emerald-400';
                if (tx.type === 'EXPENSE') typeColor = 'text-red-400';

                return (
                  <div key={tx._id} className="p-3.5 bg-slate-900/40 border border-slate-800/60 rounded-xl flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0 flex-1 pr-2">
                        <h4 className="font-bold text-slate-100 text-sm truncate">{tx.title}</h4>
                        <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">{formatDate(tx.date)}</span>
                      </div>
                      <div className={`text-base font-black shrink-0 ${typeColor}`}>
                        {tx.type === 'EXPENSE' ? '-' : '+'}{formatCurrency(tx.amount)}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-800/40">
                      <span className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md ${
                        tx.type === 'INCOME' ? 'bg-emerald-500/10' : tx.type === 'EXPENSE' ? 'bg-red-500/10' : 'bg-indigo-500/10'
                      } ${typeColor}`}>
                        {tx.type}
                      </span>
                      <span className="text-slate-400 text-[10px] font-medium truncate max-w-[180px]">
                        {tx.sourceCategory ? tx.sourceCategory.name : '—'} &rarr; {tx.destCategory ? tx.destCategory.name : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (Hidden on mobile) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Title</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">From Bucket</th>
                    <th className="py-3 px-4">To Bucket</th>
                    <th className="py-3 px-4">Accounts Involved</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {transactions.map(tx => {
                    let typeColor = 'text-indigo-400';
                    if (tx.type === 'INCOME') typeColor = 'text-emerald-400';
                    if (tx.type === 'EXPENSE') typeColor = 'text-red-400';

                    return (
                      <tr key={tx._id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-100">{tx.title}</td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md ${
                            tx.type === 'INCOME' ? 'bg-emerald-500/10' : tx.type === 'EXPENSE' ? 'bg-red-500/10' : 'bg-indigo-500/10'
                          } ${typeColor}`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-medium">
                          {tx.sourceCategory ? tx.sourceCategory.name : <span className="text-slate-600">&mdash;</span>}
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-medium">
                          {tx.destCategory ? tx.destCategory.name : <span className="text-slate-600">&mdash;</span>}
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-xs">
                          {tx.sourceAccount && tx.destAccount 
                            ? `${tx.sourceAccount.name} → ${tx.destAccount.name}`
                            : tx.sourceAccount 
                              ? tx.sourceAccount.name 
                              : tx.destAccount 
                                ? tx.destAccount.name 
                                : <span className="text-slate-600">Virtual Category only</span>
                          }
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-xs font-mono">{formatDate(tx.date)}</td>
                        <td className={`py-3 px-4 text-right font-black text-base ${typeColor}`}>
                          {tx.type === 'EXPENSE' ? '-' : '+'}{formatCurrency(tx.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      </>
      ) : (
        <AnalyticsDashboard />
      )}

      {/* ======================================================== */}
      {/* RECORD TRANSACTION MODAL */}
      {/* ======================================================== */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-900 border-t sm:border border-slate-800 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
            {/* Visual Drag Handle for Mobile bottom sheet */}
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mx-auto my-3 sm:hidden shrink-0" />
            
            <div className="p-4 sm:p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-base sm:text-lg font-bold text-white">Record Transaction</h3>
              <button 
                onClick={() => setShowTxModal(false)}
                className="text-slate-400 hover:text-white font-bold text-lg p-1"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={handleTxSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              {/* Type Select */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Transaction Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {['EXPENSE', 'INCOME', 'TRANSFER'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTxForm(prev => ({ ...prev, type: t, sourceCategory: '', destCategory: '' }))}
                      className={`h-12 px-3 rounded-lg font-bold text-sm sm:text-xs border text-center transition-all ${
                        txForm.type === t 
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/10'
                          : 'bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={txForm.title}
                    onChange={e => setTxForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. Salary Credit"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={txForm.amount}
                    onChange={e => setTxForm(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. 50000"
                  />
                </div>
              </div>

              {/* Transaction Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={txForm.date}
                  onChange={e => setTxForm(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* EXPENSE: target category dropdown & DYNAMIC source funding vector */}
              {txForm.type === 'EXPENSE' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Expense Category (Target)</label>
                    <select
                      required
                      value={txForm.destCategory}
                      onChange={e => setTxForm(prev => ({ ...prev, destCategory: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                    >
                      <option value="" disabled>Select Target Category</option>
                      {categories
                        .filter(c => c.modelType === 'EXPENSE_TRACKER')
                        .map(c => (
                          <option key={c._id} value={c._id}>{c.name} (Limit: {formatCurrency(c.monthlyBudgetLimit)})</option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                      Funding Source (Dynamic Dropdown)
                    </label>
                    <select
                      required
                      value={txForm.sourceCategory}
                      onChange={e => setTxForm(prev => ({ ...prev, sourceCategory: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                    >
                      <option value="" disabled>Select Funding Source</option>
                      {accounts.map(acc => {
                        const accBuckets = getFundingSourceOptions().filter(c => {
                          const pId = c.parentAccount?._id || c.parentAccount;
                          return pId && pId.toString() === acc._id.toString();
                        });
                        if (accBuckets.length === 0) return null;
                        return (
                          <optgroup key={acc._id} label={acc.name}>
                            {accBuckets.map(c => {
                              const isInsufficient = txForm.amount && c.currentAllocatedBalance < Number(txForm.amount);
                              return (
                                <option 
                                  key={c._id} 
                                  value={c._id} 
                                  disabled={isInsufficient}
                                >
                                  {c.name} (Available: {formatCurrency(c.currentAllocatedBalance)}) {isInsufficient ? '[INSUFFICIENT FUNDS]' : ''}
                                </option>
                              );
                            })}
                          </optgroup>
                        );
                      })}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Options reflect virtual bucket balances. Sources with insufficient balance are disabled based on the input amount.
                    </p>
                  </div>
                </>
              )}

              {/* INCOME: Destination Category */}
              {txForm.type === 'INCOME' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Destination Category (Bucket)</label>
                  <select
                    required
                    value={txForm.destCategory}
                    onChange={e => setTxForm(prev => ({ ...prev, destCategory: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="" disabled>Select Target Bucket</option>
                    {accounts.map(acc => {
                      const accBuckets = categories.filter(c => {
                        const pId = c.parentAccount?._id || c.parentAccount;
                        return c.modelType === 'BUCKET' && pId && pId.toString() === acc._id.toString();
                      });
                      if (accBuckets.length === 0) return null;
                      return (
                        <optgroup key={acc._id} label={acc.name}>
                          {accBuckets.map(c => (
                            <option key={c._id} value={c._id}>
                              {c.name} ({formatCurrency(c.currentAllocatedBalance)})
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* TRANSFER: Source Category & Destination Category */}
              {txForm.type === 'TRANSFER' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Source Category (From)</label>
                    <select
                      required
                      value={txForm.sourceCategory}
                      onChange={e => setTxForm(prev => ({ ...prev, sourceCategory: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                    >
                      <option value="" disabled>Select Source Bucket</option>
                      {accounts.map(acc => {
                        const accBuckets = categories.filter(c => {
                          const pId = c.parentAccount?._id || c.parentAccount;
                          return c.modelType === 'BUCKET' && pId && pId.toString() === acc._id.toString();
                        });
                        if (accBuckets.length === 0) return null;
                        return (
                          <optgroup key={acc._id} label={acc.name}>
                            {accBuckets.map(c => (
                              <option key={c._id} value={c._id}>
                                {c.name} (Avail: {formatCurrency(c.currentAllocatedBalance)})
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Destination Category (To)</label>
                    <select
                      required
                      value={txForm.destCategory}
                      onChange={e => setTxForm(prev => ({ ...prev, destCategory: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                    >
                      <option value="" disabled>Select Target Bucket</option>
                      {accounts.map(acc => {
                        const accBuckets = categories.filter(c => {
                          const pId = c.parentAccount?._id || c.parentAccount;
                          return c.modelType === 'BUCKET' && pId && pId.toString() === acc._id.toString();
                        });
                        if (accBuckets.length === 0) return null;
                        return (
                          <optgroup key={acc._id} label={acc.name}>
                            {accBuckets.map(c => (
                              <option key={c._id} value={c._id}>
                                {c.name} (Avail: {formatCurrency(c.currentAllocatedBalance)})
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isTxFormInvalid()}
                  className={`w-full font-bold text-base sm:text-sm h-12 rounded-lg shadow-lg transition-all ${
                    isTxFormInvalid()
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white active:scale-95'
                  }`}
                >
                  Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* ======================================================== */}
      {/* ADD CUSTOM CATEGORY MODAL */}
      {/* ======================================================== */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-900 border-t sm:border border-slate-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
            {/* Visual Drag Handle for Mobile bottom sheet */}
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mx-auto my-3 sm:hidden shrink-0" />
            
            <div className="p-4 sm:p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-base sm:text-lg font-bold text-white">Create Expense Category Tracker</h3>
              <button 
                onClick={() => setShowAddCategoryModal(false)}
                className="text-slate-400 hover:text-white font-bold text-lg p-1"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={handleAddCategorySubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  value={newCatForm.name}
                  onChange={e => setNewCatForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Groceries, Rent, Dining Out"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Monthly Budget Limit (₹)</label>
                <input
                  type="number"
                  required
                  value={newCatForm.monthlyBudgetLimit}
                  onChange={e => setNewCatForm(prev => ({ ...prev, monthlyBudgetLimit: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. 5000"
                />
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base sm:text-sm h-12 rounded-lg shadow-lg"
                >
                  Create Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* EDIT CATEGORY MODAL */}
      {/* ======================================================== */}
      {editingCategory && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-900 border-t sm:border border-slate-800 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
            {/* Visual Drag Handle for Mobile bottom sheet */}
            <div className="w-12 h-1.5 bg-slate-800 rounded-full mx-auto my-3 sm:hidden shrink-0" />
            
            <div className="p-4 sm:p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <h3 className="text-base sm:text-lg font-bold text-white">Edit Category: {editingCategory.name}</h3>
              <button 
                onClick={() => setEditingCategory(null)}
                className="text-slate-400 hover:text-white font-bold text-lg p-1"
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={handleEditCategorySubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              {editingCategory.type === 'EXPENSE' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Monthly Budget Limit (₹)</label>
                  <input
                    type="number"
                    value={editForm.monthlyBudgetLimit}
                    onChange={e => setEditForm(prev => ({ ...prev, monthlyBudgetLimit: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Target Savings Goal (₹)</label>
                  <input
                    type="number"
                    value={editForm.targetGoal}
                    onChange={e => setEditForm(prev => ({ ...prev, targetGoal: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-800 rounded-lg h-12 px-4 text-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base sm:text-sm h-12 rounded-lg shadow-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
