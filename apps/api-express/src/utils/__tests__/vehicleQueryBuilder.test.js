const { buildVehicleTripSummaryQuery, buildVehicleTripSummaryWherePrisma } = require('../vehicleQueryBuilder');

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

  test('buildVehicleTripSummaryWherePrisma maps filters for Prisma', () => {
    const where = buildVehicleTripSummaryWherePrisma({
      status: 'In_Progress',
      minTrips: '5',
      minWeight: '1250.5',
      vehicleRegNo: 'BR01',
    });

    expect(where.AND).toBeDefined();
    const flat = where.AND;
    expect(flat.some((p) => p.status === 'in-progress')).toBe(true);
    expect(flat.some((p) => p.totalTrips?.gte === 5)).toBe(true);
    expect(flat.some((p) => p.totalMtWeight?.gte === 1250.5)).toBe(true);
    expect(flat.some((p) => p.OR?.length === 2)).toBe(true);
  });
});
