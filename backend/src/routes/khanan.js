const express = require('express');
const router = express.Router();
const KhananData = require('../models/KhananData');

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

    // Build query
    const query = {};
    if (district) query.district = district;
    if (mineralName) query.mineralName = mineralName;
    if (vehicleRegNo) query.vehicleRegNo = vehicleRegNo;

    const dateRange = buildDateRange(fromDate, toDate);
    if (dateRange) query.date = { $in: dateRange };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [data, total] = await Promise.all([
      KhananData.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      KhananData.countDocuments(query)
    ]);

    res.json({
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
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

    const matchStage = {};
    const dateRange = buildDateRange(fromDate, toDate);
    if (dateRange) matchStage.date = { $in: dateRange };

    const stats = await KhananData.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalQuantity: {
            $sum: {
              $convert: {
                input: '$quantity',
                to: 'double',
                onError: 0,
                onNull: 0
              }
            }
          },
          districts: { $addToSet: '$district' },
          minerals: { $addToSet: '$mineralName' },
          uniqueVehicles: { $addToSet: '$vehicleRegNo' }
        }
      }
    ]);

    const result = stats[0] || {
      totalRecords: 0,
      totalQuantity: 0,
      districts: [],
      minerals: [],
      uniqueVehicles: []
    };

    res.json({
      totalRecords: result.totalRecords,
      totalQuantity: result.totalQuantity,
      districtCount: result.districts.length,
      mineralCount: result.minerals.length,
      uniqueVehicleCount: result.uniqueVehicles.length
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
    const districts = await KhananData.distinct('district');
    res.json({ districts: districts.sort() });
  } catch (error) {
    console.error('Error fetching districts:', error);
    res.status(500).json({
      error: 'Failed to fetch districts',
      details: error.message
    });
  }
});

// GET /api/khanan/minerals - Get unique minerals
router.get('/minerals', async (req, res) => {
  try {
    const minerals = await KhananData.distinct('mineralName');
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
