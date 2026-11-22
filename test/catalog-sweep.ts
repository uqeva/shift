import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';

/**
 * The catalog sweep of story 19.1 (AD-10 as amended), shared by the two
 * sessions that must read and write nothing: a confirmed account with no
 * `members` row (`test/claimless-account.test.ts`) and, from story 19.5, an
 * admin of a suspended organization (`test/suspended-organization.test.ts`).
 * Moved here from the first file unchanged, so both sweeps are one sweep.
 *
 * Every table, view and function is read FROM THE CATALOG, so one added later
 * is swept without editing either file. Every helper runs on the caller's
 * connection; none opens one.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Run one statement inside a savepoint: its answer, or the code it was refused with. */
export async function attempt<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<{ rows: T[]; rowCount: number } | { refused: string }> {
  await client.query('savepoint attempt');
  try {
    const result = await client.query<T>(sql, [...parameters]);
    await client.query('release savepoint attempt');
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (cause) {
    await client.query('rollback to savepoint attempt');
    return { refused: (cause as { code?: string }).code ?? 'UNKNOWN' };
  }
}

/**
 * Every row count the sweep could change, as the owner: public, private,
 * Storage and Auth. The live-API cases leave Auth's own logs out (GoTrue
 * writes its audit log and sessions on every admin call and grant) and count
 * `auth.users` alone.
 */
export async function snapshot(client: Client, schemas: readonly string[] = ['public', 'private', 'storage', 'auth']): Promise<Record<string, number>> {
  const { rows: tables } = await client.query<{ name: string }>(
    `select format('%I.%I', n.nspname, c.relname) as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and (n.nspname = any($1::text[]) or (n.nspname = 'auth' and c.relname = 'users'))
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1`,
    [[...schemas]],
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${name}`);
    counts[name] = rows[0]?.n ?? -1;
  }
  return counts;
}

export interface Relation {
  readonly name: string;
  readonly kind: string;
  readonly firstColumn: string | null;
}

/** Every table and view in `public` but an extension's, as the owner. */
export async function publicRelations(client: Client): Promise<Relation[]> {
  const { rows } = await client.query<{ name: string; kind: string; first: string | null }>(
    `select c.relname as name, c.relkind::text as kind,
            (select a.attname from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
              order by a.attnum limit 1) as first
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1`,
  );
  return rows.map((row) => ({ name: row.name, kind: row.kind, firstColumn: row.first }));
}

/**
 * The public tables the migrations create and do not drop, read from their
 * source (the scaffold's reading, kept small here): the floor for the
 * catalog's count, so the sweep cannot quietly read fewer.
 */
export function migratedPublicTables(): Set<string> {
  const directory = join(repoRoot, 'supabase', 'migrations');
  const tables = new Set<string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    const text = readFileSync(join(directory, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const match of text.matchAll(/\b(create|drop) table (?:if (?:not )?exists )?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?(?=[\s(;])/gi)) {
      const [, verb = '', name = ''] = match;
      if (/^(private|storage|auth)$/i.test(name)) continue;
      if (verb.toLowerCase() === 'create') tables.add(name.toLowerCase());
      else tables.delete(name.toLowerCase());
    }
  }
  return tables;
}

/**
 * How a write by the claimless session may end and still count as refused:
 * SQLSTATE 42501 (no privilege, or a row-level-security refusal), or zero rows
 * (RLS filtering silently). Every other ending is an offence to read, not to
 * excuse. A view or a materialized view also refuses by not being writable at
 * all (55000, 0A000, 42809).
 */
export function refusedWrite(
  relation: Relation,
  verb: 'insert' | 'update' | 'delete',
  answer: { rows: unknown[]; rowCount: number } | { refused: string },
): string | null {
  if ('refused' in answer) {
    if (answer.refused === '42501') return null;
    if (relation.kind !== 'r' && relation.kind !== 'p' && ['55000', '0A000', '42809'].includes(answer.refused)) return null;
    return `${relation.name}: ${verb} ended ${answer.refused}, not 42501`;
  }
  return answer.rowCount === 0 ? null : `${relation.name}: ${verb} changed ${String(answer.rowCount)} rows`;
}

export interface Callable {
  readonly name: string;
  readonly types: readonly string[];
  /** `pg_type.typtype` of each argument: `b` base, `c` composite (a table's row), `e` enum, ... */
  readonly kinds: readonly string[];
  readonly names: readonly string[];
}

/** Every function in `public` that `authenticated` may execute, but an extension's or a trigger's. */
export async function executableFunctions(client: Client): Promise<Callable[]> {
  const { rows } = await client.query<{
    name: string;
    types: string[];
    kinds: string[];
    names: string[] | null;
    modes: string[] | null;
    count: number;
  }>(
    `select p.proname as name,
            array(select pg_catalog.format_type(t, null) from unnest(p.proargtypes) with ordinality as u(t, i) order by i) as types,
            array(select (case when ty.typcategory = 'A' then 'a' else ty.typtype::text end)
                    from unnest(p.proargtypes) with ordinality as u(t, i) join pg_type ty on ty.oid = u.t order by i) as kinds,
            p.proargnames as names,
            p.proargmodes::text[] as modes,
            p.pronargs::int as count
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1, 6`,
  );
  return rows.map((row) => {
    const all = row.names ?? [];
    const names =
      row.modes === null ? all.slice(0, row.count) : all.filter((_, index) => ['i', 'b', 'v'].includes(row.modes?.[index] ?? 'i'));
    return { name: row.name, types: row.types, kinds: row.kinds, names: row.types.map((_, index) => names[index] ?? '') };
  });
}

/**
 * Where a uuid argument's real id comes from: by the function's name, then
 * the parameter's, the first rule that matches. A parameter no rule names,
 * or a table the seed holds no pilot row of (it holds no leave requests,
 * leave records, swap requests, loans or conflict resolutions, and none is
 * built here: owner-built scenes only), is NOT exercised and is counted so.
 */
export const ID_SOURCES: readonly (readonly [RegExp | null, RegExp, string])[] = [
  [/roster_override/, /^p_override_id$/, 'roster_overrides'],
  [/shift_type_override/, /^p_override_id$/, 'shift_type_overrides'],
  [/swap_request/, /^p_request_id$/, 'swap_requests'],
  [/leave_request/, /^p_request_id$/, 'leave_requests'],
  [null, /^p_record_id$/, 'leave_records'],
  [null, /^p_loan_id$/, 'team_loans'],
  [null, /^p_absence_type_id$/, 'absence_types'],
  [null, /^p_resolution_id$/, 'conflict_resolutions'],
  [null, /^(p_)?organization$/, 'organizations'],
  [null, /^(p_)?shift_type(_id)?$/, 'shift_types'],
  [null, /^(p_)?team(_id)?$/, 'teams'],
  [null, /^(p_)?pattern(_id)?$/, 'rotation_patterns'],
  [null, /^(member|p_member_id|p_member_in_id|p_replacement_id|p_proposer|p_addressee)$/, 'members'],
];

/** A real pilot id for a uuid argument, as the owner, and whether one was found. */
export async function realId(client: Client, callable: string, parameter: string, organization: string): Promise<{ id: string; real: boolean }> {
  const source = ID_SOURCES.find(([name, parameterPattern]) => (name === null || name.test(callable)) && parameterPattern.test(parameter))?.[2];
  if (source === undefined) return { id: randomUUID(), real: false };
  const sql =
    source === 'organizations'
      ? 'select id::text from public.organizations where id = $1'
      : `select id::text from public.${source} where organization_id = $1 order by id limit 1`;
  const answer = await attempt<{ id: string }>(client, sql, [organization]);
  const found = 'rows' in answer ? answer.rows[0]?.id : undefined;
  return found === undefined ? { id: randomUUID(), real: false } : { id: found, real: true };
}

/** The same value on both calls for every base argument that names no row. */
export const SAMPLE: Readonly<Record<string, string>> = {
  text: 'claimless-probe',
  date: '2026-09-14',
  integer: '1',
  smallint: '1',
  bigint: '1',
  boolean: 'true',
  jsonb: '{}',
  json: '{}',
  numeric: '1',
  'time without time zone': '07:00',
  'timestamp with time zone': '2026-09-14T07:00:00Z',
  daterange: '[2026-09-14,2026-09-15)',
};

/**
 * The functions the sweep may not call, each with its reason. An argument it
 * cannot build (an enum, an array, an interval, any base type with no sample)
 * makes a function unswept, and an unswept function not named here fails the
 * sweep. Empty today: no executable function takes such an argument.
 */
export const UNSWEPT_ALLOWED: Readonly<Record<string, string>> = {};

/** Why a function cannot be swept, or `null`. */
export function unsweepable(callable: Callable): string | null {
  for (const [index, type] of callable.types.entries()) {
    if (type === 'uuid' || callable.kinds[index] === 'c') continue;
    if (callable.kinds[index] === 'b' && SAMPLE[type] !== undefined) continue;
    if (type === 'daterange') continue;
    return `argument ${String(index + 1)} is ${type} (${callable.kinds[index] ?? '?'})`;
  }
  return null;
}

export interface Arguments {
  readonly values: (string | null)[];
  /** How many uuid arguments named a real pilot row. */
  readonly realIds: number;
}

/**
 * Each argument as a typed literal. A uuid is a real pilot id, or one that
 * exists nowhere; a row argument (a computed relationship's) is the pilot's
 * real row on both calls, so that function is held to answering nothing at
 * all; every other argument is the same sample on both calls.
 */
export async function argumentsFor(client: Client, callable: Callable, organization: string, real: boolean): Promise<Arguments> {
  const values: (string | null)[] = [];
  let realIds = 0;
  for (const [index, type] of callable.types.entries()) {
    const parameter = callable.names[index] ?? '';
    if (type === 'uuid') {
      if (!real) {
        values.push(randomUUID());
        continue;
      }
      const found = await realId(client, callable.name, parameter, organization);
      if (found.real) realIds += 1;
      values.push(found.id);
    } else if (callable.kinds[index] === 'c') {
      const table = type.replace(/^public\./, '');
      const filter = table === 'organizations' ? 'r.id = $1' : 'r.organization_id = $1';
      const row = await attempt<{ row: string }>(client, `select r::text as row from public."${table}" r where ${filter} limit 1`, [organization]);
      values.push('rows' in row ? (row.rows[0]?.row ?? null) : null);
    } else {
      values.push(SAMPLE[type] ?? null);
    }
  }
  return { values, realIds };
}

/** An answer that says nothing: a refusal, no row, or only nulls. */
export function saysNothing(answer: string): boolean {
  if (answer.startsWith('refused ')) return true;
  const rows = JSON.parse(answer) as unknown[];
  return rows.every((row) => row === null || (typeof row === 'string' && /^\(,*\)$/.test(row)));
}

/** One call as the session: its refusal code, or its rows as text. */
export async function call(client: Client, callable: Callable, values: readonly (string | null)[]): Promise<string> {
  const placeholders = callable.types.map((type, index) => `$${String(index + 1)}::${type}`).join(', ');
  const answer = await attempt<{ answer: unknown }>(
    client,
    `select coalesce(pg_catalog.jsonb_agg(r::text), '[]'::jsonb) as answer from public."${callable.name}"(${placeholders}) as r`,
    values,
  );
  return 'refused' in answer ? `refused ${answer.refused}` : JSON.stringify(answer.rows[0]?.answer ?? null);
}
