const express = require('express');
const router = express.Router();
const VehicleTripSummary = require('../models/VehicleTripSummary');
const { buildVehicleTripSummaryQuery } = require('../utils/vehicleQueryBuilder');
const { deriveLifecycleFields, normalizeVehicleRegNo } = require('../utils/leadLifecycle');

// GET /api/vehicle/trip-summary - Get vehicle trip summaries
router.get('/trip-summary', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const query = buildVehicleTripSummaryQuery(req.query);

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNumber - 1) * limitNumber;

    const [data, total] = await Promise.all([
      VehicleTripSummary.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
      VehicleTripSummary.countDocuments(query)
    ]);

    res.json({
      data,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        pages: Math.ceil(total / limitNumber)
      }
    });

  } catch (error) {
    console.error('Error fetching vehicle trip summaries:', error);
    res.status(500).json({
      error: 'Failed to fetch vehicle trip summaries',
      details: error.message
    });
  }
});

// GET /api/vehicle/trip-summary/:vehicleRegNo - Get specific vehicle summary
router.get('/trip-summary/:vehicleRegNo', async (req, res) => {
  try {
    const { vehicleRegNo: rawVehicleRegNo } = req.params;
    const vehicleRegNo = normalizeVehicleRegNo(rawVehicleRegNo);

    const summary = await VehicleTripSummary.findOne({
      vehicleRegNo: new RegExp(`^${vehicleRegNo}$`, 'i')
    });

    if (!summary) {
      return res.status(404).json({
        error: 'Vehicle trip summary not found'
      });
    }

    res.json({ data: summary });

  } catch (error) {
    console.error('Error fetching vehicle trip summary:', error);
    res.status(500).json({
      error: 'Failed to fetch vehicle trip summary',
      details: error.message
    });
  }
});

// POST /api/vehicle/trip-summary - Create or update vehicle trip summary
router.post('/trip-summary', async (req, res) => {
  try {
    const {
      vehicleRegNo,
      totalTrips,
      totalMTWeight,
      sandTrips,
      sandMTWeight,
      stoneTrips,
      stoneMTWeight,
      ownerName,
      mobileNo,
      make,
      model,
      gvwKgs,
      unladenWeightKgs,
      vehicleCategory,
      fatherName,
      currentFullAddress,
      currentPincode,
      currentDistrict,
      permanentFullAddress,
      permanentPincode,
      permanentDistrict,
      insuranceCompany,
      insurancePolicyNo,
      insuranceDueDate,
      permitValidUpto,
      fitnessValidUpto,
      pollutionValidUpto,
      mvTaxPaidUpto,
      leadSource,
      offence,
      panNumber,
      panAddress,
      gstin,
      legalName,
      gstTradeName,
      gstContact,
      gstEmail,
      khananPhone,
      customerType,
      status,
      nextFollowUp,
      assignedExecutive
    } = req.body;

    const normalizedVehicleRegNo = normalizeVehicleRegNo(vehicleRegNo);
    if (!normalizedVehicleRegNo) {
      return res.status(400).json({
        error: 'vehicleRegNo is required'
      });
    }

    const existingSummary = await VehicleTripSummary.findOne({ vehicleRegNo: normalizedVehicleRegNo })
      .select('status nextFollowUp assignedExecutive');
    const lifecycle = deriveLifecycleFields({
      incomingStatus: status,
      existingStatus: existingSummary?.status,
      totalTrips,
      totalMTWeight,
      existingNextFollowUp: existingSummary?.nextFollowUp,
      existingAssignedExecutive: existingSummary?.assignedExecutive,
      ownerName,
    });

    // Upsert: update if exists, create if not
    const summary = await VehicleTripSummary.findOneAndUpdate(
      { vehicleRegNo: normalizedVehicleRegNo },
      {
        vehicleRegNo: normalizedVehicleRegNo,
        totalTrips: totalTrips || 0,
        totalMTWeight: totalMTWeight || 0,
        sandTrips: sandTrips || 0,
        sandMTWeight: sandMTWeight || 0,
        stoneTrips: stoneTrips || 0,
        stoneMTWeight: stoneMTWeight || 0,
        ownerName,
        mobileNo,
        make,
        model,
        gvwKgs,
        unladenWeightKgs,
        vehicleCategory,
        fatherName,
        currentFullAddress,
        currentPincode,
        currentDistrict,
        permanentFullAddress,
        permanentPincode,
        permanentDistrict,
        insuranceCompany,
        insurancePolicyNo,
        insuranceDueDate,
        permitValidUpto,
        fitnessValidUpto,
        pollutionValidUpto,
        mvTaxPaidUpto,
        leadSource,
        offence,
        panNumber,
        panAddress,
        gstin,
        legalName,
        gstTradeName,
        gstContact,
        gstEmail,
        khananPhone,
        customerType,
        status: lifecycle.status,
        nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : lifecycle.nextFollowUp,
        assignedExecutive: assignedExecutive || lifecycle.assignedExecutive
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    res.json({
      message: 'Vehicle trip summary saved successfully',
      data: summary
    });

  } catch (error) {
    console.error('Error saving vehicle trip summary:', error);
    res.status(500).json({
      error: 'Failed to save vehicle trip summary',
      details: error.message
    });
  }
});

// GET /api/vehicle/stats - Get vehicle statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await VehicleTripSummary.aggregate([
      {
        $group: {
          _id: null,
          totalVehicles: { $sum: 1 },
          totalTrips: { $sum: '$totalTrips' },
          totalWeight: { $sum: '$totalMTWeight' },
          sandTrips: { $sum: '$sandTrips' },
          stoneTrips: { $sum: '$stoneTrips' },
          avgTripsPerVehicle: { $avg: '$totalTrips' }
        }
      }
    ]);

    const result = stats[0] || {
      totalVehicles: 0,
      totalTrips: 0,
      totalWeight: 0,
      sandTrips: 0,
      stoneTrips: 0,
      avgTripsPerVehicle: 0
    };

    res.json(result);

  } catch (error) {
    console.error('Error fetching vehicle stats:', error);
    res.status(500).json({
      error: 'Failed to fetch vehicle stats',
      details: error.message
    });
  }
});

// GET /api/vehicle/owners - Get unique owners
router.get('/owners', async (req, res) => {
  try {
    const owners = await VehicleTripSummary.distinct('ownerName', {
      ownerName: { $ne: null, $exists: true }
    });
    res.json({ owners: owners.sort() });
  } catch (error) {
    console.error('Error fetching owners:', error);
    res.status(500).json({
      error: 'Failed to fetch owners',
      details: error.message
    });
  }
});

// POST /api/vehicle/sync - Trigger aggregation from KhananData
router.post('/sync', async (req, res) => {
  try {
    const { aggregateVehicles } = require('../utils/vehicleAggregator');
    const count = await aggregateVehicles();
    res.json({ message: 'Sync completed', count });
  } catch (error) {
    console.error('Sync failed:', error);
    res.status(500).json({ error: 'Sync failed', details: error.message });
  }
});

module.exports = router;