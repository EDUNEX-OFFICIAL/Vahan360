const KhananData = require('../models/KhananData');
const VehicleTripSummary = require('../models/VehicleTripSummary');
const { deriveLifecycleFields, normalizeVehicleRegNo } = require('./leadLifecycle');

async function aggregateVehicles() {
  console.log('Starting vehicle aggregation...');
  
  const aggregation = await KhananData.aggregate([
    {
      $group: {
        _id: { $toUpper: { $replaceAll: { input: '$vehicleRegNo', find: ' ', replacement: '' } } },
        totalTrips: { $sum: 1 },
        totalMTWeight: {
          $sum: {
            $convert: {
              input: '$quantity',
              to: 'double',
              onError: 0,
              onNull: 0
            }
          }
        },
        sandTrips: {
          $sum: {
            $cond: [{ $eq: [{ $toLower: '$mineralName' }, 'sand'] }, 1, 0]
          }
        },
        stoneTrips: {
          $sum: {
            $cond: [{ $eq: [{ $toLower: '$mineralName' }, 'stone'] }, 1, 0]
          }
        },
        // Take the last known owner name or consignee name as a proxy
        lastOwner: { $last: '$consigneeName' },
        lastDistrict: { $last: '$district' },
        lastDestination: { $last: '$destination' },
        lastDate: { $last: '$date' },
        lastTransportedDate: { $last: '$transportedDate' },
        lastMineral: { $last: '$mineralName' },
        lastSourceType: { $last: '$sourceType' }
      }
    }
  ]);

  console.log(`Aggregated ${aggregation.length} unique vehicles. Updating summaries...`);

  let updatedCount = 0;
  for (const item of aggregation) {
    const vehicleRegNo = normalizeVehicleRegNo(item._id);
    const existingSummary = await VehicleTripSummary.findOne({ vehicleRegNo })
      .select('status nextFollowUp assignedExecutive');
    const lifecycle = deriveLifecycleFields({
      existingStatus: existingSummary?.status,
      totalTrips: item.totalTrips,
      totalMTWeight: item.totalMTWeight,
      existingNextFollowUp: existingSummary?.nextFollowUp,
      existingAssignedExecutive: existingSummary?.assignedExecutive,
      ownerName: item.lastOwner,
    });

    await VehicleTripSummary.findOneAndUpdate(
      { vehicleRegNo },
      {
        vehicleRegNo,
        totalTrips: item.totalTrips,
        totalMTWeight: item.totalMTWeight,
        sandTrips: item.sandTrips,
        stoneTrips: item.stoneTrips,
        ownerName: item.lastOwner,
        vehicleCategory: item.totalMTWeight >= 15000 ? 'HGV' : item.totalMTWeight >= 3000 ? 'LGV' : item.totalMTWeight >= 500 ? 'LMV' : '2WN',
        currentDistrict: item.lastDistrict || '',
        permanentDistrict: item.lastDistrict || '',
        currentFullAddress: [item.lastDistrict, item.lastDestination].filter(Boolean).join(', '),
        permanentFullAddress: [item.lastDistrict, item.lastDestination].filter(Boolean).join(', '),
        leadSource: item.lastSourceType || 'Khanan',
        offence: item.lastMineral ? `Mineral: ${item.lastMineral}` : '',
        permitValidUpto: item.lastTransportedDate ? new Date(item.lastTransportedDate) : undefined,
        fitnessValidUpto: item.lastDate ? new Date(item.lastDate) : undefined,
        pollutionValidUpto: item.lastDate ? new Date(item.lastDate) : undefined,
        insuranceDueDate: item.lastDate ? new Date(item.lastDate) : undefined,
        khananPhone: '',
        customerType: /pvt|ltd|carrier|transport/i.test(item.lastOwner || '') ? 'Firm' : 'Individual',
        status: lifecycle.status,
        nextFollowUp: lifecycle.nextFollowUp,
        assignedExecutive: lifecycle.assignedExecutive,
      },
      { upsert: true, new: true }
    );
    updatedCount++;
  }

  console.log(`Successfully updated ${updatedCount} vehicle summaries.`);
  return updatedCount;
}

module.exports = { aggregateVehicles };
