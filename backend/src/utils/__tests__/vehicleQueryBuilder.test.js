const { buildVehicleTripSummaryQuery } = require('../vehicleQueryBuilder');

describe('vehicleQueryBuilder', () => {
  test('maps status filter from spring style values', () => {
    const query = buildVehicleTripSummaryQuery({
      status: 'In_Progress',
      minTrips: '5',
      minWeight: '1250.5',
    });

    expect(query.status).toBe('in-progress');
    expect(query.totalTrips).toEqual({ $gte: 5 });
    expect(query.totalMTWeight).toEqual({ $gte: 1250.5 });
  });

  test('builds table filter and date ranges', () => {
    const query = buildVehicleTripSummaryQuery({
      filterField: 'ownerName',
      filterOp: 'startsWith',
      filterValue: 'Amit',
      createdDateFrom: '2026-01-01',
      createdDateTo: '2026-01-02',
      nextFollowUpFrom: '2026-01-03',
      nextFollowUpTo: '2026-01-04',
    });

    expect(query.ownerName).toBeInstanceOf(RegExp);
    expect(query.createdAt.$gte).toBeInstanceOf(Date);
    expect(query.createdAt.$lte).toBeInstanceOf(Date);
    expect(query.nextFollowUp.$gte).toBeInstanceOf(Date);
    expect(query.nextFollowUp.$lte).toBeInstanceOf(Date);
  });

  test('supports status table filter mapping for equals', () => {
    const query = buildVehicleTripSummaryQuery({
      filterField: 'status',
      filterOp: 'equals',
      filterValue: 'Converted',
    });

    expect(query.status).toBe('completed');
  });
});
