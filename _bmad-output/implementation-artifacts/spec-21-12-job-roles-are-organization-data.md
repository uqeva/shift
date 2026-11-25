---
title: 'Story 21.12: job roles are organization data'
type: 'feature'
created: '2026-11-25'
status: 'in-review'
baseline_commit: 'dc02fff50d307a52462f712aabd1bb052afb0132'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad/custom/bmad-build.toml'
---

Status: built, CI pending (no PR yet). Baseline: `origin/main` at `dc02fff` (#367, story 21.23). Touches the hot file `hr.json`; 21.4 (in progress in parallel) touches it too: whichever merges second rebases and keeps the other's wording. Migration **0078** only (main is at 0077); another story's migration waits for this one.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the pilot's people have jobs the fixed lists cannot name (cleaners *Čistačica*, dispatchers *Dispečer*, seasonal *Sezonac*, a crew's *Vod*). The staging rehearsal recorded *Vod* as rank `nco`, a workaround. Admins cannot name these jobs, show them or filter by them, and 21.13's floater eligibility needs them.

**Approach:** additive (AD-26). A new current-state table `job_roles` (name, archive, no delete) and a nullable `members.job_role_id`. An admin manages roles in *Organizacija → Poslovi* and sets a member's *Posao* on the member page. The role shows beside the name in *Ljudi* and in the calendar's day detail, and *Ljudi*'s *Filtri* panel gains a *Posao* chip. No derivation, notification or AD-5 guard reads a role. FR-18a's ranks and team positions are untouched: *Vod*, or any organization-specific title, is a job role.

## Boundaries & Constraints

**Always:**
- **ABSOLUTE RULES (founder, verbatim, pass to any subagent):** Follow every rule in `_bmad/custom/bmad-build.toml`, including the theme tests on CSS changes. Never run `pnpm exec vitest run` without explicit file arguments. Never run DB-connecting tests, e2e or `supabase` commands; never touch docker containers, staging or the stopped manual-test stack; never `pkill`. Allowed: typecheck, lint, `pnpm build`, the package and web unit tests, and the DB-free root tests by name. Do not run gitleaks. The repo is PUBLIC: no IPs, hostnames, real names or secrets.
- Migration `supabase/migrations/0078_job_roles.sql`, forward-only. Nothing is seeded (DI-8). RLS on, AD-3's two audit triggers, TRUNCATE revoked from every session role, `anon` holds nothing.
- `job_roles`: `organization_id` first (cascade from organizations), `id`, `name`, `archived boolean not null default false`, AD-11's `created_by`/`created_at`. Named checks `job_roles_name_not_blank` (`private.name_key(name) <> ''`), `job_roles_name_length` (≤ 100), `job_roles_name_characters` (0076's class). `unique (organization_id, id)` for composite keys. Unique index `job_roles_organization_name_key` on `(organization_id, private.name_key(name)) where not archived`.
- Policies: every active member of the claimed organization selects (archived included); an active admin inserts (`created_by = auth.uid()` pinned) and updates (rename, archive, restore). No delete policy or privilege. Grants: insert `(organization_id, name)`, update `(name, archived)`.
- `members.job_role_id uuid` nullable, constraint `members_job_role_fkey` `(organization_id, job_role_id) → job_roles (organization_id, id)`, no cascade, with an index; `grant update (job_role_id) on members to authenticated` (0056's rule; the existing member policies decide who).
- `calendar_members()` is dropped and re-created with the same scope, pins and grants, returning `(id uuid, name text, fire_rank text, job_role_id uuid, job_role text)`; `job_role` is the role's name (archived too), by a left join on the same tenant. No other function is created or changed.
- Every root-test inventory is updated in the same change, unrun: `test/provisioning.test.ts` (the RLS table list, the audited list `AUDITED`/count 23→24, the members column-privilege list, a `job_roles` privilege case like `absence_types`'), `test/rls-isolation.test.ts` (`AUDITED_TABLES`, the two `calendar_members` key-set assertions, and new `job_roles` cases), `test/supabase-scaffold.test.ts` (policy names, its audited list, the `calendar_members` pin reading the LAST definition, the members grant pin). DB-test scenes are built as the owner before `actAs`; expected codes and names are read from 0078.
- Copy in `hr.json` (`Posao`, `Poslovi`, `Bez posla`, …); teams are *Tim/Timovi*; the product is *Smjenko*.

**Ask First:** turning ranks or team positions into job roles, or migrating any rank/position value; letting a role feed a derivation; a role column in *Ljudi*'s table beyond the name cell.

**Never:** seeding a role; deleting a role; a notification on a role change (E-3); an AD-5 guard on a role write; reading a role in `packages/domain` derivations or `member_schedule_inputs`; `floater_roles` or `is_floater` (21.13).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | admin adds `Dispečer` | row stored, history records it | blank/long/control char → named 23514, dialog keeps input |
| Duplicate | live `Dispečer` exists; add ` dispečer ` | refused | 23505 `job_roles_organization_name_key` → "name taken" |
| Archive / restore | admin archives, later restores | hidden from the *Posao* picker, still shown on members holding it; restore puts it back | restore over a live same-name role → 23505, "name taken" |
| Member role | admin picks `Vod` on member page | `members.job_role_id` set; fact, *Ljudi* and day detail show it | another tenant's id → FK 23503, unavailable message |
| No role | *Bez posla* | `job_role_id` null; nothing beside the name | — |
| Member-role session | reads | sees role names and each member's role (calendar); cannot insert/update/delete a role | 42501 |
| Filter | *Ljudi* `?posao=<id>` / `?posao=none` | only members with that role / none; faceted counts; unknown id → all | — |
| No roles in org | snapshot with no member holding a role | no *Posao* chip drawn | — |

## Epic AC Deviations

- "*Ručni raspored* … the role shows beside the name and is a filter chip": the grid is 21.4's, in progress in parallel, and does not exist on this baseline. DEFERRED to 21.4 as a required input (`deferred-work.md`): read `jobRole` off the members (as here) and reuse the *Posao* facet helpers.
- "the calendar's day detail … is a filter chip": the day detail shows the role; no role chip on *Kalendar*. Its month is team columns, so narrowing by role has no meaning there. The person-row surface that a role filter fits is the grid (21.4). DEFERRED with the entry above.
- "the directory": read as *Ljudi* for admins (the people list). The member-role directory (`team_roster()`) does not show the role yet; DEFERRED (owner: product, a later story replacing `team_roster`).
- "archives": archive is reversible (*Vrati*), unlike a team's, since a role carries no history that a restore could falsify; a member may keep an archived role, which still shows.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0076_*.sql`, `0052_absence_types.sql`, `0009_teams.sql`, `0018_calendar_members.sql`, `0056_*.sql`, `0077_personal_assignments.sql:159-171` -- patterns: control-char class, name key/length checks, policy shape, partial name index, the function being replaced, the members column grant, the audit trigger pair.
- NEW `apps/web/src/features/job-roles/services/list.ts`, `write.ts` (+ tests) -- `JOB_ROLES_TABLE`, `JOB_ROLES_LIST_KEY`, query options, row parser (`{id,name,archived}`), refusal mapping (23505 → taken, 23514 by constraint name → invalid, 42501 → refused, else unavailable), create/rename/archive/restore. Model on `features/absence-types/services/*`.
- NEW `features/organization/hooks/use-organization-job-roles.ts`, `components/organization-job-roles-card.tsx` -- *Poslovi* card: live roles by name, then archived (marked *arhiviran*), *Dodaj*, per row *Uredi* (name dialog) and *Arhiviraj*/*Vrati*; offline gate as the absence-types card. Wire into `pages/organizacija.tsx`, `organization-settings-card.tsx`, `services/surface-keys.ts` (`ORGANIZATION_SURFACE_KEYS`), `utils/element-ids.ts`, `settings-screen.fixture.ts`.
- `features/members/services/list.ts` -- `MEMBERS_COLUMNS` embeds `job_role:job_roles!members_job_role_fkey(id,name,archived)` (the FK hint keeps it unambiguous once 21.13's `floater_roles` adds a second path); `MemberListRow.jobRole: {id,name,archived} | null`; parser; the *Posao* facet in `narrowMembers` (new trailing param, default all), `MembersFilters.role`, URL `posao` (`all`/`none`/id, unknown → all), `CHIP_ROLE` in `MEMBER_CHIPS` and the choice/removal/active/count helpers, `membersSearchKeyOf`.
- `features/members/components/member-filters.tsx` -- the *Posao* chip, drawn only while its options name a role or one is chosen. `member-table.tsx`, `member-rows.tsx` -- role in muted text under/after the name. `hooks/use-member-list.ts` -- store/apply as the team filter does.
- `features/members/services/write.ts` -- `MemberFields.jobRoleId?: string | null` (absent = untouched), `memberPatchOf` → `job_role_id`, `MEMBER_EDIT_COLUMNS` adds it. `hooks/use-member-basics.ts`, `components/member-basics-card.tsx` -- *Posao* fact; a *Posao* `Select` in the basics dialog (*Bez posla*, live roles, plus the member's archived one) drawn only once the roles read answered.
- `features/calendar/services/snapshot.ts` (`identitiesOf`, `CalendarMember`), `utils/day-detail.ts`, `components/day-detail-dialog.tsx` -- carry `jobRole: {id,name} | null`; the roster line appends the role in muted text. `lib/offline/persistence.ts` -- `DEVICE_SNAPSHOT_SHAPE` 4→5. Fixtures building `CalendarMember`/`MemberListRow` (`rotation/rotation.fixture.ts`, ~21 test files with `fireRank:`) gain the field.
- `packages/domain/src/history.ts` (+ test) -- record `job-role` (`job_roles`), field `jobRole` (`job_role_id`, operand type `job-role`); `features/history/services/history-rows.ts` + its names read -- resolve role names like absence types.
- `features/teams/services/dependents.ts` -- a role write re-reads `JOB_ROLES_LIST_KEY`, the members list and the calendar snapshot.
- Tests: `test/provisioning.test.ts:690-760,936-980,1899,2447-2454`; `test/rls-isolation.test.ts:10070-10300,27578-27592`; `test/supabase-scaffold.test.ts:540-620,1234-1268,3398,3445,4876+`; `test/resource-hygiene.test.ts` (new `hr.json` keys); page sweeps `pages/key-sources.fixture.ts`, `source-guards.fixture.ts`, structural pins as they fail.
- e2e: `e2e/utils/database-helper.ts` -- `cleanUpJobRolesInSql(slug, names)`: null `members.job_role_id`, then delete the roles, one transaction. NEW `e2e/tests/organization/job-roles.spec.ts` -- add a role, set it on a member, see it in *Ljudi*, filter by it; cleanup in `afterAll`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0078_job_roles.sql` -- the table, checks, index, policies, grants, triggers, column, FK, index, grant, `calendar_members` replacement -- per Always.
- [x] `features/job-roles/*`, the *Poslovi* card and hook, Organizacija wiring -- admin manages roles.
- [x] Member page *Posao* (write, hook, card, dialog) -- set a member's role.
- [x] *Ljudi* read, name-cell role, *Posao* facet and chip -- show and filter.
- [x] Calendar snapshot, day detail, persistence shape -- show.
- [x] History record/field -- the audit reads well.
- [x] Root tests, unit tests (I/O matrix rows: parser, refusals, facet counts, URL round-trip, picker options), e2e helper and spec.
- [x] Docs: spine AD-26 `Amended 2026-11-25 (story 21.12, 0078)` (as shipped: reversible archive, the `calendar_members` replacement, the FK hint, ranks/positions unchanged); DESIGN.md (*Poslovi* card, *Posao* chip/line), EXPERIENCE.md; `epics.md` UX-DR76 note; `deferred-work.md` entries per Deviations and the *Vod* sub-bullet marked `RESOLVED in part … by 21.12`; `sprint-status.yaml` `review  # built, CI pending (0078)`.

**Acceptance Criteria:**
- Given no role in an organization, when any screen renders, then it is byte-for-byte as before apart from the *Poslovi* card, and every domain parity fixture is unchanged.
- Given the migration, when the root inventories are read, then `job_roles` is in every RLS, audited and policy list and `calendar_members` returns the five named columns.

## Spec Change Log

- Review loop 1 (2026-11-25): blind hunter, edge-case hunter, verification gap, Epic AC auditor (no unlisted deviation), unrun DB test auditor (nothing that fails CI). No bad_spec or intent_gap. Patched: the *Posao* picker always offers the held role and writes only a changed pick (`jobRoleEditOf`), so a stale roles list can no longer clear a member's role; `calendar_members()` rows without the role keys read as no role (SPA before `db push`), and 0078 states the deploy order; history no longer gates on the roles read and `HistoryNameLists.jobRoles` is required; day-detail role `text-xs`; the *Poslovi* row failure names its role and describes only its own button; *Filtri · N* counts the applied role; e2e archive/restore step and a safe rollback; the *Vod* deferral reworded. Deferred: *Bez posla* copy (founder), small polish (search by role, card retry, no-op rename, FK refusal wording). Kept: reversible archive; the archived-role-on-member rule enforced only in the picker (Design Notes).

## Design Notes

**Roles vs ranks and positions.** A fire rank (`members.fire_rank`, 0014) and a team position (`team_membership_versions.position`, 0015, versioned with the membership and required while `uses_fire_ranks`) stay exactly as they are and are read nowhere new. A job role is a third, orthogonal, organization-defined fact about the member, current-state and never required. A crew can have positions *Zapovjednik/Vozač/Vatrogasac* and also a role *Vod*. No value moves between them, so no data is lost. Whether positions should later become roles is the founder's call (deferred-work).

**Archived roles on members.** The database accepts an archived role on a member by design: a role is descriptive data (R16.0), and archiving hides it from new choices without rewriting anyone's row. Only the member page's picker hides it, and it still offers the role to the member who holds it.

**For 21.13.** `job_roles (organization_id, id)` is the composite target `floater_roles` will reference. The members embed already names `members_job_role_fkey`, so adding `floater_roles` (members ↔ job_roles M2M) does not make PostgREST's embed ambiguous.

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- exit 0.
- `pnpm --filter @shift/domain test`, `pnpm --filter @shift/web test` -- pass.
- `pnpm build`, then `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` and the other DB-free root files touched (`theme-*` only if `index.css` changes) -- pass.
- DB-connecting root tests and e2e are CI's first run (STRICT DATABASE RULE).

**As built (2026-11-25):**
- `pnpm typecheck` (apps, e2e, smoke, perf) and `pnpm lint` -- exit 0. `eslint.config.js`'s `FEATURE_PUBLIC` gains `job-roles` (`services/list` for history, members and organization; `services/write` for organization).
- `pnpm --filter @shift/domain test` -- 23 files, 1028 tests passed (history: `job-role` record, `jobRole` field, 24 audited tables).
- `pnpm --filter @shift/web test` -- 188 files, 6998 tests passed. New: `features/job-roles/services/{list,write}.test.ts`; added cases in members `list.test.ts` (parser, faceted *Posao* counts, `?posao=` round trip, unknown id → all, the chip drawn only while a role is held), `write.test.ts` (`job_role_id` patch, the FK refusal), `calendar/services/snapshot.test.ts` (the role off `calendar_members()`, malformed role rows), `calendar/utils/day-detail.test.ts` (the role on the roster line, absent for none), `history-rows.test.ts`, `dependents.test.ts`, `persistence.test.ts` (shape 5), `surface-keys.test.ts`. Page sweeps and structural pins updated with each count's reason.
- `pnpm build`, then `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/feature-boundaries.test.ts test/import-cycles.test.ts test/key-hygiene.test.ts test/localization-guard.test.ts` -- 6 files, 2909 tests passed. `index.css` is unchanged, so the theme files were not run.
- DB-connecting root tests (`test/provisioning.test.ts`, `test/rls-isolation.test.ts`) and e2e (`e2e/tests/organization/job-roles.spec.ts`, `cleanUpJobRolesInSql`) were written unrun: CI is their first run (STRICT DATABASE RULE). A local run of them would fail on the unapplied `0078`, which is expected.

**Residual risk:** the unrun DB cases (the `job_roles` refusals and their constraint names, the 23503 on another tenant's role, the `calendar_members()` key sets, the members column grant, the 24-table audit inventory) and the e2e spec are verified only by reading `0078`; CI is the first run.

## Suggested Review Order

**Schema (the entry point)**

- The table, its named checks, partial name key, policies and grants; nothing seeded.
  [`0078_job_roles.sql:57`](../../supabase/migrations/0078_job_roles.sql#L57)

- The member's role: nullable composite FK, column grant only.
  [`0078_job_roles.sql:181`](../../supabase/migrations/0078_job_roles.sql#L181)

- `calendar_members()` re-created with the role id and name, same scope and grants.
  [`0078_job_roles.sql:206`](../../supabase/migrations/0078_job_roles.sql#L206)

**Setting a role without losing one**

- The picker always offers the held role; only a changed pick writes.
  [`list.ts:249`](../../apps/web/src/features/job-roles/services/list.ts#L249)

- Options: live roles plus the held one, archived or missing from the cache.
  [`list.ts:217`](../../apps/web/src/features/job-roles/services/list.ts#L217)

**Showing and filtering**

- The FK-hinted embed, safe once 21.13 adds `floater_roles`.
  [`list.ts:137`](../../apps/web/src/features/members/services/list.ts#L137)

- The *Posao* facet joins the one narrowing traversal.
  [`list.ts:2572`](../../apps/web/src/features/members/services/list.ts#L2572)

- The calendar's parse; rows from before 0078 read as no role.
  [`snapshot.ts:1191`](../../apps/web/src/features/calendar/services/snapshot.ts#L1191)

**Managing roles**

- *Poslovi*: add, rename, archive and restore.
  [`organization-job-roles-card.tsx:41`](../../apps/web/src/features/organization/components/organization-job-roles-card.tsx#L41)

**Peripherals**

- History names the record and the field.
  [`history.ts:288`](../../packages/domain/src/history.ts#L288)

- Unrun DB cases and inventories: `test/provisioning.test.ts`, `test/rls-isolation.test.ts`; e2e `e2e/tests/organization/job-roles.spec.ts`.
