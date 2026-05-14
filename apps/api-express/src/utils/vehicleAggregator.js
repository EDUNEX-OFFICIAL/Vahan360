const prisma = require('../db/prisma');
const log = require('../lib/logger');
const { deriveLifecycleFields, normalizeVehicleRegNo } = require('./leadLifecycle');

async function aggregateVehicles() {
  log.info({ msg: 'vehicle_aggregate_start' });

  const rows = await prisma.$queryRaw`
    SELECT
      upper(regexp_replace(k.vehicle_reg_no, '\\s', '', 'g')) AS grp_key,
      COUNT(*)::int AS total_trips,
      COALESCE(SUM(k.quantity::double precision), 0)::float AS total_mt_weight,
      SUM(CASE WHEN lower(k.mineral_name) = 'sand' THEN 1 ELSE 0 END)::int AS sand_trips,
      SUM(CASE WHEN lower(k.mineral_name) = 'stone' THEN 1 ELSE 0 END)::int AS stone_trips,
      (array_agg(k.consignee_name ORDER BY k.created_at DESC))[1] AS last_owner,
      (array_agg(k.district ORDER BY k.created_at DESC))[1] AS last_district,
      (array_agg(k.destination ORDER BY k.created_at DESC))[1] AS last_destination,
      (array_agg(k.date ORDER BY k.created_at DESC))[1] AS last_date,
      (array_agg(k.transported_date ORDER BY k.created_at DESC))[1] AS last_transported_date,
      (array_agg(k.mineral_name ORDER BY k.created_at DESC))[1] AS last_mineral,
      (array_agg(k.source_type ORDER BY k.created_at DESC))[1] AS last_source_type
    FROM khanan_data k
    GROUP BY upper(regexp_replace(k.vehicle_reg_no, '\\s', '', 'g'))
  `;

  log.info({ msg: 'vehicle_aggregate_grouped', vehicleCount: rows.length });

  let updatedCount = 0;
  for (const item of rows) {
    const vehicleRegNo = normalizeVehicleRegNo(item.grp_key);
    const totalTrips = Number(item.total_trips);
    const totalMtWeight = Number(item.total_mt_weight);
    const sandTrips = Number(item.sand_trips);
    const stoneTrips = Number(item.stone_trips);

    const existingSummary = await prisma.vehicleTripSummary.findUnique({
      where: { vehicleRegNo },
      select: { status: true, nextFollowUp: true, assignedExecutive: true },
    });

    const lifecycle = deriveLifecycleFields({
      existingStatus: existingSummary?.status,
      totalTrips,
      totalMTWeight: totalMtWeight,
      existingNextFollowUp: existingSummary?.nextFollowUp,
      existingAssignedExecutive: existingSummary?.assignedExecutive,
      ownerName: item.last_owner,
    });

    const parseMaybeDate = (v) => {
      if (!v) return undefined;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d;
    };

    await prisma.vehicleTripSummary.upsert({
      where: { vehicleRegNo },
      create: {
        vehicleRegNo,
        totalTrips,
        totalMtWeight,
        sandTrips,
        stoneTrips,
        ownerName: item.last_owner,
        vehicleCategory:
          totalMtWeight >= 15000
            ? 'HGV'
            : totalMtWeight >= 3000
              ? 'LGV'
              : totalMtWeight >= 500
                ? 'LMV'
                : '2WN',
        currentDistrict: item.last_district || '',
        permanentDistrict: item.last_district || '',
        currentFullAddress: [item.last_district, item.last_destination].filter(Boolean).join(', '),
        permanentFullAddress: [item.last_district, item.last_destination].filter(Boolean).join(', '),
        leadSource: item.last_source_type || 'Khanan',
        offence: item.last_mineral ? `Mineral: ${item.last_mineral}` : '',
        permitValidUpto: parseMaybeDate(item.last_transported_date),
        fitnessValidUpto: parseMaybeDate(item.last_date),
        pollutionValidUpto: parseMaybeDate(item.last_date),
        insuranceDueDate: parseMaybeDate(item.last_date),
        khananPhone: '',
        customerType: /pvt|ltd|carrier|transport/i.test(item.last_owner || '') ? 'Firm' : 'Individual',
        status: lifecycle.status,
        nextFollowUp: lifecycle.nextFollowUp,
        assignedExecutive: lifecycle.assignedExecutive,
      },
      update: {
        totalTrips,
        totalMtWeight,
        sandTrips,
        stoneTrips,
        ownerName: item.last_owner,
        vehicleCategory:
          totalMtWeight >= 15000
            ? 'HGV'
            : totalMtWeight >= 3000
              ? 'LGV'
              : totalMtWeight >= 500
                ? 'LMV'
                : '2WN',
        currentDistrict: item.last_district || '',
        permanentDistrict: item.last_district || '',
        currentFullAddress: [item.last_district, item.last_destination].filter(Boolean).join(', '),
        permanentFullAddress: [item.last_district, item.last_destination].filter(Boolean).join(', '),
        leadSource: item.last_source_type || 'Khanan',
        offence: item.last_mineral ? `Mineral: ${item.last_mineral}` : '',
        permitValidUpto: parseMaybeDate(item.last_transported_date),
        fitnessValidUpto: parseMaybeDate(item.last_date),
        pollutionValidUpto: parseMaybeDate(item.last_date),
        insuranceDueDate: parseMaybeDate(item.last_date),
        khananPhone: '',
        customerType: /pvt|ltd|carrier|transport/i.test(item.last_owner || '') ? 'Firm' : 'Individual',
        status: lifecycle.status,
        nextFollowUp: lifecycle.nextFollowUp,
        assignedExecutive: lifecycle.assignedExecutive,
        updatedAt: new Date(),
      },
    });
    updatedCount++;
  }

  log.info({ msg: 'vehicle_aggregate_complete', updatedCount });
  return updatedCount;
}

module.exports = { aggregateVehicles };
