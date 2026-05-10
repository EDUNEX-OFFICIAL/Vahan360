const express = require('express');
const prisma = require('../db/prisma');
const { buildVehicleTripSummaryWherePrisma } = require('../utils/vehicleQueryBuilder');
const { deriveLifecycleFields, normalizeVehicleRegNo } = require('../utils/leadLifecycle');
const { serializeVehicleTripSummaryRow } = require('../utils/serializeApi');

const router = express.Router();

// GET /api/vehicle/trip-summary - Get vehicle trip summaries
router.get('/trip-summary', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const where = buildVehicleTripSummaryWherePrisma(req.query);

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNumber - 1) * limitNumber;

    const [rows, total] = await Promise.all([
      prisma.vehicleTripSummary.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNumber,
      }),
      prisma.vehicleTripSummary.count({ where }),
    ]);

    const data = rows.map(serializeVehicleTripSummaryRow);

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

    const summary = await prisma.vehicleTripSummary.findFirst({
      where: {
        vehicleRegNo: { equals: vehicleRegNo, mode: 'insensitive' },
      },
    });

    if (!summary) {
      return res.status(404).json({
        error: 'Vehicle trip summary not found'
      });
    }

    res.json({ data: serializeVehicleTripSummaryRow(summary) });

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

    const existingSummary = await prisma.vehicleTripSummary.findUnique({
      where: { vehicleRegNo: normalizedVehicleRegNo },
      select: {
        status: true,
        nextFollowUp: true,
        assignedExecutive: true,
      },
    });

    const lifecycle = deriveLifecycleFields({
      incomingStatus: status,
      existingStatus: existingSummary?.status,
      totalTrips,
      totalMTWeight,
      existingNextFollowUp: existingSummary?.nextFollowUp,
      existingAssignedExecutive: existingSummary?.assignedExecutive,
      ownerName,
    });

    const summary = await prisma.vehicleTripSummary.upsert({
      where: { vehicleRegNo: normalizedVehicleRegNo },
      create: {
        vehicleRegNo: normalizedVehicleRegNo,
        totalTrips: totalTrips || 0,
        totalMtWeight: totalMTWeight || 0,
        sandTrips: sandTrips || 0,
        sandMtWeight: sandMTWeight || 0,
        stoneTrips: stoneTrips || 0,
        stoneMtWeight: stoneMTWeight || 0,
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
        insuranceDueDate: insuranceDueDate ? new Date(insuranceDueDate) : undefined,
        permitValidUpto: permitValidUpto ? new Date(permitValidUpto) : undefined,
        fitnessValidUpto: fitnessValidUpto ? new Date(fitnessValidUpto) : undefined,
        pollutionValidUpto: pollutionValidUpto ? new Date(pollutionValidUpto) : undefined,
        mvTaxPaidUpto: mvTaxPaidUpto ? new Date(mvTaxPaidUpto) : undefined,
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
        assignedExecutive: assignedExecutive || lifecycle.assignedExecutive,
      },
      update: {
        totalTrips: totalTrips || 0,
        totalMtWeight: totalMTWeight || 0,
        sandTrips: sandTrips || 0,
        sandMtWeight: sandMTWeight || 0,
        stoneTrips: stoneTrips || 0,
        stoneMtWeight: stoneMTWeight || 0,
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
        insuranceDueDate: insuranceDueDate ? new Date(insuranceDueDate) : undefined,
        permitValidUpto: permitValidUpto ? new Date(permitValidUpto) : undefined,
        fitnessValidUpto: fitnessValidUpto ? new Date(fitnessValidUpto) : undefined,
        pollutionValidUpto: pollutionValidUpto ? new Date(pollutionValidUpto) : undefined,
        mvTaxPaidUpto: mvTaxPaidUpto ? new Date(mvTaxPaidUpto) : undefined,
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
        assignedExecutive: assignedExecutive || lifecycle.assignedExecutive,
        updatedAt: new Date(),
      },
    });

    res.json({
      message: 'Vehicle trip summary saved successfully',
      data: serializeVehicleTripSummaryRow(summary)
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
    const agg = await prisma.vehicleTripSummary.aggregate({
      _count: { _all: true },
      _sum: {
        totalTrips: true,
        totalMtWeight: true,
        sandTrips: true,
        stoneTrips: true,
      },
      _avg: {
        totalTrips: true,
      },
    });

    const result = {
      totalVehicles: agg._count._all,
      totalTrips: agg._sum.totalTrips || 0,
      totalWeight: agg._sum.totalMtWeight || 0,
      sandTrips: agg._sum.sandTrips || 0,
      stoneTrips: agg._sum.stoneTrips || 0,
      avgTripsPerVehicle: agg._avg.totalTrips ?? 0,
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
    const rows = await prisma.vehicleTripSummary.findMany({
      where: { ownerName: { not: null } },
      distinct: ['ownerName'],
      select: { ownerName: true },
      orderBy: { ownerName: 'asc' },
    });
    const owners = rows.map(r => r.ownerName).filter(Boolean);
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
