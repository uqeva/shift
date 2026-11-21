#!/usr/bin/env node
// Story 19.2 (AD-22's probe; checklist B1, B2, B5, B8): does the gateway give
// every address one answer?
//
// Run against 20.1's compose rehearsal stack (DEPLOY.md §9.5) and then against
// staging — never against the Supabase CLI's Kong, which is not the gateway
// AD-22 describes. It sends `signup`, `recover` and `resend` for four kinds of
// address — a new one, a known confirmed one, a known unconfirmed one and a
// synthesized one — and a password grant for a known and an unknown address,
// and it asserts:
//
// - the mail routes: ONE status, ONE body and ONE set of header names and
//   values (less `Date`, which names the second), for every kind;
// - their timing: each kind's median within one TIMING CLASS of every other
//   kind's (the class width is SHIFT_PROBE_TIMING_CLASS_MS, default 50 ms;
//   Kong answers `200 {}` before GoTrue runs, so the medians measure Kong);
// - the password grant (B5): the same status and the same error code for an
//   unknown address and a wrong password. Its timing difference is REPORTED,
//   never asserted: it is the accepted bcrypt residual B8 records for the
//   founder at D-S5.
//
// It prints the kinds, never an address (G2). Inputs, all from the
// environment so nothing lands in a shell history or a file:
//
//   SHIFT_PROBE_API                  the stack's public API origin (Kong)
//   SHIFT_PROBE_KEY                  its sb_publishable_ key
//   SHIFT_PROBE_KNOWN_CONFIRMED      an address with a confirmed account
//   SHIFT_PROBE_KNOWN_UNCONFIRMED    an address with an unconfirmed account
//   SHIFT_PROBE_NEW_DOMAIN           a domain the operator receives mail for;
//                                    each new address is a fresh local part
//   SHIFT_PROBE_SAMPLES              per kind and route, default 5
//   SHIFT_PROBE_TIMING_CLASS_MS      default 50
//
// THE MAIL LIMIT. Kong counts signup, recover and resend together per client
// address (AD-21: 5 an hour on staging). A full run sends 3 × 4 × samples of
// them, so the operator raises `SHIFT_LIMIT_MAIL_HOUR`/`_DAY` for the probe's
// window and restores them after (DEPLOY.md §9.9). A 429 stops the run and
// says so; it is never counted as an answer.
//
// WHAT IT LEAVES. Each `new` signup (one per sample, 5 by default) creates an
// unconfirmed account that counts against `signup_settings.accounts_per_day`
// and mails SHIFT_PROBE_NEW_DOMAIN; the known accounts receive real recovery
// and confirmation mail. The new addresses all start with `probe-`, and
// DEPLOY.md §9.9 says how to remove them after a run.
//
// Exit 0: every assertion held. 1: one did not (each is printed). 2: the
// inputs are missing or malformed.

import { randomUUID } from 'node:crypto';

const KINDS = ['new', 'known confirmed', 'known unconfirmed', 'synthesized'];
const ROUTES = ['signup', 'recover', 'resend'];
const VARYING_HEADERS = new Set(['date']);

function input(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    console.error(`signup-enumeration: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

const api = input('SHIFT_PROBE_API').replace(/\/+$/, '');
const key = input('SHIFT_PROBE_KEY');
const known = {
  confirmed: input('SHIFT_PROBE_KNOWN_CONFIRMED'),
  unconfirmed: input('SHIFT_PROBE_KNOWN_UNCONFIRMED'),
};
const newDomain = input('SHIFT_PROBE_NEW_DOMAIN');
const samples = Number(input('SHIFT_PROBE_SAMPLES', '5'));
const timingClass = Number(input('SHIFT_PROBE_TIMING_CLASS_MS', '50'));

if (!/^https?:\/\/[^/]+$/.test(api)) {
  console.error('signup-enumeration: SHIFT_PROBE_API is not a bare http(s) origin');
  process.exit(2);
}
if (!Number.isInteger(samples) || samples < 1 || !Number.isFinite(timingClass) || timingClass <= 0) {
  console.error('signup-enumeration: SHIFT_PROBE_SAMPLES or SHIFT_PROBE_TIMING_CLASS_MS is not a positive number');
  process.exit(2);
}

/** A password no account holds, made per request. */
function password() {
  return `probe-${randomUUID()}`;
}

function addressOf(kind) {
  if (kind === 'new') return `probe-${randomUUID()}@${newDomain}`;
  if (kind === 'known confirmed') return known.confirmed;
  if (kind === 'known unconfirmed') return known.unconfirmed;
  return `probe-${randomUUID()}@probe.shift.invalid`;
}

function bodyOf(route, email) {
  if (route === 'signup') return { email, password: password() };
  if (route === 'resend') return { email, type: 'signup' };
  return { email };
}

async function send(path, body) {
  const started = performance.now();
  const response = await fetch(`${api}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // A hung request fails the run instead of blocking it.
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  const ms = performance.now() - started;
  const headers = [...response.headers.entries()]
    .filter(([name]) => !VARYING_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => `${name.toLowerCase()}: ${value}`)
    .sort()
    .join('\n');
  return { status: response.status, text, headers, ms };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const failures = [];

for (const route of ROUTES) {
  // INTERLEAVED: each round sends every kind once, in a shuffled order, so
  // connection warm-up and drift fall on every kind alike, not on whichever
  // kind happened to go first (review of 19.2).
  const answers = new Map(KINDS.map((kind) => [kind, []]));
  for (let sample = 0; sample < samples; sample += 1) {
    const order = [...KINDS].sort(() => Math.random() - 0.5);
    for (const kind of order) {
      const answer = await send(route, bodyOf(route, addressOf(kind)));
      if (answer.status === 429) {
        console.error(
          `signup-enumeration: ${route} answered 429 (Kong's mail limit); raise SHIFT_LIMIT_MAIL_HOUR and _DAY for the probe window`,
        );
        process.exit(1);
      }
      answers.get(kind).push(answer);
    }
  }
  const all = [...answers.values()].flat();
  const statuses = new Set(all.map((answer) => answer.status));
  const bodies = new Set(all.map((answer) => answer.text));
  const headerSets = new Set(all.map((answer) => answer.headers));
  const medians = KINDS.map((kind) => [kind, median(answers.get(kind).map((answer) => answer.ms))]);
  const spread = Math.max(...medians.map(([, ms]) => ms)) - Math.min(...medians.map(([, ms]) => ms));

  console.log(`== ${route}: status ${[...statuses].join(', ')}, ${bodies.size} body, ${headerSets.size} header set`);
  for (const [kind, ms] of medians) console.log(`   ${kind.padEnd(18)} median ${ms.toFixed(1)} ms`);
  console.log(`   spread ${spread.toFixed(1)} ms (class ${String(timingClass)} ms)`);

  if (statuses.size !== 1) failures.push(`${route}: more than one status (${[...statuses].join(', ')})`);
  if (bodies.size !== 1) failures.push(`${route}: more than one body`);
  if (headerSets.size !== 1) failures.push(`${route}: more than one set of headers`);
  if (spread > timingClass) failures.push(`${route}: the medians span ${spread.toFixed(1)} ms, wider than one class`);
}

// B5 and B8: the password grant.
const grants = { unknown: [], wrong: [] };
for (let sample = 0; sample < samples; sample += 1) {
  grants.unknown.push(await send('token?grant_type=password', { email: addressOf('new'), password: password() }));
  grants.wrong.push(await send('token?grant_type=password', { email: known.confirmed, password: password() }));
}
const codeOf = (answer) => {
  try {
    const parsed = JSON.parse(answer.text);
    return String(parsed.error_code ?? parsed.code ?? parsed.error ?? '');
  } catch {
    return answer.text;
  }
};
const grantAnswers = new Set([...grants.unknown, ...grants.wrong].map((answer) => `${String(answer.status)} ${codeOf(answer)}`));
const unknownMedian = median(grants.unknown.map((answer) => answer.ms));
const wrongMedian = median(grants.wrong.map((answer) => answer.ms));
console.log(`== token: ${[...grantAnswers].join(' | ')}`);
console.log(`   unknown address    median ${unknownMedian.toFixed(1)} ms`);
console.log(`   wrong password     median ${wrongMedian.toFixed(1)} ms`);
console.log(`   B8 residual (reported, not asserted): ${(wrongMedian - unknownMedian).toFixed(1)} ms`);
if (grantAnswers.size !== 1) failures.push('token: an unknown address and a wrong password answer differently');

for (const failure of failures) console.error(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
