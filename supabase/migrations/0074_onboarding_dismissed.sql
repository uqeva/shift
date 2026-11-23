-- 0074_onboarding_dismissed.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 19.4 (AD-24, UX-DR69): the onboarding card's one stored fact.
--
-- One change, and nothing else: `organizations.onboarding_dismissed`, whether
-- an admin hid the *Postavljanje* card on *Danas*. Every step's progress is
-- DERIVED from the rows the shipped surfaces already read (a band, a team not
-- archived, a shift type not archived, a rotation assignment, more than one
-- member); no column holds a step, a count or a skip (AD-1, AD-24).
--
-- NOT NULL, DEFAULT FALSE. Every existing organization, operator-provisioned
-- or founded by signup, starts not dismissed. The card is drawn only for an
-- organization founded by signup (`founded_by` set, 0071), so an operator-
-- provisioned one never sees it whatever this holds.
--
-- PER ORGANIZATION, one column: dismissing hides the card for every admin
-- (UX-DR69). Recorded by 0061's `organizations_audit_update` as a field, like
-- every other organization setting (the history names it).

alter table public.organizations
  add column onboarding_dismissed boolean not null default false;

-- JOINS the column grants, as 0048's `minimum_members` did: column grants are
-- unioned, so this adds one writable column and leaves every other exactly as
-- it was. WHO may write it is 0004's `organizations_update_by_own_active_admin`,
-- unchanged: an active admin of the organization, and nobody else.
grant update (onboarding_dismissed) on table public.organizations to authenticated;
