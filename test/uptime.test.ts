import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  BOT_LOGIN,
  checksFor,
  errorClass,
  githubClient,
  judge,
  main,
  planIssue,
  runCheck,
  secretsOf,
  signatureOf,
  targetsFrom,
  titleFor,
} from '../scripts/ci/uptime.mjs';

/**
 * Story 20.8: the scheduled uptime check (`scripts/ci/uptime.mjs`,
 * `.github/workflows/uptime.yml`). The repository is public, so beside what
 * each check accepts, these pin that no origin, host or key reaches a log line
 * or an issue, and that the workflow reads them from secrets only.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const APP = 'https://app.example.test';
const API = 'https://api.example.test';
const KEY = 'sb_publishable_exampleexampleexample';
const ENV = {
  UPTIME_ENABLED: 'true',
  UPTIME_STAGING_APP_URL: APP,
  UPTIME_STAGING_API_URL: API,
  UPTIME_STAGING_PUBLISHABLE_KEY: KEY,
  GITHUB_TOKEN: 'ghs_token',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_RUN_ID: '42',
};
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';

type Answer = { status: number; body: string } | Error;
type Call = { url: string; method: string; body: string | undefined; headers: Record<string, string> };

/** A fetch that answers the three checks by path, and GitHub's API from a little issue store. */
function fakeFetch(answers: Record<'app' | 'auth' | 'notify', Answer>, issues: { number: number; title: string; body: string; state: string }[] = []) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = (status: number, payload: unknown) => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status });
    if (url.startsWith('https://api.github.com/repos/owner/repo/issues')) {
      const path = url.slice('https://api.github.com/repos/owner/repo'.length);
      if (method === 'GET') {
        return reply(
          200,
          issues.filter((issue) => issue.state === 'open').map((issue) => ({ ...issue, user: { login: BOT_LOGIN } })),
        );
      }
      if (method === 'POST' && path === '/issues') {
        const payload = JSON.parse(body ?? '{}') as { title: string; body: string };
        issues.push({ number: issues.length + 1, title: payload.title, body: payload.body, state: 'open' });
        return reply(201, {});
      }
      const match = /^\/issues\/(\d+)(\/comments)?$/.exec(path);
      const issue = issues.find((candidate) => candidate.number === Number(match?.[1]));
      if (issue === undefined) return reply(404, {});
      if (match?.[2] !== undefined) return reply(201, {});
      Object.assign(issue, JSON.parse(body ?? '{}'));
      return reply(200, {});
    }
    const id = url.endsWith('/auth/v1/health') ? 'auth' : url.endsWith('/functions/v1/notify') ? 'notify' : 'app';
    const answer = answers[id];
    if (answer instanceof Error) throw answer;
    return reply(answer.status, answer.body);
  }) as typeof fetch;
  return { fetchImpl, calls, issues };
}

const UP: Record<'app' | 'auth' | 'notify', Answer> = {
  app: { status: 200, body: SHELL },
  auth: { status: 200, body: '{"name":"GoTrue"}' },
  notify: { status: 401, body: '{"code":"INVOKE_SECRET_REFUSED"}' },
};

async function run(env: Record<string, string | undefined>, answers = UP, issues: Parameters<typeof fakeFetch>[1] = []) {
  const fake = fakeFetch(answers, issues);
  const lines: string[] = [];
  const code = await main({
    env,
    fetch: fake.fetchImpl,
    out: (line) => lines.push(line),
    sleep: () => Promise.resolve(),
    now: () => new Date('2026-11-23T22:00:00Z'),
  });
  return { code, lines, ...fake };
}

describe('targetsFrom', () => {
  it('reads each environment whose three secrets are set, as origins', () => {
    const { targets, problems } = targetsFrom({ ...ENV, UPTIME_STAGING_APP_URL: `${APP}/` });
    expect(problems).toEqual([]);
    expect(targets).toEqual([{ environment: 'staging', app: APP, api: API, key: KEY }]);
  });

  it('refuses a half-configured environment, an http or path URL, and a key of the wrong shape', () => {
    expect(targetsFrom({ UPTIME_PRODUCTION_APP_URL: APP }).problems[0]).toMatch(/^production: set all three/);
    expect(targetsFrom({ ...ENV, UPTIME_STAGING_APP_URL: 'http://app.example.test' }).problems[0]).toMatch(/https origins/);
    expect(targetsFrom({ ...ENV, UPTIME_STAGING_API_URL: `${API}/rest/v1` }).problems[0]).toMatch(/https origins/);
    expect(targetsFrom({ ...ENV, UPTIME_STAGING_PUBLISHABLE_KEY: 'short' }).problems[0]).toMatch(/does not look like a key/);
  });

  it('masks every origin, host and key', () => {
    const { targets } = targetsFrom(ENV);
    expect(secretsOf(targets)).toEqual(expect.arrayContaining([APP, API, 'app.example.test', 'api.example.test', KEY]));
  });
});

describe('the checks', () => {
  const target = { environment: 'staging', app: APP, api: API, key: KEY };

  it('app root, auth health with the key as apikey, notify by POST with no credential', () => {
    const checks = checksFor(target);
    expect(checks.map(({ id, method, url }) => [id, method, url])).toEqual([
      ['app', 'GET', `${APP}/`],
      ['auth', 'GET', `${API}/auth/v1/health`],
      ['notify', 'POST', `${API}/functions/v1/notify`],
    ]);
    expect(checks[1]?.headers).toEqual({ apikey: KEY });
    expect(JSON.stringify(checks[2]?.headers)).not.toMatch(/authorization|apikey/i);
  });

  it('judges each answer, and never quotes a body', () => {
    expect(judge('app', { status: 200, body: SHELL })).toEqual({ ok: true, detail: 'HTTP 200, the app shell' });
    expect(judge('app', { status: 200, body: '<html>Bad gateway</html>' })).toEqual({ ok: false, detail: 'HTTP 200 without the app shell' });
    expect(judge('app', { status: 502, body: 'x' })).toEqual({ ok: false, detail: 'HTTP 502' });
    expect(judge('auth', { status: 401, body: '{"message":"No API key found in request"}' })).toEqual({ ok: false, detail: 'HTTP 401' });
    expect(judge('notify', { status: 401, body: '{"code":"INVOKE_SECRET_REFUSED"}' }).ok).toBe(true);
    expect(judge('notify', { status: 401, body: '{"message":"Unauthorized"}' })).toEqual({ ok: false, detail: 'HTTP 401' });
    expect(judge('notify', { status: 503, body: '{"code":"name.example.test leaked"}' })).toEqual({ ok: false, detail: 'HTTP 503' });
    expect(judge('notify', { status: 404, body: '{"code":"FUNCTION_NOT_FOUND"}' })).toEqual({ ok: false, detail: 'HTTP 404 FUNCTION_NOT_FOUND' });
  });

  it('names an error by its class, never its message', () => {
    const refused = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED app.example.test'), { code: 'ECONNREFUSED' }) });
    expect(errorClass(refused)).toBe('ECONNREFUSED');
    expect(errorClass(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('TIMEOUT');
    expect(errorClass(new TypeError('fetch failed app.example.test'))).toBe('NETWORK_ERROR');
  });

  it('retries a failed check once, and passes on a good second answer', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      return new Response(calls === 1 ? 'bad' : SHELL, { status: calls === 1 ? 502 : 200 });
    }) as unknown as typeof fetch;
    const result = await runCheck(checksFor(target)[0]!, { fetch: flaky, sleep: () => Promise.resolve() });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('the issue', () => {
  const failures = [{ environment: 'staging', check: 'app', ok: false, detail: 'HTTP 502' }];
  const runUrl = 'https://github.com/owner/repo/actions/runs/42';
  const now = '2026-11-23T22:00:00.000Z';

  it('opens one when something is down and none is open', () => {
    const plan = planIssue({ environment: 'staging', failures, issue: undefined, now, runUrl });
    expect(plan).toMatchObject({ kind: 'create', title: 'Uptime: staging is down' });
    expect(plan.kind === 'create' && plan.body).toContain('`app`: HTTP 502');
  });

  it('comments only when the failing set changes, and always refreshes the body', () => {
    const open = planIssue({ environment: 'staging', failures, issue: undefined, now, runUrl });
    const body = open.kind === 'create' ? open.body : '';
    expect(planIssue({ environment: 'staging', failures, issue: { number: 7, body }, now, runUrl })).toMatchObject({ kind: 'update', number: 7, comment: undefined });
    const worse = [...failures, { environment: 'staging', check: 'auth', ok: false, detail: 'TIMEOUT' }];
    const plan = planIssue({ environment: 'staging', failures: worse, issue: { number: 7, body }, now, runUrl });
    expect(plan.kind === 'update' && plan.comment).toContain('`auth`: TIMEOUT');
    expect(signatureOf(worse)).toBe('app, auth');
  });

  it('does not comment when only a failing check\'s detail changes', () => {
    const open = planIssue({ environment: 'staging', failures, issue: undefined, now, runUrl });
    const body = open.kind === 'create' ? open.body : '';
    const timedOut = [{ environment: 'staging', check: 'app', ok: false, detail: 'TIMEOUT' }];
    const plan = planIssue({ environment: 'staging', failures: timedOut, issue: { number: 7, body }, now, runUrl });
    expect(plan).toMatchObject({ kind: 'update', comment: undefined });
    expect(plan.kind === 'update' && plan.body).toContain('`app`: TIMEOUT');
  });

  it('closes the open one with a comment on recovery, and does nothing when all is well', () => {
    expect(planIssue({ environment: 'staging', failures: [], issue: { number: 7, body: '' }, now, runUrl })).toMatchObject({ kind: 'close', number: 7 });
    expect(planIssue({ environment: 'staging', failures: [], issue: undefined, now, runUrl })).toEqual({ kind: 'none' });
  });

  it('finds only the bot\'s open issue with the exact title', async () => {
    const { fetchImpl, calls } = fakeFetch(UP, [
      { number: 1, title: titleFor('production'), body: '', state: 'open' },
      { number: 2, title: titleFor('staging'), body: 'b', state: 'open' },
    ]);
    const github = githubClient({ fetch: fetchImpl, token: 't', repository: 'owner/repo' });
    expect(await github.findOpen('staging')).toEqual({ number: 2, body: 'b' });
    expect(calls[0]?.url).toContain('creator=github-actions%5Bbot%5D');
    expect(calls[0]?.headers['authorization']).toBe('Bearer t');
  });
});

describe('main', () => {
  it('does nothing unless enabled', async () => {
    const { code, calls } = await run({ ...ENV, UPTIME_ENABLED: undefined });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });

  it('fails loudly when enabled with no environment, or a half-configured one', async () => {
    expect((await run({ UPTIME_ENABLED: 'true' })).code).toBe(1);
    expect((await run({ UPTIME_ENABLED: 'true' })).lines.join('\n')).toMatch(/no environment is configured/);
    expect((await run({ ...ENV, UPTIME_PRODUCTION_API_URL: API })).code).toBe(2);
  });

  it('still checks a valid environment beside a misconfigured one', async () => {
    const issues: Parameters<typeof fakeFetch>[1] = [];
    const { code, lines } = await run({ ...ENV, UPTIME_PRODUCTION_API_URL: API }, { ...UP, app: { status: 502, body: '' } }, issues);
    expect(code).toBe(2);
    expect(lines).toContain('::error title=staging is down::app: HTTP 502');
    expect(issues).toHaveLength(1);
  });

  it('fails the run when the issue API refuses, naming no origin', async () => {
    const fake = fakeFetch(UP);
    const refusing = (async (input: string | URL, init?: RequestInit) =>
      String(input).startsWith('https://api.github.com/') ? new Response('{}', { status: 403 }) : fake.fetchImpl(input, init)) as typeof fetch;
    const lines: string[] = [];
    const code = await main({ env: ENV, fetch: refusing, out: (line) => lines.push(line), sleep: () => Promise.resolve() });
    expect(code).toBe(1);
    expect(lines).toContain('::error title=Uptime issue::staging: GitHub GET /issues: HTTP 403');
  });

  it('opens the issue without the label when the label cannot be set', async () => {
    const posted: { title?: string; labels?: unknown }[] = [];
    const labelRefused = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/issues?')) return new Response('[]', { status: 200 });
      if (url.endsWith('/issues')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { title?: string; labels?: unknown };
        posted.push(body);
        return new Response('{}', { status: body.labels === undefined ? 201 : 422 });
      }
      const id = url.endsWith('/auth/v1/health') ? 'auth' : url.endsWith('/functions/v1/notify') ? 'notify' : 'app';
      const answer = { ...UP, app: { status: 502, body: '' } }[id] as { status: number; body: string };
      return new Response(answer.body, { status: answer.status });
    }) as typeof fetch;
    const lines: string[] = [];
    const code = await main({ env: ENV, fetch: labelRefused, out: (line) => lines.push(line), sleep: () => Promise.resolve() });
    expect(code).toBe(1);
    expect(lines).toContain('issue staging: create');
    expect(posted.map((body) => body.labels)).toEqual([['uptime'], undefined]);
  });

  it('all up: exit 0, no issue', async () => {
    const { code, issues, lines } = await run(ENV);
    expect(code).toBe(0);
    expect(issues).toEqual([]);
    expect(lines.filter((line) => line.startsWith('ok '))).toHaveLength(3);
  });

  it('down: exit 1, an ::error:: per failing check, an issue; recovered: commented and closed', async () => {
    const issues: Parameters<typeof fakeFetch>[1] = [];
    const down = await run(ENV, { ...UP, app: { status: 502, body: 'Bad gateway' } }, issues);
    expect(down.code).toBe(1);
    expect(down.lines).toContain('::error title=staging is down::app: HTTP 502');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.state).toBe('open');

    const again = await run(ENV, { ...UP, app: { status: 502, body: 'Bad gateway' } }, issues);
    expect(again.calls.filter((call) => call.url.endsWith('/comments'))).toEqual([]);

    const up = await run(ENV, UP, issues);
    expect(up.code).toBe(0);
    expect(up.calls.some((call) => call.url.endsWith('/issues/1/comments'))).toBe(true);
    expect(issues[0]?.state).toBe('closed');
  });

  it('masks before printing, and no line or issue names an origin, host or key', async () => {
    const issues: Parameters<typeof fakeFetch>[1] = [];
    const refused = new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ECONNREFUSED ${API}`), { code: 'ECONNREFUSED' }) });
    const { lines, calls } = await run(ENV, { ...UP, auth: refused }, issues);
    const firstOther = lines.findIndex((line) => !line.startsWith('::add-mask::'));
    expect(lines.slice(0, firstOther).length).toBeGreaterThanOrEqual(5);
    const visible = [...lines.slice(firstOther), ...issues.map((issue) => `${issue.title}\n${issue.body}`), ...calls.map((call) => call.body ?? '')];
    for (const text of visible) {
      for (const secret of [APP, API, 'example.test', KEY]) expect(text).not.toContain(secret);
    }
    expect(lines).toContain('::error title=staging is down::auth: ECONNREFUSED');
  });
});

describe('the workflow', () => {
  const source = readFileSync(join(repoRoot, '.github', 'workflows', 'uptime.yml'), 'utf8');
  const workflow = parse(source) as {
    on: { schedule: { cron: string }[]; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    jobs: Record<string, { if: string; permissions: Record<string, string>; steps: { uses?: string; run?: string; env?: Record<string, string> }[] }>;
  };
  const job = workflow.jobs['uptime']!;

  it('runs every 30 minutes and on demand, only when enabled', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '7,37 * * * *' }]);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(job.if).toBe("vars.UPTIME_ENABLED == 'true'");
    expect((job as unknown as { 'timeout-minutes': number })['timeout-minutes']).toBe(10);
  });

  it('holds least privilege: nothing at the top, contents read and issues write in the job', () => {
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it('reads every origin and key from secrets, never a variable, and names none', () => {
    const env = job.steps.find((step) => step.run === 'node scripts/ci/uptime.mjs')?.env ?? {};
    for (const [name, value] of Object.entries(env)) {
      if (name === 'UPTIME_ENABLED') expect(value).toBe('${{ vars.UPTIME_ENABLED }}');
      else if (name === 'GITHUB_TOKEN') expect(value).toBe('${{ github.token }}');
      else expect(value).toBe(`\${{ secrets.${name} }}`);
    }
    expect(Object.keys(env)).toHaveLength(8);
    expect(source).not.toMatch(/https?:\/\/(?!github\.com)[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(source).not.toMatch(/\b\d{1,3}(?:[.-]\d{1,3}){3}\b/);
  });

  it('pins its one action by full SHA and keeps the token out of the checkout', () => {
    const uses = job.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(source).toContain('persist-credentials: false');
  });
});
