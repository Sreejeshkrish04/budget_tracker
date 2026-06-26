import Transaction from '../models/Transaction.js';

/**
 * Returns visual analytics data for a specific cycleString.
 * GET /api/analytics/report?cycleString=YYYY-MM-26_NX
 */
export async function getAnalyticsReport(req, res) {
  try {
    const { cycleString, startDate, endDate } = req.query;

    let matchCriteria = {};
    if (cycleString) {
      matchCriteria = { cycleString: cycleString };
    } else if (startDate && endDate) {
      // Parse YYYY-MM-DD input and build exact local timezone boundaries
      const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
      const localStart = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);

      const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
      const localEnd = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);

      if (isNaN(localStart.getTime()) || isNaN(localEnd.getTime())) {
        return res.status(400).json({ error: 'Invalid startDate or endDate format. Use YYYY-MM-DD.' });
      }

      matchCriteria = {
        date: {
          $gte: localStart,
          $lte: localEnd
        }
      };
    } else {
      return res.status(400).json({ error: 'Either cycleString or both startDate and endDate query parameters are required' });
    }

    // 1. Calculate Total Income
    const incomeAggregation = await Transaction.aggregate([
      {
        $match: {
          ...matchCriteria,
          type: 'INCOME'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);
    const totalIncome = incomeAggregation.length > 0 ? incomeAggregation[0].total : 0;

    // 2. Calculate Income Breakdown
    const incomeBreakdown = await Transaction.aggregate([
      {
        $match: {
          ...matchCriteria,
          type: 'INCOME'
        }
      },
      {
        $group: {
          _id: '$destCategory',
          amount: { $sum: '$amount' }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryDetails'
        }
      },
      {
        $unwind: {
          path: '$categoryDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 0,
          amount: 1,
          categoryName: { $ifNull: ['$categoryDetails.name', 'Uncategorized Income'] }
        }
      }
    ]);

    // 3. Calculate Expense Breakdown
    const expenseBreakdown = await Transaction.aggregate([
      {
        $match: {
          ...matchCriteria,
          type: 'EXPENSE'
        }
      },
      {
        $group: {
          _id: '$destCategory',
          amount: { $sum: '$amount' }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      {
        $unwind: '$categoryInfo'
      },
      {
        $project: {
          _id: 0,
          categoryName: '$categoryInfo.name',
          amount: 1
        }
      }
    ]);

    const totalExpense = expenseBreakdown.reduce((sum, item) => sum + item.amount, 0);

    res.json({
      cycleString: cycleString || null,
      startDate: startDate || null,
      endDate: endDate || null,
      totalIncome,
      totalExpense,
      incomeBreakdown,
      expenseBreakdown
    });
  } catch (error) {
    console.error("Analytics Error:", error);
    res.status(500).json({ error: error.message, message: error.message });
  }
}
