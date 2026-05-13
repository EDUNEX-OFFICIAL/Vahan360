const { formatScrapeDate, parseScrapeDate } = require('./scrapeDate');
const prisma = require('../db/prisma');

function getScrapeMaxRangeDays() {
  const n = parseInt(process.env.SCRAPE_MAX_RANGE_DAYS || '31', 10);
  return Number.isFinite(n) && n > 0 ? n : 31;
}

/** Calendar-day span inclusive (order-independent). */
function inclusiveDaySpan(startDate, endDate) {
  const s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const e = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  return Math.abs(Math.round((e - s) / (24 * 60 * 60 * 1000))) + 1;
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * @param {string} fromDateStr
 * @param {string} toDateStr
 * @returns {{ ok: true, fromDate: string, toDate: string, dayCount: number } | { ok: false, status: number, error: string }}
 */
function validateScrapeRange(fromDateStr, toDateStr) {
  const fromRaw = fromDateStr != null ? String(fromDateStr).trim() : '';
  const toRaw = toDateStr != null ? String(toDateStr).trim() : '';

  if (!fromRaw || !toRaw) {
    return { ok: false, status: 400, error: 'fromDate and toDate are required.' };
  }

  let start;
  let end;
  try {
    start = parseScrapeDate(fromRaw);
    end = parseScrapeDate(toRaw);
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: `Invalid date value: ${e.message}`,
    };
  }

  const rejectFuture =
    process.env.SCRAPE_ALLOW_FUTURE_DATES !== '1' &&
    process.env.SCRAPE_ALLOW_FUTURE_DATES !== 'true';

  if (rejectFuture) {
    const today = startOfLocalDay(new Date());
    if (startOfLocalDay(end) > today || startOfLocalDay(start) > today) {
      return {
        ok: false,
        status: 400,
        error: 'fromDate and toDate must not be in the future (set SCRAPE_ALLOW_FUTURE_DATES=1 to override).',
      };
    }
  }

  const maxDays = getScrapeMaxRangeDays();
  const dayCount = inclusiveDaySpan(start, end);
  if (dayCount > maxDays) {
    return {
      ok: false,
      status: 400,
      error: `Date range spans ${dayCount} days; maximum allowed is ${maxDays} (set SCRAPE_MAX_RANGE_DAYS).`,
    };
  }

  return {
    ok: true,
    fromDate: fromRaw,
    toDate: toRaw,
    dayCount,
  };
}

module.exports = {
  validateScrapeRange,
  getScrapeMaxRangeDays,
  inclusiveDaySpan,
  async getRangeScrapeCoverage(fromDateStr, toDateStr) {
    const start = parseScrapeDate(fromDateStr);
    const end = parseScrapeDate(toDateStr);
    const step = start <= end ? 1 : -1;
    const d = new Date(start);
    const expectedDates = [];

    while (step > 0 ? d <= end : d >= end) {
      expectedDates.push(formatScrapeDate(d));
      d.setDate(d.getDate() + step);
    }

    if (expectedDates.length === 0) {
      return {
        expectedDays: 0,
        existingDays: 0,
        existingRows: 0,
        missingDates: [],
        fullyScraped: false,
      };
    }

    const [rowsCount, existingDateRows] = await Promise.all([
      prisma.khananData.count({
        where: { date: { in: expectedDates } },
      }),
      prisma.khananData.findMany({
        where: { date: { in: expectedDates } },
        select: { date: true },
        distinct: ['date'],
      }),
    ]);

    const existingSet = new Set(existingDateRows.map((item) => item.date));
    const missingDates = expectedDates.filter((dt) => !existingSet.has(dt));

    return {
      expectedDays: expectedDates.length,
      existingDays: existingSet.size,
      existingRows: rowsCount,
      missingDates,
      fullyScraped: missingDates.length === 0,
    };
  },
};
