const express = require('express');
const prisma = require('../db/prisma');
const { serializeKhananRow } = require('../utils/serializeApi');

const router = express.Router();

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

function formatDate(date) {
  return dateFormatter.format(date).replace(/\s+/g, '-');
}

function parseDate(value) {
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

function buildDateRange(fromDate, toDate) {
  if (!fromDate && !toDate) return null;

  const start = parseDate(fromDate || toDate);
  const end = parseDate(toDate || fromDate);
  const step = start <= end ? 1 : -1;
  const dates = [];
  const current = new Date(start);

  while (step > 0 ? current <= end : current >= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + step);
  }

  return dates;
}

function buildKhananWhere(query) {
  const {
    district,
    fromDate,
    toDate,
    mineralName,
    vehicleRegNo,
  } = query;

  const where = {};
  if (district) where.district = district;
  if (mineralName) where.mineralName = mineralName;
  if (vehicleRegNo) {
    where.vehicleRegNo = { contains: vehicleRegNo, mode: 'insensitive' };
  }

  const dateRange = buildDateRange(fromDate, toDate);
  if (dateRange) where.date = { in: dateRange };

  return where;
}

// GET /api/khanan/data - Get khanan data with filters
router.get('/data', async (req, res) => {
  try {
    const {
      district,
      fromDate,
      toDate,
      mineralName,
      vehicleRegNo,
      page = 1,
      limit = 50
    } = req.query;

    const where = buildKhananWhere({
      district,
      fromDate,
      toDate,
      mineralName,
      vehicleRegNo,
    });

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [rows, total] = await Promise.all([
      prisma.khananData.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit, 10),
      }),
      prisma.khananData.count({ where }),
    ]);

    const data = rows.map(serializeKhananRow);

    res.json({
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10))
      }
    });

  } catch (error) {
    console.error('Error fetching khanan data:', error);
    res.status(500).json({
      error: 'Failed to fetch khanan data',
      details: error.message
    });
  }
});

// GET /api/khanan/stats - Get statistics
router.get('/stats', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    const where = buildKhananWhere({ fromDate, toDate });

    const [agg, districtRows, mineralRows, vehicleRows] = await Promise.all([
      prisma.khananData.aggregate({
        where,
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      prisma.khananData.findMany({
        where,
        distinct: ['district'],
        select: { district: true },
      }),
      prisma.khananData.findMany({
        where,
        distinct: ['mineralName'],
        select: { mineralName: true },
      }),
      prisma.khananData.findMany({
        where,
        distinct: ['vehicleRegNo'],
        select: { vehicleRegNo: true },
      }),
    ]);

    const totalQuantity = agg._sum.quantity != null
      ? Number(agg._sum.quantity.toString())
      : 0;

    res.json({
      totalRecords: agg._count._all,
      totalQuantity,
      districtCount: districtRows.length,
      mineralCount: mineralRows.length,
      uniqueVehicleCount: vehicleRows.length,
    });

  } catch (error) {
    console.error('Error fetching khanan stats:', error);
    res.status(500).json({
      error: 'Failed to fetch khanan stats',
      details: error.message
    });
  }
});

// GET /api/khanan/districts - Get unique districts
router.get('/districts', async (req, res) => {
  try {
    const rows = await prisma.khananData.findMany({
      distinct: ['district'],
      select: { district: true },
      orderBy: { district: 'asc' },
    });
    const districts = rows.map(r => r.district).filter(Boolean);
    res.json({ districts: districts.sort() });
  } catch (error) {
    console.error('Error fetching districts:', error);
    res.status(500).json({
      error: 'Failed to fetch districts',
      details: error.message
    });
  }
});

const WIPE_SCRAPE_CONFIRM = 'WIPE_KHANAN_SCRAPE_DATA';

// GET /api/khanan/record/:id — one row (for layer-by-layer QA after scrape)
router.get('/record/:id', async (req, res) => {
  try {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const id = BigInt(raw);
    const row = await prisma.khananData.findUnique({ where: { id } });
    if (!row) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ record: serializeKhananRow(row) });
  } catch (error) {
    console.error('Error fetching khanan record:', error);
    res.status(500).json({ error: 'Failed to fetch record', details: error.message });
  }
});

// POST /api/khanan/wipe-scraped-data — delete all scraped Khanan rows (and optional vehicle summaries)
router.post('/wipe-scraped-data', async (req, res) => {
  try {
    const puppeteerService = require('../services/puppeteerService');
    if (puppeteerService.isCurrentlyRunning()) {
      return res.status(409).json({
        error: 'Scraper is running. Stop scrape first, then wipe.',
      });
    }

    const { confirm, wipeVehicleSummaries } = req.body || {};
    if (confirm !== WIPE_SCRAPE_CONFIRM) {
      return res.status(400).json({
        error: 'Confirmation required',
        expectedBody: {
          confirm: WIPE_SCRAPE_CONFIRM,
          wipeVehicleSummaries: false,
        },
        note: 'Set wipeVehicleSummaries true only if you also want all Vehicle Leads summaries removed.',
      });
    }

    const khananResult = await prisma.khananData.deleteMany({});
    const scraperStateResult = await prisma.scraperRunState.deleteMany({ where: { id: 'khanan-scraper' } });

    let vehicleResult = { count: 0 };
    if (wipeVehicleSummaries === true || wipeVehicleSummaries === 'true') {
      vehicleResult = await prisma.vehicleTripSummary.deleteMany({});
    }

    res.json({
      ok: true,
      deletedKhananRows: khananResult.count,
      scraperRunStateRowsDeleted: scraperStateResult.count,
      deletedVehicleSummaries: vehicleResult.count,
    });
  } catch (error) {
    console.error('Error wiping khanan data:', error);
    res.status(500).json({ error: 'Wipe failed', details: error.message });
  }
});

// GET /api/khanan/minerals - Get unique minerals
router.get('/minerals', async (req, res) => {
  try {
    const rows = await prisma.khananData.findMany({
      distinct: ['mineralName'],
      select: { mineralName: true },
      orderBy: { mineralName: 'asc' },
    });
    const minerals = rows.map(r => r.mineralName).filter(Boolean);
    res.json({ minerals: minerals.sort() });
  } catch (error) {
    console.error('Error fetching minerals:', error);
    res.status(500).json({
      error: 'Failed to fetch minerals',
      details: error.message
    });
  }
});

module.exports = router;
