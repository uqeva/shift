/**
 * *Ručni raspored*'s element ids and the picker's one option value (story
 * 21.4), as a `.ts` so the screen's files hold no literal the literal sweep
 * would read as text (the `members/utils/element-ids` precedent).
 */

/** The picker's heading. */
export const PICKER_HEADING_ID = 'rucni-raspored-picker-heading';
/** *Računaj u tim…*. */
export const PICKER_TEAM_ID = 'rucni-raspored-picker-team';
/** *Očisti*'s hint. */
export const PICKER_CLEAR_HINT_ID = 'rucni-raspored-picker-clear-hint';
/** *Računaj u tim…*'s first option: the member's own (effective) team (R14.3). */
export const OWN_TEAM = '';
/** *Što se mijenja*'s heading. */
export const PREVIEW_HEADING_ID = 'rucni-raspored-preview-heading';
/** The erasure confirmation's id prefix. */
export const ERASURES_ID = 'rucni-raspored-erasures';
/** The phone's *Osoba*. */
export const PERSON_FIELD_ID = 'rucni-raspored-person';
/** *Popuni uzorkom* and *Kopiraj*'s buttons (story 21.5): where focus returns when their dialog closes. */
export const FILL_OPEN_ID = 'rucni-raspored-fill-open';
export const COPY_OPEN_ID = 'rucni-raspored-copy-open';
/** The two dialogs' headings and fields. */
export const FILL_HEADING_ID = 'rucni-raspored-fill-heading';
export const FILL_FROM_ID = 'rucni-raspored-fill-from';
export const FILL_TO_ID = 'rucni-raspored-fill-to';
export const FILL_OFFSET_ID = 'rucni-raspored-fill-offset';
export const FILL_OFFSET_HINT_ID = 'rucni-raspored-fill-offset-hint';
export const COPY_HEADING_ID = 'rucni-raspored-copy-heading';
export const COPY_MODE_ID = 'rucni-raspored-copy-mode';
export const COPY_SOURCE_ID = 'rucni-raspored-copy-source';
export const COPY_TARGET_ID = 'rucni-raspored-copy-target';
/** A step row's two fields, by its position. */
export function fillStepChoiceIdOf(position: number): string {
  return `rucni-raspored-fill-step-${String(position)}`;
}
export function fillStepCountIdOf(position: number): string {
  return `rucni-raspored-fill-count-${String(position)}`;
}
/** A person's checkbox in a dialog. */
export function planPersonIdOf(memberId: string): string {
  return `rucni-raspored-plan-${memberId}`;
}
