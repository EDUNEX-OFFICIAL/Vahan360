const {
  mapSpringStatusToPipelineStatus,
  deriveLifecycleFields,
  normalizeVehicleRegNo,
} = require('../leadLifecycle');

describe('leadLifecycle', () => {
  test('maps Spring statuses into pipeline statuses', () => {
    expect(mapSpringStatusToPipelineStatus('NEW')).toBe('pending');
    expect(mapSpringStatusToPipelineStatus('In_Progress')).toBe('in-progress');
    expect(mapSpringStatusToPipelineStatus('converted')).toBe('completed');
    expect(mapSpringStatusToPipelineStatus('completed')).toBe('completed');
  });

  test('normalizes vehicle registration number format', () => {
    expect(normalizeVehicleRegNo(' br 01 ab 1234 ')).toBe('BR01AB1234');
  });

  test('infers lifecycle when status is missing', () => {
    const lifecycle = deriveLifecycleFields({
      totalTrips: 8,
      totalMTWeight: 1700,
      ownerName: 'Test Carrier Pvt Ltd',
      referenceDate: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(lifecycle.status).toBe('in-progress');
    expect(lifecycle.assignedExecutive).toMatch(/^TEAM_/);
    expect(lifecycle.nextFollowUp).toBeInstanceOf(Date);
  });

  test('keeps existing follow-up for non-completed records', () => {
    const existingFollowUp = new Date('2026-01-05T10:00:00.000Z');
    const lifecycle = deriveLifecycleFields({
      existingStatus: 'Pending',
      existingNextFollowUp: existingFollowUp,
      existingAssignedExecutive: 'AGENT_1',
      totalTrips: 1,
      ownerName: 'Someone',
    });

    expect(lifecycle.status).toBe('pending');
    expect(lifecycle.nextFollowUp).toEqual(existingFollowUp);
    expect(lifecycle.assignedExecutive).toBe('AGENT_1');
  });

  test('removes follow-up when status resolves to completed', () => {
    const lifecycle = deriveLifecycleFields({
      incomingStatus: 'CONVERTED',
      existingNextFollowUp: new Date('2026-01-05T10:00:00.000Z'),
      totalTrips: 30,
      totalMTWeight: 8000,
    });

    expect(lifecycle.status).toBe('completed');
    expect(lifecycle.nextFollowUp).toBeUndefined();
  });
});
