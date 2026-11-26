import type { ReactNode, RefObject } from 'react';

import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { outOptionOf, type RosterLineTranslate } from '@/features/calendar/utils/day-detail';
import {
  candidateContinuousMessageKey,
  candidateContinuousOf,
  candidateGroupMessageKey,
} from '@/features/calendar/utils/replacement-candidates';
import {
  NO_CANDIDATE,
  RESOLUTION_CANDIDATES_HEADING_ID,
  RESOLUTION_SUGGESTIONS_HEADING_ID,
  candidateGroupHeadingId,
  hasCandidates,
  noSuggestionMessageKey,
  suggestionLineMessageKey,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import { t } from '@/lib/i18n';

/** A candidate line's words, through the one `t`, as the roster form's. */
const LINE_WORDS: RosterLineTranslate = {
  word: (key) => t(key),
  line: (key, values) => t(key, values),
};

/** A candidate's line, then `· 24 h bez pauze` when the shift would make a longer continuous duty (D717). */
function withContinuous(label: string, continuousMinutes: number | null): string {
  const continuous = candidateContinuousOf(continuousMinutes);

  if (continuous === null) return label;

  return t(candidateContinuousMessageKey(), { line: label, hours: t(continuous.key, continuous.values) });
}

/**
 * "Tko odrađuje smjenu" (story 5.4c; UX-DR10): the candidates to put on the
 * absent member's shift, a SIBLING after the second card — the card is a
 * `<button>` and cannot hold controls — shown only while that card is chosen.
 * Its own radio group: one tab stop, the arrow keys move, nothing preselected.
 *
 * The groups (`slobodan`, `radi taj dan`, `odsutnost taj dan`) only
 * inform: every candidate is selectable, none is disabled, styled apart or
 * recommended. Each line is `Ime · čin · položaj`, as the roster form builds
 * it (`outOptionOf`), then `· 24 h bez pauze` where the shift would make a
 * longer continuous duty (D717), and wraps rather than truncating. An empty
 * group is not drawn.
 *
 * STORY 21.13 (UX-DR77): with a floater in the organization, *Predložene
 * zamjene* comes first, each line ending in their shifts this month
 * (`· 1 smjena`), and those floaters are in no other group; with none free,
 * the line `Nema slobodne zamjene za posao {posao}.` stands above the groups.
 * A suggestion only informs too: nothing is preselected.
 */
export function ReplacementPicker({
  view,
  value,
  onValueChange,
  disabled,
  firstCandidate,
}: {
  readonly view: ResolutionView;
  /** The picked candidate's id, or `null` for nobody. */
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly disabled: boolean;
  /** The first candidate, where Spremi pressed with nobody picked sends focus. */
  readonly firstCandidate: RefObject<HTMLButtonElement | null>;
}): ReactNode {
  const firstId = [...view.suggestions, ...view.candidates.flatMap((group) => group.candidates)][0]?.id;
  const lineOf = (candidate: Parameters<typeof outOptionOf>[0] & { readonly continuousMinutes: number | null }): string =>
    withContinuous(outOptionOf(candidate, view.rankShown, view.positionShown, LINE_WORDS).label, candidate.continuousMinutes);

  return (
    <section className="grid min-w-0 gap-2 rounded-lg border bg-card p-3 sm:p-4" aria-labelledby={RESOLUTION_CANDIDATES_HEADING_ID}>
      <h3 id={RESOLUTION_CANDIDATES_HEADING_ID} className="text-sm font-semibold">
        {t('zaOdluku.resolution.candidatesHeading')}
      </h3>
      {view.noSuggestion === null ? null : (
        <p className="min-w-0 break-words text-sm text-muted-foreground">
          {t(noSuggestionMessageKey(view.noSuggestion.roleName), { posao: view.noSuggestion.roleName ?? undefined })}
        </p>
      )}
      {hasCandidates(view) ? (
        <RadioGroup
          aria-labelledby={RESOLUTION_CANDIDATES_HEADING_ID}
          value={value ?? NO_CANDIDATE}
          onValueChange={onValueChange}
          disabled={disabled}
          className="gap-3"
        >
          {view.suggestions.length === 0 ? null : (
            <div role="group" aria-labelledby={RESOLUTION_SUGGESTIONS_HEADING_ID} className="grid min-w-0 gap-1">
              <p id={RESOLUTION_SUGGESTIONS_HEADING_ID} className="text-xs font-medium text-muted-foreground">
                {t('zaOdluku.resolution.suggestions')}
              </p>
              {view.suggestions.map((candidate) => (
                <RadioRow key={candidate.id} ref={candidate.id === firstId ? firstCandidate : undefined} value={candidate.id}>
                  {t(suggestionLineMessageKey(), { line: lineOf(candidate), count: candidate.shiftsInMonth })}
                </RadioRow>
              ))}
            </div>
          )}
          {view.candidates.map((group) =>
            group.candidates.length === 0 ? null : (
              <div
                key={group.kind}
                role="group"
                aria-labelledby={candidateGroupHeadingId(group.kind)}
                className="grid min-w-0 gap-1"
              >
                <p id={candidateGroupHeadingId(group.kind)} className="text-xs font-medium text-muted-foreground">
                  {t(candidateGroupMessageKey(group.kind))}
                </p>
                {group.candidates.map((candidate) => (
                  <RadioRow
                    key={candidate.id}
                    ref={candidate.id === firstId ? firstCandidate : undefined}
                    value={candidate.id}
                  >
                    {lineOf(candidate)}
                  </RadioRow>
                ))}
              </div>
            ),
          )}
        </RadioGroup>
      ) : (
        <p className="min-w-0 break-words text-sm text-muted-foreground">{t('zaOdluku.resolution.noCandidates')}</p>
      )}
    </section>
  );
}
