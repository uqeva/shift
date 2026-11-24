// Story 20.8 (H-13's fallback without a new provider): is Shift up, seen from
// outside the host?
//
//   node scripts/ci/uptime.mjs          (.github/workflows/uptime.yml, every 30 minutes)
//
// For each configured environment, three checks, each retried once:
//   app     GET  <app>/                      200 with the SPA shell (`<div id="root">`)
//   auth    GET  <api>/auth/v1/health        200 (Kong wants the publishable key as `apikey`)
//   notify  POST <api>/functions/v1/notify   401 INVOKE_SECRET_REFUSED: Kong, edge-runtime
//                                             and the router answer, with no credential
//
// The repository is PUBLIC, and so are its workflow logs and issues. The
// origins and the key come from repository SECRETS (masked by GitHub), and
// this script masks every origin, host and key again before it prints
// anything. Nothing it prints or writes to an issue names one: only the
// environment, the check, a status code, a known error code or an error class.
//
// A failure fails the job (an `::error::` per check) and opens one issue per
// environment, "Uptime: <environment> is down", or updates the open one: a
// comment when the set of failing checks changes, the body otherwise. When
// every check passes again, the issue is commented and closed. Exit codes:
// 0 all up, 1 something down (or nothing configured), 2 a configuration error.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENVIRONMENTS = /** @type {const} */ (['staging', 'production']);
export const SHELL_MARKER = '<div id="root">';
export const BOT_LOGIN = 'github-actions[bot]';
const SIGNATURE = /<!-- uptime-signature: ([^>]*) -->/;

/**
 * @typedef {{ environment: string, app: string, api: string, key: string }} Target
 * @typedef {{ id: 'app' | 'auth' | 'notify', method: 'GET' | 'POST', url: string, headers: Record<string, string> }} Check
 * @typedef {{ environment: string, check: string, ok: boolean, detail: string }} Result
 */

/**
 * The environments whose three secrets are set. One set partly is an error:
 * a half-configured environment would otherwise go unwatched in silence.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ targets: Target[], problems: string[] }}
 */
export function targetsFrom(env) {
  /** @type {Target[]} */
  const targets = [];
  /** @type {string[]} */
  const problems = [];
  for (const environment of ENVIRONMENTS) {
    const prefix = `UPTIME_${environment.toUpperCase()}_`;
    const app = (env[`${prefix}APP_URL`] ?? '').trim();
    const api = (env[`${prefix}API_URL`] ?? '').trim();
    const key = (env[`${prefix}PUBLISHABLE_KEY`] ?? '').trim();
    const set = [app, api, key].filter((value) => value !== '').length;
    if (set === 0) continue;
    if (set !== 3) {
      problems.push(`${environment}: set all three of ${prefix}APP_URL, ${prefix}API_URL and ${prefix}PUBLISHABLE_KEY, or none`);
      continue;
    }
    const origins = [app, api].map(originOf);
    if (origins.some((origin) => origin === undefined)) {
      problems.push(`${environment}: ${prefix}APP_URL and ${prefix}API_URL must be https origins (no path)`);
      continue;
    }
    if (!/^[A-Za-z0-9._-]{20,400}$/.test(key)) {
      problems.push(`${environment}: ${prefix}PUBLISHABLE_KEY does not look like a key`);
      continue;
    }
    targets.push({ environment, app: /** @type {string} */ (origins[0]), api: /** @type {string} */ (origins[1]), key });
  }
  return { targets, problems };
}

/** @param {string} value @returns {string | undefined} the origin, for an https origin with no path */
function originOf(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined;
    if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Every string that must never reach a log: origins, hosts and the key. @param {readonly Target[]} targets */
export function secretsOf(targets) {
  const values = new Set();
  for (const { app, api, key } of targets) {
    for (const origin of [app, api]) {
      values.add(origin);
      values.add(new URL(origin).host);
      values.add(new URL(origin).hostname);
    }
    values.add(key);
  }
  return [...values].filter((value) => value !== '');
}

/** @param {Target} target @returns {Check[]} */
export function checksFor(target) {
  return [
    { id: 'app', method: 'GET', url: `${target.app}/`, headers: {} },
    { id: 'auth', method: 'GET', url: `${target.api}/auth/v1/health`, headers: { apikey: target.key } },
    { id: 'notify', method: 'POST', url: `${target.api}/functions/v1/notify`, headers: { 'content-type': 'application/json' } },
  ];
}

/**
 * @param {Check['id']} id
 * @param {{ status: number, body: string }} response
 * @returns {{ ok: boolean, detail: string }} a detail that names no origin and quotes no body
 */
export function judge(id, { status, body }) {
  if (id === 'app') {
    if (status !== 200) return { ok: false, detail: `HTTP ${String(status)}` };
    return body.includes(SHELL_MARKER) ? { ok: true, detail: 'HTTP 200, the app shell' } : { ok: false, detail: 'HTTP 200 without the app shell' };
  }
  if (id === 'auth') return { ok: status === 200, detail: `HTTP ${String(status)}` };
  const code = codeOf(body);
  const ok = status === 401 && code === 'INVOKE_SECRET_REFUSED';
  return { ok, detail: `HTTP ${String(status)}${code === undefined ? '' : ` ${code}`}` };
}

/** A body's `code`, only when it has the shape of our own codes. @param {string} body */
function codeOf(body) {
  try {
    const code = /** @type {{ code?: unknown } | null} */ (JSON.parse(body))?.code;
    return typeof code === 'string' && /^[A-Z][A-Z_]{1,40}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** An error's class, never its message (which names the host). @param {unknown} error */
export function errorClass(error) {
  const name = /** @type {{ name?: unknown }} */ (error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'TIMEOUT';
  const code = /** @type {{ cause?: { code?: unknown } }} */ (error)?.cause?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : 'NETWORK_ERROR';
}

/**
 * One check, retried once after `retryDelayMs` when it fails.
 *
 * @param {Check} check
 * @param {{ fetch: typeof fetch, timeoutMs?: number, retryDelayMs?: number, sleep?: (ms: number) => Promise<void> }} io
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function runCheck(check, io) {
  const { timeoutMs = 15_000, retryDelayMs = 20_000, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = io;
  let last = { ok: false, detail: 'not run' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs);
    try {
      const response = await io.fetch(check.url, {
        method: check.method,
        headers: { 'user-agent': 'shift-uptime', ...check.headers },
        ...(check.method === 'POST' ? { body: '{}' } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      last = judge(check.id, { status: response.status, body: await response.text() });
    } catch (error) {
      last = { ok: false, detail: errorClass(error) };
    }
    if (last.ok) return last;
  }
  return last;
}

export const titleFor = (/** @type {string} */ environment) => `Uptime: ${environment} is down`;

/** Which checks fail, as one stable string (their details may vary run to run). @param {readonly Result[]} failures */
export function signatureOf(failures) {
  return failures
    .map(({ check }) => check)
    .sort()
    .join(', ');
}

/**
 * What to do with the environment's issue.
 *
 * @param {{ environment: string, failures: readonly Result[], issue: { number: number, body: string } | undefined, now: string, runUrl: string }} input
 * @returns {{ kind: 'none' } | { kind: 'create', title: string, body: string }
 *   | { kind: 'update', number: number, body: string, comment: string | undefined }
 *   | { kind: 'close', number: number, comment: string }}
 */
export function planIssue({ environment, failures, issue, now, runUrl }) {
  if (failures.length === 0) {
    if (issue === undefined) return { kind: 'none' };
    return { kind: 'close', number: issue.number, comment: `Recovered: every check of ${environment} passed at ${now} ([run](${runUrl})).` };
  }
  const signature = signatureOf(failures);
  const lines = failures.map(({ check, detail }) => `- \`${check}\`: ${detail}`).join('\n');
  const body = [
    `The uptime check found **${environment}** down.`,
    '',
    lines,
    '',
    `Last seen failing: ${now} ([run](${runUrl})).`,
    '',
    'What to do: DEPLOY.md §9.13, "The site is down". This issue closes itself when every check passes again.',
    '',
    `<!-- uptime-signature: ${signature} -->`,
  ].join('\n');
  if (issue === undefined) return { kind: 'create', title: titleFor(environment), body };
  const previous = SIGNATURE.exec(issue.body)?.[1];
  const comment = previous === signature ? undefined : `Now failing at ${now} ([run](${runUrl})):\n\n${lines}`;
  return { kind: 'update', number: issue.number, body, comment };
}

/**
 * The GitHub REST calls, with the job's token.
 *
 * @param {{ fetch: typeof fetch, token: string, repository: string, api?: string }} io
 */
export function githubClient({ fetch: fetchImpl, token, repository, api = 'https://api.github.com' }) {
  /** @param {string} path @param {string} method @param {unknown} [payload] */
  async function call(path, method, payload) {
    const response = await fetchImpl(`${api}/repos/${repository}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'shift-uptime',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path.replace(/\?.*$/, '')}: HTTP ${String(response.status)}`);
    return /** @type {unknown} */ (await response.json());
  }
  return {
    /** The open issue the bot filed for this environment, if any. @param {string} environment */
    async findOpen(environment) {
      const issues = /** @type {{ number: number, title: string, body: string | null, user: { login: string } | null, pull_request?: unknown }[]} */ (
        await call(`/issues?state=open&creator=${encodeURIComponent(BOT_LOGIN)}&per_page=100`, 'GET')
      );
      const issue = issues.find(
        (candidate) => candidate.pull_request === undefined && candidate.title === titleFor(environment) && candidate.user?.login === BOT_LOGIN,
      );
      return issue === undefined ? undefined : { number: issue.number, body: issue.body ?? '' };
    },
    /**
     * With the `uptime` label; without it when the label cannot be set (a
     * repository that refuses to create it), so the alert still goes out.
     * @param {string} title @param {string} body
     */
    create: (title, body) =>
      call('/issues', 'POST', { title, body, labels: ['uptime'] }).catch(() => call('/issues', 'POST', { title, body })),
    /** @param {number} number @param {Record<string, unknown>} fields */
    edit: (number, fields) => call(`/issues/${String(number)}`, 'PATCH', fields),
    /** @param {number} number @param {string} body */
    comment: (number, body) => call(`/issues/${String(number)}/comments`, 'POST', { body }),
  };
}

/** @param {ReturnType<typeof githubClient>} github @param {ReturnType<typeof planIssue>} plan */
export async function applyPlan(github, plan) {
  if (plan.kind === 'create') await github.create(plan.title, plan.body);
  if (plan.kind === 'update') {
    if (plan.comment !== undefined) await github.comment(plan.number, plan.comment);
    await github.edit(plan.number, { body: plan.body });
  }
  if (plan.kind === 'close') {
    await github.comment(plan.number, plan.comment);
    await github.edit(plan.number, { state: 'closed', state_reason: 'completed' });
  }
}

/**
 * @param {{ env: Record<string, string | undefined>, fetch: typeof fetch, out: (line: string) => void, sleep?: (ms: number) => Promise<void>, now?: () => Date }} io
 * @returns {Promise<number>} the exit code
 */
export async function main({ env, fetch: fetchImpl, out, sleep, now = () => new Date() }) {
  if (env['UPTIME_ENABLED'] !== 'true') {
    out('uptime: UPTIME_ENABLED is not "true"; nothing checked');
    return 0;
  }
  const { targets, problems } = targetsFrom(env);
  for (const value of secretsOf(targets)) out(`::add-mask::${value}`);
  for (const problem of problems) out(`::error title=Uptime configuration::${problem}`);
  // A misconfigured environment fails the run, but never stops the others
  // from being checked.
  if (targets.length === 0 && problems.length > 0) return 2;
  if (targets.length === 0) {
    out('::error title=Uptime configuration::no environment is configured (DEPLOY.md §9.13 lists the secrets)');
    return 1;
  }

  const token = env['GITHUB_TOKEN'] ?? '';
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const runUrl = `${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${repository}/actions/runs/${env['GITHUB_RUN_ID'] ?? ''}`;
  const github = token !== '' && repository !== '' ? githubClient({ fetch: fetchImpl, token, repository }) : undefined;
  let down = 0;
  // Every check at once: a total outage (each check timing out and retried)
  // still ends well inside the job's timeout.
  const checked = await Promise.all(
    targets.map(async (target) =>
      Promise.all(
        checksFor(target).map(async (check) => ({
          environment: target.environment,
          check: check.id,
          ...(await runCheck(check, { fetch: fetchImpl, ...(sleep === undefined ? {} : { sleep }) })),
        })),
      ),
    ),
  );
  for (const [index, target] of targets.entries()) {
    /** @type {Result[]} */
    const results = checked[index] ?? [];
    for (const result of results) {
      out(result.ok ? `ok    ${target.environment} ${result.check}: ${result.detail}` : `::error title=${target.environment} is down::${result.check}: ${result.detail}`);
    }
    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0) down += 1;
    if (github === undefined) {
      out('::warning title=Uptime::no GITHUB_TOKEN/GITHUB_REPOSITORY; no issue opened or closed');
      continue;
    }
    try {
      const issue = await github.findOpen(target.environment);
      const plan = planIssue({ environment: target.environment, failures, issue, now: now().toISOString(), runUrl });
      await applyPlan(github, plan);
      if (plan.kind !== 'none') out(`issue ${target.environment}: ${plan.kind}`);
    } catch (error) {
      out(`::error title=Uptime issue::${target.environment}: ${error instanceof Error ? error.message : 'the issue could not be updated'}`);
      down += 1;
    }
  }
  if (problems.length > 0) return 2;
  return down === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ env: process.env, fetch: globalThis.fetch, out: (line) => process.stdout.write(`${line}\n`) });
}
