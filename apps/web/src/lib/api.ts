/**
 * Thin re-exports so pages share one import surface for API base URLs
 * (see checklist §14 — avoids duplicating NEXT_PUBLIC_API_BASE_URL snippets).
 */
export { apiUrl, getApiBaseUrl } from '@/lib/api-client';
