"use strict";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * @param {Date} date
 * @returns {string} e.g. DD-MMM-YYYY with hyphen separators (spaces collapsed)
 */
function formatScrapeDate(date) {
  return dateFormatter.format(date).replace(/\s+/g, "-");
}

/**
 * @param {unknown} value ISO date string, Date, or DD-MMM-YYYY
 * @returns {Date}
 */
function parseScrapeDate(value) {
  if (value instanceof Date) return value;

  const normalized = String(value).trim();
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const monthIndex = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].findIndex((item) => item.toLowerCase() === month.toLowerCase());

    if (monthIndex >= 0) {
      return new Date(Number(year), monthIndex, Number(day));
    }
  }

  throw new Error(`Invalid date value: ${value}`);
}

module.exports = {
  formatScrapeDate,
  parseScrapeDate,
};
