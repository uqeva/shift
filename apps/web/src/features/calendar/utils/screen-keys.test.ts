import { describe, expect, it } from 'vitest';

import { type CalendarMonth } from '@/features/calendar/utils/month';
import { gridFocusKeyOf } from '@/features/calendar/utils/screen-keys';

/** As much of a month as the keys read: its month, the team and the person chosen. */
function monthOf(month: string, chosen: string | null, person: string | null, role: string | null = null): CalendarMonth {
  return { month, filter: { chosen, person, role } } as unknown as CalendarMonth;
}

describe('the keys the calendar screen resets on', () => {
  it('has no grid key while no month is shown', () => {
    expect(gridFocusKeyOf(null)).toBeNull();
  });

  it('changes the grid key with the month, the team and the person, each alone', () => {
    const base = gridFocusKeyOf(monthOf('2026-09', null, null));

    expect(gridFocusKeyOf(monthOf('2026-09', null, null))).toBe(base);
    expect(gridFocusKeyOf(monthOf('2026-10', null, null))).not.toBe(base);
    expect(gridFocusKeyOf(monthOf('2026-09', 'team-a', null))).not.toBe(base);
    expect(gridFocusKeyOf(monthOf('2026-09', null, 'member-a'))).not.toBe(base);
    // Story 21.25: the job role chosen too.
    expect(gridFocusKeyOf(monthOf('2026-09', null, null, 'role-a'))).not.toBe(base);
    expect(gridFocusKeyOf(monthOf('2026-09', 'team-a', null))).not.toBe(
      gridFocusKeyOf(monthOf('2026-09', null, 'team-a')),
    );
  });
});
