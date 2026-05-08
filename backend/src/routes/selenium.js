const express = require('express');
const router = express.Router();
const puppeteerService = require('../services/puppeteerService');

// GET /api/selenium/by-date-range
router.get('/by-date-range', async (req, res) => {
  try {
    const {
      url = process.env.SCRAPING_URL || 'https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx',
      selectorShowButton = '#ctl00_MainContent_btnshow',
      inputCssSelectorDateInputField = '#ctl00_MainContent_txtDate1',
      fromDate,
      toDate
    } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: 'fromDate and toDate are required parameters'
      });
    }

    // Start scraping asynchronously
    puppeteerService.scheduledScrapingTask(
      url,
      inputCssSelectorDateInputField,
      fromDate,
      toDate,
      selectorShowButton
    );

    res.json({
      message: 'Scraping task started successfully',
      status: 'running',
      fromDate,
      toDate
    });

  } catch (error) {
    console.error('Error starting scraping task:', error);
    res.status(500).json({
      error: 'Failed to start scraping task',
      details: error.message
    });
  }
});

// GET /api/selenium/status
router.get('/status', (req, res) => {
  res.json({
    running: puppeteerService.isCurrentlyRunning(),
    details: puppeteerService.getStatusMessage(),
    lastRun: puppeteerService.getRunSummary()
  });
});

// GET /api/selenium/last-run
router.get('/last-run', (req, res) => {
  res.json({
    lastRun: puppeteerService.getRunSummary()
  });
});

// GET /api/selenium/dailyScraping
router.get('/dailyScraping', async (req, res) => {
  try {
    await puppeteerService.triggerDailyScraping();
    res.json({
      message: 'Daily scraping task triggered successfully'
    });
  } catch (error) {
    console.error('Error triggering daily scraping:', error);
    res.status(500).json({
      error: 'Failed to trigger daily scraping task',
      details: error.message
    });
  }
});

module.exports = router;
