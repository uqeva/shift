import { beforeAll, describe, expect, it, vi } from 'vitest';

import { RESOLUTION_READY, resolutionScreenOf, type ResolutionSources } from '@/features/conflicts/services/resolution-screen';
import { A, ANA, IVA, leaveRowOf, planningSnapshotOf } from '@/features/planning/planning.fixture';
import { initLocalization } from '@/lib/i18n';

/**
 * STORY 21.13 (review 1, 5a): a floater row the suggestions cannot derive
 * from — a breached precondition of the domain, a `RangeError` — leaves the
 * resolution screen READY with no block; the suggestions only inform. The
 * adapter is replaced by one that throws, as one floater's malformed data
 * would make it.
 */

vi.mock('@/features/conflicts/services/floater-suggestions', async (original) => {
  const actual = await original<typeof import('@/features/conflicts/services/floater-suggestions')>();

  return {
    ...actual,
    floaterSuggestionsOfConflict: () => {
      throw new RangeError('a floater row breaks a precondition');
    },
  };
});

const NOW = new Date('2026-10-01T08:00:00Z');

function settled(rows: readonly unknown[]) {
  return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
}

beforeAll(async () => {
  await initLocalization();
});

describe('a floater that cannot be derived (story 21.13)', () => {
  it('leaves the screen ready, with no suggestion and no none line, and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const snapshot = await planningSnapshotOf();
    const sources: ResolutionSources = {
      calendar: { snapshot, refusal: null, loading: false },
      records: settled([leaveRowOf('00000000-0000-4000-8000-00000000f301', ANA, '2026-10-08', '2026-10-09')]),
      resolutions: settled([]),
      requests: settled([]),
      swaps: settled([]),
      members: {
        members: snapshot.members.map((member) => ({
          id: member.id,
          leaveAllowance: { startingDays: 20, versions: [] },
          isFloater: member.id === IVA,
          floaterRoleIds: [],
        })),
        refusal: null,
        loading: false,
        paused: false,
      },
      organization: {
        data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
        isPending: false,
        isError: false,
        fetchStatus: 'idle',
      },
    };
    const screen = resolutionScreenOf(sources, { memberId: ANA, date: '2026-10-08', teamId: A }, NOW);

    expect(screen.kind).toBe(RESOLUTION_READY);
    if (screen.kind !== RESOLUTION_READY) return;
    expect(screen.view.suggestions).toEqual([]);
    expect(screen.view.noSuggestion).toBeNull();
    expect(screen.view.candidates.flatMap((group) => group.candidates.map((one) => one.id))).toContain(IVA);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
