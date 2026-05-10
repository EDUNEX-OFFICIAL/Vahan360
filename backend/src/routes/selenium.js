const express = require('express');
const router = express.Router();
const puppeteerService = require('../services/puppeteerService');
const { validateScrapeRange, getRangeScrapeCoverage } = require('../utils/scrapeRangeValidation');

const defaultScrapingUrl =
  process.env.SCRAPING_URL || 'https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx';
const defaultShowButton = '#ctl00_MainContent_btnshow';
const defaultDateField = '#ctl00_MainContent_txtDate1';

function startRangeScrape(fromDate, toDate, url, dateField, showButton) {
  puppeteerService.scheduledScrapingTask(url, dateField, fromDate, toDate, showButton);
}

async function ensureNotAlreadyScraped(fromDate, toDate) {
  const coverage = await getRangeScrapeCoverage(fromDate, toDate);
  if (coverage.fullyScraped) {
    return {
      ok: false,
      status: 409,
      error: `Data for selected range already exists (${coverage.existingDays}/${coverage.expectedDays} day(s), ${coverage.existingRows} row(s)). Scrape skipped.`,
      coverage,
    };
  }
  return { ok: true, coverage };
}

// GET /api/selenium/by-date-range (backward compatible; prefer POST /scrape-range for actions)
router.get('/by-date-range', async (req, res) => {
  try {
    const {
      url = defaultScrapingUrl,
      selectorShowButton = defaultShowButton,
      inputCssSelectorDateInputField = defaultDateField,
      fromDate,
      toDate,
    } = req.query;

    const validation = validateScrapeRange(fromDate, toDate);
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }

    if (puppeteerService.isCurrentlyRunning()) {
      return res.status(409).json({ error: 'Scraper already running' });
    }

    const preflight = await ensureNotAlreadyScraped(validation.fromDate, validation.toDate);
    if (!preflight.ok) {
      return res.status(preflight.status).json({
        error: preflight.error,
        coverage: preflight.coverage,
      });
    }

    startRangeScrape(
      validation.fromDate,
      validation.toDate,
      url,
      inputCssSelectorDateInputField,
      selectorShowButton
    );

    return res.status(202).json({
      status: 'started',
      message: 'Scraping task started successfully',
      fromDate: validation.fromDate,
      toDate: validation.toDate,
      dayCount: validation.dayCount,
    });
  } catch (error) {
    console.error('Error starting scraping task:', error);
    return res.status(500).json({
      error: 'Failed to start scraping task',
      details: error.message,
    });
  }
});

// POST /api/selenium/scrape-range
router.post('/scrape-range', async (req, res) => {
  try {
    const {
      url = defaultScrapingUrl,
      selectorShowButton = defaultShowButton,
      inputCssSelectorDateInputField = defaultDateField,
      fromDate,
      toDate,
    } = req.body || {};

    const validation = validateScrapeRange(fromDate, toDate);
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }

    if (puppeteerService.isCurrentlyRunning()) {
      return res.status(409).json({ error: 'Scraper already running' });
    }

    const preflight = await ensureNotAlreadyScraped(validation.fromDate, validation.toDate);
    if (!preflight.ok) {
      return res.status(preflight.status).json({
        error: preflight.error,
        coverage: preflight.coverage,
      });
    }

    startRangeScrape(
      validation.fromDate,
      validation.toDate,
      url,
      inputCssSelectorDateInputField,
      selectorShowButton
    );

    return res.status(202).json({
      status: 'started',
      fromDate: validation.fromDate,
      toDate: validation.toDate,
      dayCount: validation.dayCount,
    });
  } catch (error) {
    console.error('Error starting scrape-range:', error);
    return res.status(500).json({
      error: 'Failed to start scraping task',
      details: error.message,
    });
  }
});

// GET /api/selenium/status
router.get('/status', async (req, res) => {
  const lastRun = await puppeteerService.getRunSummary();
  res.json({
    running: puppeteerService.isCurrentlyRunning(),
    details: puppeteerService.getStatusMessage(),
    lastRun,
  });
});

// GET /api/selenium/last-run
router.get('/last-run', async (req, res) => {
  const lastRun = await puppeteerService.getRunSummary();
  res.json({
    lastRun,
  });
});

// GET /api/selenium/dailyScraping — Quick: yesterday only
router.get('/dailyScraping', async (req, res) => {
  try {
    if (puppeteerService.isCurrentlyRunning()) {
      return res.status(409).json({ error: 'Scraper already running' });
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const formattedYesterday = puppeteerService.formatDate(yesterday);
    const preflight = await ensureNotAlreadyScraped(formattedYesterday, formattedYesterday);
    if (!preflight.ok) {
      return res.status(preflight.status).json({
        error: preflight.error,
        coverage: preflight.coverage,
      });
    }

    const ok = await puppeteerService.triggerDailyScraping();
    if (ok === false) {
      return res.status(409).json({ error: 'Scraper already running' });
    }

    res.json({
      message: 'Daily scraping task triggered successfully',
      status: 'started',
    });
  } catch (error) {
    console.error('Error triggering daily scraping:', error);
    res.status(500).json({
      error: 'Failed to trigger daily scraping task',
      details: error.message,
    });
  }
});

module.exports = router;
