/** Maps CRM “spring” statuses to dashboard pipeline buckets (shared across leads + pipeline UI). */

export type PipelineTabStatus = 'pending' | 'in-progress' | 'completed';

export const SPRING_STATUS_TO_PIPELINE: Record<string, PipelineTabStatus> = {
  new: 'pending',
  open: 'pending',
  pending: 'pending',
  todo: 'pending',
  scheduled: 'pending',
  assigned: 'in-progress',
  inprogress: 'in-progress',
  'in-progress': 'in-progress',
  in_progress: 'in-progress',
  followup: 'in-progress',
  'follow-up': 'in-progress',
  working: 'in-progress',
  completed: 'completed',
  closed: 'completed',
  converted: 'completed',
  won: 'completed',
};

export function normalizeSpringPipelineStatus(value?: string): PipelineTabStatus {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return SPRING_STATUS_TO_PIPELINE[cleaned] || 'pending';
}
