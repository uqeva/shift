import { createRoute, lazyRouteComponent } from '@tanstack/react-router';

import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/timovi-i-raspored` — *Timovi i raspored* (story 21.26, UX-DR84): the
 * teams, their people, their rotation and the shift types on one page.
 *
 * THE FIRST LAZY ROUTE. The screen, `pages/timovi-i-raspored.tsx` (the
 * file that owns the path, titled as every destination's page is), is its
 * own chunk, fetched the first time the route renders, so the entry
 * chunk stays under the 3 MiB precache cap (`vite.config.ts`). The chunk is
 * still precached by the worker (`globPatterns`), so the page opens offline
 * once installed. `TimoviIRasporedLazy` is exported so `router.test.ts`
 * pins the route's component by identity, as it pins every destination's,
 * and preloads it to prove the module names the screen.
 *
 * ADMIN ONLY, under the shared admin guard.
 */
export const TimoviIRasporedLazy = lazyRouteComponent(
  () => import('@/pages/timovi-i-raspored'),
  'TimoviIRasporedScreen',
);

export const timoviIRasporedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/timovi-i-raspored',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: TimoviIRasporedLazy,
});
