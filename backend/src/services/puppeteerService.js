const puppeteer = require('puppeteer');
const prisma = require('../db/prisma');

class PuppeteerService {
  constructor() {
    this.runStateId = 'khanan-scraper';
    this.isProcessing = false;
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
      year: 'numeric'
    });
  }

  getRunStateDelegate() {
    const delegate = prisma && prisma.scraperRunState;
    if (!delegate && !this.hasWarnedMissingRunStateDelegate) {
      this.hasWarnedMissingRunStateDelegate = true;
      console.warn('scraperRunState delegate unavailable on Prisma client. Run `npx prisma generate` and restart backend.');
    }
    return delegate;
  }

  isCurrentlyRunning() {
    return this.isProcessing;
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
      console.warn(`Failed loading scraper run-state: ${error.message}`);
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
      console.warn(`Failed backfilling scraper run summary: ${error.message}`);
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
      console.warn(`Failed persisting scraper run-state: ${error.message}`);
    }
  }

  async launchBrowser() {
    return await puppeteer.launch({
      headless: 'new',
      protocolTimeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ]
    });
  }

  async safeClosePage(page, contextLabel) {
    if (!page || page.isClosed()) return;
    try {
      await page.close();
    } catch (closeError) {
      console.warn(`${contextLabel} page close skipped: ${closeError.message}`);
    }
  }

  async safeCloseBrowser(browser) {
    if (!browser) return;
    try {
      await browser.close();
    } catch (error) {
      console.warn(`Browser close skipped: ${error.message}`);
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
        console.warn(`${contextLabel} failed on attempt ${attempt}. Retrying...`, error.message);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  async safeGoto(page, url, contextLabel) {
    await this.withRetry(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 12000 }).catch(() => null);
    }, 2, `Goto ${contextLabel}`);
  }

  async scheduledScrapingTask(url, dateSelector, fromDate, toDate, showButtonSelector) {
    if (this.isProcessing) {
      console.warn('Scraper execution skipped: Already running.');
      return;
    }

    if (this.isLocalMode(url)) {
      try {
        this.isProcessing = true;
        await this.startRun('local', fromDate, toDate);
        await this.runLocalScraping(fromDate, toDate);
        await this.maybeAutoSyncVehicleSummaries('local');
        await this.endRun(true);
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
        if (process.killed) break;

        this.currentStatusMessage = `RUNNING: Processing date ${this.formatDate(currentDate)}`;

        // Reset session every 5 hours
        if (Date.now() - lastResetTime.getTime() >= 5 * 60 * 60 * 1000) {
          console.log('5-hour threshold reached. Resetting session...');
          await this.safeCloseBrowser(browser);
          browser = await this.launchBrowser();
          lastResetTime = new Date();
        }

        await this.processDateIteration(browser, url, dateSelector, currentDate, showButtonSelector);
        currentDate.setDate(currentDate.getDate() + step);
      }
      await this.maybeAutoSyncVehicleSummaries('live');
    } catch (error) {
      console.error('Critical Failure in Scraper:', error);
      await this.endRun(false, error.message);
    } finally {
      this.isProcessing = false;
      if (!this.lastRunSummary || this.lastRunSummary.startedAt !== this.currentRunStats?.startedAt) {
        await this.endRun(true);
      }
      this.currentStatusMessage = 'IDLE - Last run completed at ' + new Date().toISOString();
      await this.safeCloseBrowser(browser);
      console.log('Resources cleaned up successfully.');
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
      console.error('Vehicle summary auto-sync failed:', error);
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

    while ((startDate <= endDate && current <= endDate) ||
           (startDate > endDate && current >= endDate)) {

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
          checkStatus: 'Generated locally'
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
          checkStatus: 'Generated locally'
        }
      ];

      const insertedCount = await this.insertKhananBatch(batch);
      savedCount += insertedCount;

      if (startDate <= endDate) {
        current.setDate(current.getDate() + 1);
      } else {
        current.setDate(current.getDate() - 1);
      }
    }

    console.log(`Local Khanan scraping completed with ${savedCount} generated records`);
  }

  async processDateIteration(browser, url, dateSelector, currentDate, showButtonSelector) {
    const page = await browser.newPage();
    const formattedDate = this.formatDate(currentDate);
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    try {
      await this.safeGoto(page, url, `date-${formattedDate}`);
      await this.setDateInput(page, dateSelector, formattedDate, showButtonSelector);

      const anchors = await this.extractTableData(page, this.tableIndex);
      for (const anchorUrl of Object.values(anchors)) {
        await this.processSecondLayer(browser, anchorUrl);
      }
    } catch (error) {
      console.error(`Error on date ${formattedDate}:`, error.message);
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
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    try {
      await this.safeGoto(page, url, 'second-layer');
      await this.clickViewAllButton(page);

      const sourceType = await this.getDropdownValue(page, this.passTypeId);
      const anchors = await this.extractTableData(page, this.tableIndex);

      for (const nextUrl of Object.values(anchors)) {
        await this.processThirdLayer(browser, nextUrl, sourceType);
      }
    } catch (error) {
      console.error('Error in Second Layer:', error.message);
    } finally {
      await this.safeClosePage(page, 'Second layer');
    }
  }

  async processThirdLayer(browser, url, sourceType) {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    try {
      await this.safeGoto(page, url, 'third-layer');
      await this.clickViewAllButton(page);

      const anchors = await this.extractTableData(page, this.tableIndex);
      for (const nextUrl of Object.values(anchors)) {
        await this.processFourthLayer(browser, nextUrl, sourceType);
      }
    } catch (error) {
      console.error('Error in Third Layer:', error.message);
    } finally {
      await this.safeClosePage(page, 'Third layer');
    }
  }

  async processFourthLayer(browser, url, sourceType) {
    const maxRetries = 2;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const page = await browser.newPage();
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(45000);

      try {
        await this.safeGoto(page, url, 'fourth-layer');
        await this.handleUnexpectedAlert(page);
        await this.clickViewAllButton(page);

        await page.waitForSelector(`#${this.districtId}`, { timeout: 15000 });

        const district = await this.getDropdownValue(page, this.districtId);
        const consigner = await this.getDropdownValue(page, this.consignerId);
        const dateVal = await page.$eval(`#${this.dateId}`, el => el.value);

        const tables = await page.$$('table');
        if (tables.length < 2) return;

        const rows = await tables[1].$$('tr');
        const pageBatch = [];

        for (let i = 1; i < rows.length - 1; i++) {
          try {
            const row = rows[i];
            const cols = await row.$$('td');

            if (cols.length < 11) continue;

            const firstCellText = await cols[0].evaluate(el => el.textContent.trim());
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
              checkStatus: await this.getColumnText(cols, 10)
            };

            pageBatch.push(khananData);
          } catch (error) {
            console.warn(`Stale element at row ${i}`);
          }
        }

        if (pageBatch.length > 0) {
          const insertedCount = await this.insertKhananBatch(pageBatch);
          console.log(`Saved batch of ${insertedCount} new records`);
          return;
        }
      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed for Fourth Layer:`, error.message);
        if (attempt === maxRetries - 1) throw error;
      } finally {
        await this.safeClosePage(page, 'Fourth layer');
      }
    }
  }

  async setDateInput(page, selector, value, showButtonSelector) {
    await this.withRetry(async () => {
      await page.waitForSelector(selector, { timeout: 20000 });
      await page.$eval(selector, input => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.type(selector, value);

      if (showButtonSelector) {
        await page.waitForSelector(showButtonSelector, { timeout: 20000 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
          page.click(showButtonSelector)
        ]);
      } else {
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
      }
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 12000 }).catch(() => null);
    }, 2, `Set date input ${value}`);

    console.log(`======== Running Date: ${value} ========`);
  }

  async clickViewAllButton(page) {
    await this.withRetry(async () => {
      const button = await page.$(`#${this.viewAllBtnId}`);
      if (!button) return;

      const isDisplayed = await page.evaluate(btn => btn.offsetParent !== null, button);
      if (!isDisplayed) return;

      await page.evaluate(btn => btn.scrollIntoView(), button);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
        page.evaluate(btn => btn.click(), button)
      ]);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => null);
      console.log('View All button clicked.');
    }, 2, 'View All interaction').catch((error) => {
      console.warn('View All button check skipped/failed:', error.message);
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
        console.warn('Target site displayed an internal error alert:', alertText);
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
      await page.waitForSelector('table', { timeout: 15000 });
      const tables = await page.$$('table');

      if (tables.length <= index) return anchors;

      const table = tables[index];
      const rows = await table.$$('tr');

      for (let i = 1; i < rows.length; i++) {
        try {
          const row = rows[i];
          const cols = await row.$$('td');
          if (!cols || cols.length === 0) continue;

          // Extract anchors from columns 4 and 8
          await this.extractAnchorFromRow(page, cols, i, anchors, [4, 8]);
        } catch (error) {
          console.warn(`Row ${i} skipped during table extraction: ${error.message}`);
          continue;
        }
      }
    } catch (error) {
      console.error('Table extraction failed:', error.message);
    }

    return anchors;
  }

  async extractAnchorFromRow(page, cols, rowIdx, anchors, targetCols) {
    for (const cIdx of targetCols) {
      if (cIdx >= cols.length) continue;

      const links = await cols[cIdx].$$('a');
      if (links.length === 0) continue;

      const href = await links[0].evaluate(link => link.href);
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
      const value = await page.evaluate(sel => {
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
    return await cols[index].evaluate(el => el.textContent.trim());
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
      const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        .findIndex(item => item.toLowerCase() === month.toLowerCase());

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
      console.error('insertKhananBatch failed:', error.message);
      throw error;
    }
  }

  async triggerDailyScraping() {
    if (this.isProcessing) {
      console.warn('Manual trigger skipped: Scraper is already running.');
      return false;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = this.formatDate(yesterday);
    const dateSelector = '#ctl00_MainContent_txtDate1';

    try {
      console.log(`Manual scraping triggered for date ${dateStr}`);
      await this.scheduledScrapingTask(
        process.env.SCRAPING_URL || 'https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx',
        dateSelector,
        dateStr,
        dateStr,
        '#ctl00_MainContent_btnshow'
      );
      return true;
    } catch (error) {
      console.error(`Manual scraping failed for date ${dateStr}:`, error);
      throw error;
    }
  }
}

module.exports = new PuppeteerService();
