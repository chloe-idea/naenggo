/**
 * Compatibility re-exports. Source of truth: server/lib/household-api-handler.js
 * Vercel HTTP entries: api/households/*.js via _vercel-entry.js
 */
export {
  normalizeHouseholdRouteInput,
  normalizeHouseholdRouteParts,
  resolveHouseholdRoute,
  dispatchHouseholdApi,
  applyHouseholdApiResult,
  logHouseholdRouteDebug as logVercelHouseholdRouteDebug,
} from '../../server/lib/household-api-handler.js';
