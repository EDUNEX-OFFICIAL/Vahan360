const DEFAULT_STATUSES = ['pending', 'in-progress', 'completed'];

const SPRING_TO_PIPELINE_STATUS = new Map([
  ['new', 'pending'],
  ['open', 'pending'],
  ['pending', 'pending'],
  ['todo', 'pending'],
  ['scheduled', 'pending'],
  ['assigned', 'in-progress'],
  ['inprogress', 'in-progress'],
  ['in-progress', 'in-progress'],
  ['in_progress', 'in-progress'],
  ['followup', 'in-progress'],
  ['follow-up', 'in-progress'],
  ['working', 'in-progress'],
  ['completed', 'completed'],
  ['closed', 'completed'],
  ['converted', 'completed'],
  ['won', 'completed'],
]);

const AUTO_ASSIGNMENT_POOL = ['TEAM_ALPHA', 'TEAM_BRAVO', 'TEAM_CHARLIE'];

function normalizeVehicleRegNo(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

function normalizeStatusToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function mapSpringStatusToPipelineStatus(value, fallback = 'pending') {
  const normalized = normalizeStatusToken(value);
  if (!normalized) return fallback;

  if (DEFAULT_STATUSES.includes(normalized)) {
    return normalized;
  }

  const compact = normalized.replace(/-/g, '');
  if (SPRING_TO_PIPELINE_STATUS.has(normalized)) {
    return SPRING_TO_PIPELINE_STATUS.get(normalized);
  }
  if (SPRING_TO_PIPELINE_STATUS.has(compact)) {
    return SPRING_TO_PIPELINE_STATUS.get(compact);
  }

  return fallback;
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function addDays(baseDate, daysToAdd) {
  const result = new Date(baseDate);
  result.setDate(result.getDate() + daysToAdd);
  result.setHours(10, 0, 0, 0);
  return result;
}

function inferStatusFromMetrics(totalTrips, totalMTWeight) {
  const trips = Number.isFinite(totalTrips) ? totalTrips : Number(totalTrips) || 0;
  const weight = Number.isFinite(totalMTWeight) ? totalMTWeight : Number(totalMTWeight) || 0;

  if (trips >= 25 || weight >= 5000) return 'completed';
  if (trips >= 5 || weight >= 1500) return 'in-progress';
  return 'pending';
}

function inferAssignedExecutive(existingAssignedExecutive, ownerName) {
  if (existingAssignedExecutive) return existingAssignedExecutive;
  const seed = String(ownerName || '').trim().toUpperCase();
  if (!seed) return 'UNASSIGNED';

  let score = 0;
  for (let index = 0; index < seed.length; index += 1) {
    score += seed.charCodeAt(index);
  }
  return AUTO_ASSIGNMENT_POOL[score % AUTO_ASSIGNMENT_POOL.length];
}

function deriveLifecycleFields({
  incomingStatus,
  existingStatus,
  totalTrips,
  totalMTWeight,
  existingNextFollowUp,
  existingAssignedExecutive,
  ownerName,
  referenceDate = new Date(),
} = {}) {
  const mappedIncoming = mapSpringStatusToPipelineStatus(incomingStatus, '');
  const mappedExisting = mapSpringStatusToPipelineStatus(existingStatus, '');
  const status = mappedIncoming || mappedExisting || inferStatusFromMetrics(totalTrips, totalMTWeight);

  let nextFollowUp;
  if (status !== 'completed') {
    if (isValidDate(existingNextFollowUp)) {
      nextFollowUp = existingNextFollowUp;
    } else {
      nextFollowUp = addDays(referenceDate, status === 'pending' ? 1 : 3);
    }
  }

  return {
    status,
    nextFollowUp,
    assignedExecutive: inferAssignedExecutive(existingAssignedExecutive, ownerName),
  };
}

module.exports = {
  mapSpringStatusToPipelineStatus,
  deriveLifecycleFields,
  normalizeVehicleRegNo,
};
