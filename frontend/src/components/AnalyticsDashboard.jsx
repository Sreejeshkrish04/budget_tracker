import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  TrendingUp, 
  TrendingDown, 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  AlertCircle,
  DollarSign
} from 'lucide-react';
import { getBillingCycleRange, getCycleString } from '../utils/cycleHelper';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const API_BASE = 'http://localhost:5000/api';

const INCOME_COLORS = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#059669', '#10b981', '#34d399'];
const EXPENSE_COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4'];

export default function AnalyticsDashboard() {
  const [viewDate, setViewDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('cycle'); // 'cycle' or 'custom'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reportData, setReportData] = useState({
    cycleString: '',
    totalIncome: 0,
    totalExpense: 0,
    incomeBreakdown: [],
    expenseBreakdown: []
  });

  // Helper: Format date to local YYYY-MM-DD for HTML5 date inputs
  const formatDateToInputString = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const { startDate, endDate } = getBillingCycleRange(viewDate);
  const currentCycleString = getCycleString(viewDate);

  // Initialize custom start/end date states to match the initial cycle window
  const [customStartDate, setCustomStartDate] = useState(formatDateToInputString(startDate));
  const [customEndDate, setCustomEndDate] = useState(formatDateToInputString(endDate));

  // Sync custom start/end dates when changing the active cycle window
  useEffect(() => {
    if (viewMode === 'cycle') {
      setCustomStartDate(formatDateToInputString(startDate));
      setCustomEndDate(formatDateToInputString(endDate));
    }
  }, [startDate, endDate, viewMode]);

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

  const isDateRangeInvalid = viewMode === 'custom' && customStartDate && customEndDate && (new Date(customStartDate) > new Date(customEndDate));

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (viewMode === 'cycle') {
        params.cycleString = currentCycleString;
      } else {
        if (!customStartDate || !customEndDate || isDateRangeInvalid) {
          setLoading(false);
          return;
        }
        params.startDate = customStartDate;
        params.endDate = customEndDate;
      }

      const res = await axios.get(`${API_BASE}/analytics/report`, { params });
      setReportData(res.data);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to fetch analytics report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'custom' && (!customStartDate || !customEndDate || isDateRangeInvalid)) {
      setLoading(false);
      return;
    }
    fetchReport();
  }, [viewMode, currentCycleString, customStartDate, customEndDate, isDateRangeInvalid]);

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

  const netFlow = reportData.totalIncome - reportData.totalExpense;

  const hasValidCustomDates = viewMode === 'custom' && customStartDate && customEndDate && !isDateRangeInvalid;
  const showDashboardContent = viewMode === 'cycle' || hasValidCustomDates;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* View Mode Toggle Pill Switch */}
      <div className="flex justify-center mb-6">
        <div className="bg-slate-900/90 border border-slate-800 p-1 rounded-full flex items-center relative z-10 shadow-inner">
          <button
            onClick={() => setViewMode('cycle')}
            className={`px-6 py-2 rounded-full text-xs font-bold transition-all duration-300 uppercase tracking-wider flex items-center gap-2 ${
              viewMode === 'cycle'
                ? 'bg-gradient-to-r from-indigo-650 to-purple-650 text-white shadow-md active:scale-95'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Filter by Cycle
          </button>
          <button
            onClick={() => setViewMode('custom')}
            className={`px-6 py-2 rounded-full text-xs font-bold transition-all duration-300 uppercase tracking-wider flex items-center gap-2 ${
              viewMode === 'custom'
                ? 'bg-gradient-to-r from-indigo-650 to-purple-650 text-white shadow-md active:scale-95'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            Custom Date Range
          </button>
        </div>
      </div>

      {/* Navigation Widget */}
      <div className="glass-panel p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-indigo-400">
          <Calendar className="w-5 h-5" />
          <span className="font-semibold text-sm tracking-wide uppercase">
            {viewMode === 'cycle' ? 'Analytics Cycle Window' : 'Custom Date Range'}
          </span>
        </div>
        
        {viewMode === 'cycle' ? (
          <>
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
          </>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="flex items-center gap-2.5">
              <label className="text-xs font-semibold text-slate-450 uppercase tracking-wider font-mono">Start:</label>
              <input 
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="bg-slate-800 border border-slate-750 rounded-lg py-1.5 px-3 text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
            <div className="flex items-center gap-2.5">
              <label className="text-xs font-semibold text-slate-455 uppercase tracking-wider font-mono">End:</label>
              <input 
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="bg-slate-800 border border-slate-750 rounded-lg py-1.5 px-3 text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-all"
              />
            </div>
          </div>
        )}
      </div>

      {isDateRangeInvalid && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Start date cannot be after the end date. Please check your custom date range.</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!showDashboardContent ? (
        <div className="flex flex-col items-center justify-center p-20 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
          <Calendar className="w-12 h-12 text-slate-500 mb-4 animate-pulse" />
          <h4 className="text-base font-bold text-slate-300">Please select start and end dates</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            Choose a valid date range in the filters above to visualize income and expense analytics.
          </p>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center p-20 space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-650 border-t-indigo-400 rounded-full animate-spin"></div>
          <p className="text-slate-400 text-sm font-medium">Assembling Visual Analytics...</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Total Income */}
            <div className="glass-panel p-4 sm:p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-bl-full pointer-events-none group-hover:bg-emerald-500/10 transition-colors duration-300"></div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Income</span>
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-white">{formatCurrency(reportData.totalIncome)}</div>
            </div>

            {/* Total Expense */}
            <div className="glass-panel p-4 sm:p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-bl-full pointer-events-none group-hover:bg-red-500/10 transition-colors duration-300"></div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Expenses</span>
                <TrendingDown className="w-5 h-5 text-red-400" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-white">{formatCurrency(reportData.totalExpense)}</div>
            </div>

            {/* Net Flow */}
            <div className="glass-panel p-4 sm:p-6 relative overflow-hidden group col-span-1 sm:col-span-2 lg:col-span-1">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full pointer-events-none group-hover:bg-indigo-500/10 transition-colors duration-300"></div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Net Flow</span>
                <DollarSign className="w-5 h-5 text-indigo-400" />
              </div>
              <div className={`text-xl sm:text-2xl font-black ${netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {netFlow >= 0 ? '+' : ''}{formatCurrency(netFlow)}
              </div>
            </div>
          </div>

          {/* Dual Visualizer Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Income Breakdown Card */}
            <div className="glass-panel p-4 sm:p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" /> Income Breakdown by Bucket
                </h3>

                {reportData.incomeBreakdown.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30 min-h-[300px]">
                    <AlertCircle className="w-12 h-12 text-slate-500 mb-4 animate-pulse" />
                    <h4 className="text-base font-bold text-slate-300">No income logged for this cycle</h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Income transactions recorded in this cycle will automatically group and show here as a visual breakdown.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Recharts Pie Chart */}
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={reportData.incomeBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={4}
                            dataKey="amount"
                            nameKey="categoryName"
                          >
                            {reportData.incomeBreakdown.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={INCOME_COLORS[index % INCOME_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#0f172a', 
                              borderColor: '#1e293b', 
                              borderRadius: '12px', 
                              color: '#fff',
                              fontSize: '12px',
                              fontFamily: 'monospace'
                            }} 
                            formatter={(value) => [formatCurrency(value), 'Allocated']}
                          />
                          <Legend 
                            verticalAlign="bottom" 
                            height={44} 
                            formatter={(value) => <span className="text-[10px] sm:text-xs text-slate-350">{value}</span>} 
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Breakdown List Table */}
                    <div className="overflow-x-auto pt-4 border-t border-slate-850">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-850 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                            <th className="py-2 px-3">Target Bucket</th>
                            <th className="py-2 px-3 text-right">Amount</th>
                            <th className="py-2 px-3 text-right">Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 text-sm">
                          {reportData.incomeBreakdown.map((item, index) => {
                            const share = reportData.totalIncome > 0 ? ((item.amount / reportData.totalIncome) * 100).toFixed(1) : '0.0';
                            return (
                              <tr key={index} className="hover:bg-slate-900/10">
                                <td className="py-2.5 px-3 flex items-center gap-2">
                                  <span 
                                    className="w-3 h-3 rounded-full shrink-0" 
                                    style={{ backgroundColor: INCOME_COLORS[index % INCOME_COLORS.length] }}
                                  ></span>
                                  <span className="font-medium text-slate-200">{item.categoryName}</span>
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-slate-300">
                                  {formatCurrency(item.amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-450">
                                  {share}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Expense Breakdown Card */}
            <div className="glass-panel p-4 sm:p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-purple-400" /> Expense Breakdown by Category
                </h3>

                {reportData.expenseBreakdown.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30 min-h-[300px]">
                    <AlertCircle className="w-12 h-12 text-slate-500 mb-4 animate-pulse" />
                    <h4 className="text-base font-bold text-slate-300">No expenses logged for this cycle</h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Expenses recorded in this cycle will automatically group and show here as a visual breakdown.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Recharts Pie Chart */}
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={reportData.expenseBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={75}
                            paddingAngle={4}
                            dataKey="amount"
                            nameKey="categoryName"
                          >
                            {reportData.expenseBreakdown.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#0f172a', 
                              borderColor: '#1e293b', 
                              borderRadius: '12px', 
                              color: '#fff',
                              fontSize: '12px',
                              fontFamily: 'monospace'
                            }} 
                            formatter={(value) => [formatCurrency(value), 'Spent']}
                          />
                          <Legend 
                            verticalAlign="bottom" 
                            height={44} 
                            formatter={(value) => <span className="text-[10px] sm:text-xs text-slate-350">{value}</span>} 
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Breakdown List Table */}
                    <div className="overflow-x-auto pt-4 border-t border-slate-850">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-850 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                            <th className="py-2 px-3">Category Name</th>
                            <th className="py-2 px-3 text-right">Amount</th>
                            <th className="py-2 px-3 text-right">Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 text-sm">
                          {reportData.expenseBreakdown.map((item, index) => {
                            const share = reportData.totalExpense > 0 ? ((item.amount / reportData.totalExpense) * 100).toFixed(1) : '0.0';
                            return (
                              <tr key={index} className="hover:bg-slate-900/10">
                                <td className="py-2.5 px-3 flex items-center gap-2">
                                  <span 
                                    className="w-3 h-3 rounded-full shrink-0" 
                                    style={{ backgroundColor: EXPENSE_COLORS[index % EXPENSE_COLORS.length] }}
                                  ></span>
                                  <span className="font-medium text-slate-200">{item.categoryName}</span>
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-slate-300">
                                  {formatCurrency(item.amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-450">
                                  {share}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}
