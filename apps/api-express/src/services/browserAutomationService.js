const { chromium } = require('playwright');
const prisma = require('../db/prisma');
const log = require('../lib/logger');

// ---------------------------------------------------------------------------
// Sunset guard (§5 row-98)
//
// Set LEGACY_SCRAPER_SUNSET_AFTER to an ISO-8601 date (e.g. "2026-09-01") to:
//   - Immediately throw if the current date is past the sunset date (hard stop).
//   - Log a daily warning for the 30-day window before sunset.
//
// When LEGACY_PUPPETEER_ENABLED=false (Helm default), the /api/selenium route
// already returns 410. This guard is an additional hard-stop for any code path
// that bypasses the route gate and calls this service directly.
// ---------------------------------------------------------------------------
(function checkSunset() {
  const raw = (process.env.LEGACY_SCRAPER_SUNSET_AFTER || '').trim();
  if (!raw) return;
  const sunsetAt = new Date(raw);
  if (Number.isNaN(sunsetAt.getTime())) {
    log.warn({ msg: 'legacy_scraper_sunset_invalid_date', LEGACY_SCRAPER_SUNSET_AFTER: raw });
    return;
  }
  const nowMs = Date.now();
  const msUntilSunset = sunsetAt.getTime() - nowMs;
  if (msUntilSunset <= 0) {
    const msg = `BrowserAutomationService (legacy /api/selenium) has passed its sunset date (${raw}). Remove LEGACY_PUPPETEER_ENABLED or set LEGACY_SCRAPER_SUNSET_AFTER to a future date after extending the deprecation window.`;
    log.error({ msg: 'legacy_scraper_sunset_hard_stop', sunsetAt: raw });
    throw new Error(msg);
  }
  const daysLeft = Math.ceil(msUntilSunset / 86_400_000);
  if (daysLeft <= 30) {
    log.warn({
      msg: 'legacy_scraper_sunset_imminent',
      sunsetAt: raw,
      daysLeft,
      hint: 'Migrate all /api/selenium callers to /api/v1/scrape-jobs before sunset.',
    });
  }
})();

function readEnvInt(primary, legacy, def, { min = 0, max = 600_000 } = {}) {
  const raw = process.env[primary] ?? process.env[legacy];
  if (raw == null || String(raw).trim() === '') return def;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function readEnvBool(primary, legacy, defaultValue) {
  const raw = process.env[primary] ?? process.env[legacy];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const s = String(raw).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  return defaultValue;
}

function readExecutablePath() {
  return (
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    undefined
  );
}

class BrowserAutomationService {
  constructor() {
    this.runStateId = 'khanan-scraper';
    this.isProcessing = false;
    /** Set via requestStop(); honoured between dates / layers (not mid-navigation). */
    this.stopRequested = false;
    this.isVehicleSummarySyncRunning = false;
    this.currentStatusMessage = 'IDLE';
    this.hasWarnedMissingRunStateDelegate = false;
    this.currentRunStats = null;
    this.lastRunSummary = null;
    this.invalidHref = 'https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx#';
    this.tableIndex = 1;
    this.viewAllBtnId = 'ctl00_MainContent_lbtnAll';
    this.passTypeId = 'ctl00_MainContent_ddlPassType';
    this.districtId = 'ctl00_MainContent_ddlDMO';
    this.consignerId = 'ctl00_MainContent_ddlConsigner';
    this.dateId = 'ctl00_MainContent_txtDate';
    this.dateFormatter = new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  getRunStateDelegate() {
    const delegate = prisma && prisma.scraperRunState;
    if (!delegate && !this.hasWarnedMissingRunStateDelegate) {
      this.hasWarnedMissingRunStateDelegate = true;
      log.warn({
        msg: 'khanan.scraper_run_state_delegate_missing',
        hint: 'Run npx prisma generate and restart api-express',
      });
    }
    return delegate;
  }

  isCurrentlyRunning() {
    return this.isProcessing;
  }

  requestStop() {
    if (!this.isProcessing) {
      return { ok: false, error: 'Scraper not running' };
    }
    this.stopRequested = true;
    return { ok: true };
  }

  getStatusMessage() {
    return this.currentStatusMessage;
  }

  async getRunSummary() {
    if (!this.lastRunSummary) {
      await this.loadLastRunFromDb();
    }
    return this.lastRunSummary;
  }

  async startRun(mode, fromDate, toDate) {
    this.currentRunStats = {
      mode,
      fromDate: fromDate || null,
      toDate: toDate || null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      success: null,
      insertedCount: 0,
      duplicateSkipped: 0,
      approxRowsSkipped: 0,
      vehicleSummarySync: 'not-configured',
      vehicleSummarySyncCount: 0,
      vehicleSummarySyncError: null,
      hadErrors: false,
      error: null,
    };
    await this.persistCurrentRunState({ success: null });
  }

  async endRun(success, errorMessage) {
    if (!this.currentRunStats) return;
    if (success && this.currentRunStats.hadErrors) success = false;
    this.currentRunStats.endedAt = new Date().toISOString();
    this.currentRunStats.success = success;
    this.currentRunStats.error = errorMessage || this.currentRunStats.error || null;
    this.lastRunSummary = { ...this.currentRunStats };
    await this.persistCurrentRunState({ success });
    this.currentRunStats = null;
  }

  async loadLastRunFromDb() {
    try {
      const runState = this.getRunStateDelegate();
      if (!runState) {
        await this.backfillRunSummaryFromLatestKhananRow();
        return;
      }
      const row = await runState.findUnique({
        where: { id: this.runStateId },
      });
      if (!row) {
        await this.backfillRunSummaryFromLatestKhananRow();
        return;
      }
      this.lastRunSummary = {
        mode: 'persisted',
        fromDate: row.lastFromDate,
        toDate: row.lastToDate,
        startedAt: row.lastStartedAt ? row.lastStartedAt.toISOString() : null,
        endedAt: row.lastEndedAt ? row.lastEndedAt.toISOString() : null,
        success: row.lastSuccess,
        insertedCount: row.lastInsertedCount || 0,
        duplicateSkipped: row.lastDuplicateSkipped || 0,
        approxRowsSkipped: row.lastDuplicateSkipped || 0,
        vehicleSummarySync: 'unknown',
        vehicleSummarySyncCount: 0,
        vehicleSummarySyncError: null,
        hadErrors: Boolean(row.lastError),
        error: row.lastError || null,
      };
    } catch (error) {
      log.warn({ msg: 'khanan.run_state_load_failed', error: error.message });
      await this.backfillRunSummaryFromLatestKhananRow();
    }
  }

  async backfillRunSummaryFromLatestKhananRow() {
    try {
      const latest = await prisma.khananData.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          date: true,
        },
      });
      if (!latest) return;

      const ts = latest.createdAt.toISOString();
      this.lastRunSummary = {
        mode: 'backfilled-from-khanan-data',
        fromDate: latest.date || null,
        toDate: latest.date || null,
        startedAt: ts,
        endedAt: ts,
        success: true,
        insertedCount: 0,
        duplicateSkipped: 0,
        approxRowsSkipped: 0,
        vehicleSummarySync: 'unknown',
        vehicleSummarySyncCount: 0,
        vehicleSummarySyncError: null,
        hadErrors: false,
        error: null,
      };

      const runState = this.getRunStateDelegate();
      if (!runState) return;
      await runState.upsert({
        where: { id: this.runStateId },
        create: {
          id: this.runStateId,
          lastStartedAt: latest.createdAt,
          lastEndedAt: latest.createdAt,
          lastSuccess: true,
          lastFromDate: latest.date || null,
          lastToDate: latest.date || null,
          lastError: null,
          lastInsertedCount: 0,
          lastDuplicateSkipped: 0,
        },
        update: {
          lastStartedAt: latest.createdAt,
          lastEndedAt: latest.createdAt,
          lastSuccess: true,
          lastFromDate: latest.date || null,
          lastToDate: latest.date || null,
          lastError: null,
          lastInsertedCount: 0,
          lastDuplicateSkipped: 0,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      log.warn({ msg: 'khanan.run_summary_backfill_failed', error: error.message });
    }
  }

  async persistCurrentRunState({ success = null } = {}) {
    if (!this.currentRunStats) return;
    try {
      const runState = this.getRunStateDelegate();
      if (!runState) return;
      await runState.upsert({
        where: { id: this.runStateId },
        create: {
          id: this.runStateId,
          lastStartedAt: this.currentRunStats.startedAt ? new Date(this.currentRunStats.startedAt) : null,
          lastEndedAt: this.currentRunStats.endedAt ? new Date(this.currentRunStats.endedAt) : null,
          lastSuccess: success,
          lastFromDate: this.currentRunStats.fromDate || null,
          lastToDate: this.currentRunStats.toDate || null,
          lastError: this.currentRunStats.error || null,
          lastInsertedCount: Number(this.currentRunStats.insertedCount) || 0,
          lastDuplicateSkipped: Number(this.currentRunStats.duplicateSkipped) || 0,
        },
        update: {
          lastStartedAt: this.currentRunStats.startedAt ? new Date(this.currentRunStats.startedAt) : null,
          lastEndedAt: this.currentRunStats.endedAt ? new Date(this.currentRunStats.endedAt) : null,
          lastSuccess: success,
          lastFromDate: this.currentRunStats.fromDate || null,
          lastToDate: this.currentRunStats.toDate || null,
          lastError: this.currentRunStats.error || null,
          lastInsertedCount: Number(this.currentRunStats.insertedCount) || 0,
          lastDuplicateSkipped: Number(this.currentRunStats.duplicateSkipped) || 0,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      log.warn({ msg: 'khanan.run_state_persist_failed', error: error.message });
    }
  }

  getDefaultTimeoutMs() {
    return readEnvInt('PLAYWRIGHT_DEFAULT_TIMEOUT_MS', 'PUPPETEER_DEFAULT_TIMEOUT_MS', 30_000, { min: 1000, max: 300_000 });
  }

  getNavigationTimeoutMs() {
    return readEnvInt('PLAYWRIGHT_NAVIGATION_TIMEOUT_MS', 'PUPPETEER_NAVIGATION_TIMEOUT_MS', 45_000, { min: 1000, max: 300_000 });
  }

  async launchBrowser() {
    const headless = readEnvBool('PLAYWRIGHT_HEADLESS', 'PUPPETEER_HEADLESS', true);
    const launchTimeout = readEnvInt('PLAYWRIGHT_LAUNCH_TIMEOUT_MS', 'PUPPETEER_LAUNCH_TIMEOUT_MS', 60_000, { min: 5000, max: 600_000 });
    const executablePath = readExecutablePath();

    return chromium.launch({
      headless,
      channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined,
      executablePath: executablePath || undefined,
      timeout: launchTimeout,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
      ],
    });
  }

  async safeClosePage(page, contextLabel) {
    if (!page || page.isClosed()) return;
    try {
      await page.close();
    } catch (closeError) {
      log.warn({ msg: 'khanan.page_close_skipped', context: contextLabel, error: closeError.message });
    }
  }

  async safeCloseBrowser(browser) {
    if (!browser) return;
    try {
      await browser.close();
    } catch (error) {
      log.warn({ msg: 'khanan.browser_close_skipped', error: error.message });
    }
  }

  async withRetry(taskFn, retries = 2, contextLabel = 'Task', delayMs = 1200) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await taskFn(attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= retries) break;
        log.warn({
          msg: 'khanan.retry',
          context: contextLabel,
          attempt,
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  async waitNetworkIdle(page, timeoutMs) {
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => null);
  }

  async safeGoto(page, url, contextLabel) {
    const navTimeout = this.getNavigationTimeoutMs();
    await this.withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      await this.waitNetworkIdle(page, 12_000);
    }, 2, `Goto ${contextLabel}`);
  }

  async scheduledScrapingTask(url, dateSelector, fromDate, toDate, showButtonSelector) {
    if (this.isProcessing) {
      log.warn({ msg: 'khanan.scraper_already_running' });
      return;
    }

    this.stopRequested = false;

    if (this.isLocalMode(url)) {
      try {
        this.isProcessing = true;
        await this.startRun('local', fromDate, toDate);
        await this.runLocalScraping(fromDate, toDate);
        if (!this.stopRequested) {
          await this.maybeAutoSyncVehicleSummaries('local');
          await this.endRun(true);
        } else {
          await this.endRun(false, 'Stopped by user');
        }
      } finally {
        this.isProcessing = false;
        this.currentStatusMessage = 'IDLE - Last local run completed at ' + new Date().toISOString();
      }
      return;
    }

    let browser;
    let lastResetTime = new Date();

    try {
      this.isProcessing = true;
      await this.startRun('live', fromDate, toDate);
      browser = await this.launchBrowser();
      const startDate = this.parseDate(fromDate);
      const endDate = this.parseDate(toDate);
      let currentDate = new Date(startDate);
      const step = startDate <= endDate ? 1 : -1;

      while (step > 0 ? currentDate <= endDate : currentDate >= endDate) {
        if (this.stopRequested) break;

        this.currentStatusMessage = `RUNNING: Processing date ${this.formatDate(currentDate)}`;

        if (Date.now() - lastResetTime.getTime() >= 5 * 60 * 60 * 1000) {
          log.info({ msg: 'khanan.session_reset_5h' });
          await this.safeCloseBrowser(browser);
          browser = await this.launchBrowser();
          lastResetTime = new Date();
        }

        await this.processDateIteration(browser, url, dateSelector, currentDate, showButtonSelector);
        currentDate.setDate(currentDate.getDate() + step);
      }
      if (this.stopRequested) {
        this.currentStatusMessage = 'STOPPED: User requested stop';
        await this.endRun(false, 'Stopped by user');
      } else {
        await this.maybeAutoSyncVehicleSummaries('live');
      }
    } catch (error) {
      log.error({
        msg: 'khanan.scraper_critical_failure',
        error: error?.message || String(error),
      });
      await this.endRun(false, error.message);
    } finally {
      this.isProcessing = false;
      if (!this.lastRunSummary || this.lastRunSummary.startedAt !== this.currentRunStats?.startedAt) {
        await this.endRun(true);
      }
      this.currentStatusMessage = 'IDLE - Last run completed at ' + new Date().toISOString();
      await this.safeCloseBrowser(browser);
      log.info({ msg: 'khanan.resources_cleaned' });
    }
  }

  shouldAutoSyncVehicleSummaries() {
    const flag = String(process.env.SCRAPE_AUTO_SYNC_VEHICLES || '').trim().toLowerCase();
    return flag === '1' || flag === 'true';
  }

  async maybeAutoSyncVehicleSummaries(modeLabel) {
    if (!this.currentRunStats) return;

    if (!this.shouldAutoSyncVehicleSummaries()) {
      this.currentRunStats.vehicleSummarySync = 'disabled';
      return;
    }

    if (this.isVehicleSummarySyncRunning) {
      this.currentRunStats.vehicleSummarySync = 'skipped-already-running';
      return;
    }

    const startedAt = new Date().toISOString();
    this.currentRunStats.vehicleSummarySync = 'running';
    this.currentRunStats.vehicleSummarySyncStartedAt = startedAt;
    this.currentStatusMessage = `RUNNING: Syncing vehicle summaries (${modeLabel})`;
    this.isVehicleSummarySyncRunning = true;

    try {
      const { aggregateVehicles } = require('../utils/vehicleAggregator');
      const count = await aggregateVehicles();
      this.currentRunStats.vehicleSummarySync = 'completed';
      this.currentRunStats.vehicleSummarySyncCount = Number(count) || 0;
      this.currentRunStats.vehicleSummarySyncError = null;
    } catch (error) {
      log.error({
        msg: 'khanan.vehicle_summary_sync_failed',
        error: error?.message || String(error),
      });
      this.currentRunStats.vehicleSummarySync = 'failed';
      this.currentRunStats.vehicleSummarySyncError = error.message;
      this.currentRunStats.hadErrors = true;
      if (!this.currentRunStats.error) {
        this.currentRunStats.error = `Vehicle summary auto-sync failed: ${error.message}`;
      }
    } finally {
      this.currentRunStats.vehicleSummarySyncEndedAt = new Date().toISOString();
      this.isVehicleSummarySyncRunning = false;
    }
  }

  isLocalMode(url) {
    return process.env.SCRAPING_MODE === 'local' || (url && url.startsWith('local://'));
  }

  async runLocalScraping(fromDate, toDate) {
    const startDate = this.parseDate(fromDate);
    const endDate = this.parseDate(toDate);
    let current = new Date(startDate);
    let savedCount = 0;

    while (
      (startDate <= endDate && current <= endDate) ||
      (startDate > endDate && current >= endDate)
    ) {
      if (this.stopRequested) break;

      this.currentStatusMessage = `RUNNING LOCAL: Seeding date ${this.formatDate(current)}`;
      const formattedDate = this.formatDate(current);

      const batch = [
        {
          district: 'Patna',
          consignerName: 'Local Consigner',
          date: formattedDate,
          sourceType: 'LOCAL',
          consigneeName: 'Local Consignee',
          challanNo: `LOCAL-${formattedDate}-001`,
          mineralName: 'Sand',
          mineralCategory: 'Minor Mineral',
          vehicleRegNo: 'BR01LOCAL1',
          destination: 'Patna',
          transportedDate: formattedDate,
          quantity: '18.5',
          unit: 'MT',
          checkStatus: 'Generated locally',
        },
        {
          district: 'Gaya',
          consignerName: 'Local Consigner',
          date: formattedDate,
          sourceType: 'LOCAL',
          consigneeName: 'Local Consignee',
          challanNo: `LOCAL-${formattedDate}-002`,
          mineralName: 'Stone',
          mineralCategory: 'Minor Mineral',
          vehicleRegNo: 'BR02LOCAL2',
          destination: 'Gaya',
          transportedDate: formattedDate,
          quantity: '22.0',
          unit: 'MT',
          checkStatus: 'Generated locally',
        },
      ];

      const insertedCount = await this.insertKhananBatch(batch);
      savedCount += insertedCount;

      if (startDate <= endDate) {
        current.setDate(current.getDate() + 1);
      } else {
        current.setDate(current.getDate() - 1);
      }
    }

    log.info({ msg: 'khanan.local_scrape_complete', savedCount });
  }

  applyPageTimeouts(page) {
    page.setDefaultTimeout(this.getDefaultTimeoutMs());
    page.setDefaultNavigationTimeout(this.getNavigationTimeoutMs());
  }

  async processDateIteration(browser, url, dateSelector, currentDate, showButtonSelector) {
    const page = await browser.newPage();
    this.applyPageTimeouts(page);
    const formattedDate = this.formatDate(currentDate);

    try {
      await this.safeGoto(page, url, `date-${formattedDate}`);
      await this.setDateInput(page, dateSelector, formattedDate, showButtonSelector);

      const anchors = await this.extractTableData(page, this.tableIndex);
      for (const anchorUrl of Object.values(anchors)) {
        if (this.stopRequested) break;
        await this.processSecondLayer(browser, anchorUrl);
      }
    } catch (error) {
      log.error({ msg: 'khanan.date_iteration_error', date: formattedDate, error: error.message });
      if (this.currentRunStats) {
        this.currentRunStats.hadErrors = true;
        this.currentRunStats.error = `Date ${formattedDate}: ${error.message}`;
      }
    } finally {
      await this.safeClosePage(page, `Date ${formattedDate}`);
    }
  }

  async processSecondLayer(browser, url) {
    const page = await browser.newPage();
    this.applyPageTimeouts(page);

    try {
      await this.safeGoto(page, url, 'second-layer');
      await this.clickViewAllButton(page);

      const sourceType = await this.getDropdownValue(page, this.passTypeId);
      const anchors = await this.extractTableData(page, this.tableIndex);

      for (const nextUrl of Object.values(anchors)) {
        if (this.stopRequested) break;
        await this.processThirdLayer(browser, nextUrl, sourceType);
      }
    } catch (error) {
      log.error({ msg: 'khanan.second_layer_error', error: error.message });
    } finally {
      await this.safeClosePage(page, 'Second layer');
    }
  }

  async processThirdLayer(browser, url, sourceType) {
    const page = await browser.newPage();
    this.applyPageTimeouts(page);

    try {
      await this.safeGoto(page, url, 'third-layer');
      await this.clickViewAllButton(page);

      const anchors = await this.extractTableData(page, this.tableIndex);
      for (const nextUrl of Object.values(anchors)) {
        if (this.stopRequested) break;
        await this.processFourthLayer(browser, nextUrl, sourceType);
      }
    } catch (error) {
      log.error({ msg: 'khanan.third_layer_error', error: error.message });
    } finally {
      await this.safeClosePage(page, 'Third layer');
    }
  }

  async processFourthLayer(browser, url, sourceType) {
    const maxRetries = 2;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const page = await browser.newPage();
      this.applyPageTimeouts(page);

      try {
        await this.safeGoto(page, url, 'fourth-layer');
        await this.handleUnexpectedAlert(page);
        await this.clickViewAllButton(page);

        await page.waitForSelector(`#${this.districtId}`, { timeout: 15_000 });

        const district = await this.getDropdownValue(page, this.districtId);
        const consigner = await this.getDropdownValue(page, this.consignerId);
        const dateVal = await page.$eval(`#${this.dateId}`, (el) => el.value);

        const tables = await page.$$('table');
        if (tables.length < 2) return;

        const rows = await tables[1].$$('tr');
        const pageBatch = [];

        for (let i = 1; i < rows.length - 1; i++) {
          if (this.stopRequested) break;
          try {
            const row = rows[i];
            const cols = await row.$$('td');

            if (cols.length < 11) continue;

            const firstCellText = await cols[0].evaluate((el) => el.textContent.trim());
            if (firstCellText.includes('No Data Found')) continue;

            const khananData = {
              district,
              consignerName: consigner,
              date: dateVal,
              sourceType,
              consigneeName: await this.getColumnText(cols, 1),
              challanNo: await this.getColumnText(cols, 2),
              mineralName: await this.getColumnText(cols, 3),
              mineralCategory: await this.getColumnText(cols, 4),
              vehicleRegNo: await this.getColumnText(cols, 5),
              destination: await this.getColumnText(cols, 6),
              transportedDate: await this.getColumnText(cols, 7),
              quantity: await this.getColumnText(cols, 8),
              unit: await this.getColumnText(cols, 9),
              checkStatus: await this.getColumnText(cols, 10),
            };

            pageBatch.push(khananData);
          } catch (error) {
            log.warn({ msg: 'khanan.stale_element_row', row: i });
          }
        }

        if (pageBatch.length > 0) {
          const insertedCount = await this.insertKhananBatch(pageBatch);
          log.info({ msg: 'khanan.batch_saved', insertedCount });
          return;
        }
      } catch (error) {
        log.error({
          msg: 'khanan.fourth_layer_attempt_failed',
          attempt: attempt + 1,
          error: error.message,
        });
        if (attempt === maxRetries - 1) throw error;
      } finally {
        await this.safeClosePage(page, 'Fourth layer');
      }
    }
  }

  async setDateInput(page, selector, value, showButtonSelector) {
    const navTimeout = this.getNavigationTimeoutMs();
    await this.withRetry(async () => {
      await page.waitForSelector(selector, { timeout: 20_000 });
      await page.$eval(selector, (input) => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.type(selector, value);

      if (showButtonSelector) {
        await page.waitForSelector(showButtonSelector, { timeout: 20_000 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => null),
          page.click(showButtonSelector),
        ]);
      } else {
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => null);
      }
      await this.waitNetworkIdle(page, 12_000);
    }, 2, `Set date input ${value}`);

    log.info({ msg: 'khanan.running_date', value });
  }

  async clickViewAllButton(page) {
    const navTimeout = this.getNavigationTimeoutMs();
    await this.withRetry(async () => {
      const button = await page.$(`#${this.viewAllBtnId}`);
      if (!button) return;

      const isDisplayed = await page.evaluate((btn) => btn.offsetParent !== null, button);
      if (!isDisplayed) return;

      await page.evaluate((btn) => btn.scrollIntoView(), button);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null),
        page.evaluate((btn) => btn.click(), button),
      ]);
      await this.waitNetworkIdle(page, 10_000);
      log.info({ msg: 'khanan.view_all_clicked' });
    }, 2, 'View All interaction').catch((error) => {
      log.warn({ msg: 'khanan.view_all_failed', error: error.message });
    });
  }

  async handleUnexpectedAlert(page) {
    try {
      const alert = await page.waitForSelector('dialog', { timeout: 5000 });
      if (alert) {
        const alertText = await page.evaluate(() => {
          const dialog = document.querySelector('dialog');
          return dialog ? dialog.textContent : null;
        });
        log.warn({ msg: 'khanan.site_alert', alertText });
        await page.evaluate(() => {
          const dialog = document.querySelector('dialog');
          if (dialog) dialog.remove();
        });
      }
    } catch (error) {
      // No alert present
    }
  }

  async extractTableData(page, index) {
    const anchors = {};

    try {
      await page.waitForSelector('table', { timeout: 15_000 });
      const tables = await page.$$('table');

      if (tables.length <= index) return anchors;

      const table = tables[index];
      const rows = await table.$$('tr');

      for (let i = 1; i < rows.length; i++) {
        try {
          const row = rows[i];
          const cols = await row.$$('td');
          if (!cols || cols.length === 0) continue;

          await this.extractAnchorFromRow(page, cols, i, anchors, [4, 8]);
        } catch (error) {
          log.warn({ msg: 'khanan.table_row_skipped', row: i, error: error.message });
          continue;
        }
      }
    } catch (error) {
      log.error({ msg: 'khanan.table_extraction_failed', error: error.message });
    }

    return anchors;
  }

  async extractAnchorFromRow(page, cols, rowIdx, anchors, targetCols) {
    for (const cIdx of targetCols) {
      if (cIdx >= cols.length) continue;

      const links = await cols[cIdx].$$('a');
      if (links.length === 0) continue;

      const href = await links[0].evaluate((link) => link.href);
      if (this.isValidHref(href)) {
        anchors[`${rowIdx}-${cIdx}`] = href;
      }
    }
  }

  isValidHref(href) {
    return href && href.trim() && href !== this.invalidHref;
  }

  async getDropdownValue(page, id) {
    try {
      const select = await page.$(`#${id}`);
      const value = await page.evaluate((sel) => {
        const selected = sel.querySelector('option:checked');
        return selected ? selected.textContent : 'N/A';
      }, select);
      return value;
    } catch (error) {
      return 'N/A';
    }
  }

  async getColumnText(cols, index) {
    if (index >= cols.length) return '';
    return await cols[index].evaluate((el) => el.textContent.trim());
  }

  formatDate(date) {
    return this.dateFormatter.format(date).replace(/\s+/g, '-');
  }

  parseDate(value) {
    if (value instanceof Date) return value;

    const normalized = String(value).trim();
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const match = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].findIndex(
        (item) => item.toLowerCase() === month.toLowerCase()
      );

      if (monthIndex >= 0) {
        return new Date(Number(year), monthIndex, Number(day));
      }
    }

    throw new Error(`Invalid date value: ${value}`);
  }

  async insertKhananBatch(batch) {
    if (!batch.length) return 0;
    const rows = batch.map((doc) => {
      const d = doc.toObject ? doc.toObject() : doc;
      return {
        district: d.district,
        consignerName: d.consignerName,
        date: d.date,
        sourceType: d.sourceType,
        consigneeName: d.consigneeName,
        challanNo: d.challanNo,
        mineralName: d.mineralName,
        mineralCategory: d.mineralCategory,
        vehicleRegNo: d.vehicleRegNo,
        destination: d.destination,
        transportedDate: d.transportedDate,
        quantity: String(d.quantity ?? '0'),
        unit: d.unit,
        checkStatus: d.checkStatus ?? 'Pending',
      };
    });

    try {
      const result = await prisma.khananData.createMany({
        data: rows,
        skipDuplicates: true,
      });
      const inserted = result.count;
      const skippedApprox = Math.max(0, rows.length - inserted);
      if (this.currentRunStats) {
        this.currentRunStats.insertedCount += inserted;
        this.currentRunStats.duplicateSkipped += skippedApprox;
        this.currentRunStats.approxRowsSkipped += skippedApprox;
      }
      return inserted;
    } catch (error) {
      log.error({ msg: 'khanan.insert_batch_failed', error: error.message });
      throw error;
    }
  }

  async triggerDailyScraping() {
    if (this.isProcessing) {
      log.warn({ msg: 'khanan.manual_trigger_skipped_running' });
      return false;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = this.formatDate(yesterday);
    const dateSelector = '#ctl00_MainContent_txtDate1';

    try {
      log.info({ msg: 'khanan.manual_scrape_triggered', dateStr });
      await this.scheduledScrapingTask(
        process.env.SCRAPING_URL || 'https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx',
        dateSelector,
        dateStr,
        dateStr,
        '#ctl00_MainContent_btnshow'
      );
      return true;
    } catch (error) {
      log.error({ msg: 'khanan.manual_scrape_failed', dateStr, error: error?.message || String(error) });
      throw error;
    }
  }
}

module.exports = new BrowserAutomationService();
