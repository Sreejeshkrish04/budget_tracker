/**
 * Calculates the billing cycle start and end dates based on a 26th-to-25th cycle.
 * @param {Date|string} dateInput - The date to check.
 * @returns { { startDate: Date, endDate: Date } }
 */
export function getBillingCycleRange(dateInput) {
  let date;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const parts = dateInput.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    date = new Date(year, month, day);
  } else {
    date = new Date(dateInput);
  }

  if (isNaN(date.getTime())) {
    return {
      startDate: new Date(),
      endDate: new Date()
    };
  }

  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11
  const day = date.getDate();

  let startDate, endDate;

  if (day <= 25) {
    // E.g., June 24th -> Starts May 26th, Ends June 25th
    startDate = new Date(year, month - 1, 26);
    endDate = new Date(year, month, 25);
  } else {
    // E.g., June 26th -> Starts June 26th, Ends July 25th
    startDate = new Date(year, month, 26);
    endDate = new Date(year, month + 1, 25);
  }

  // Normalize hours to prevent timezone boundaries issues
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

/**
 * Returns a standardized billing cycle string: "YYYY-MM-26_NX"
 * @param {Date|string} dateInput - The date to check.
 * @returns {string}
 */
export function getCycleString(dateInput) {
  const { startDate } = getBillingCycleRange(dateInput);
  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-26_NX`;
}
