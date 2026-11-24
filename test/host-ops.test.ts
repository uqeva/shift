import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * Stories 20.7 and 20.8: `deploy/host/shift-ops.sh` (a stack's backups, the
 * restore drill, the jobs check and the alert hook) and its units. DEPLOY.md
 * §9.12 and §9.13 are the runbook.
 *
 * Two layers. The parts that touch neither Docker nor a database run for real
 * here (the configuration parser, retention, the COPY counter, the alert with
 * no hook). The parts that read a stack are pinned structurally: read-only
 * towards the stack, passwords out of every set, the drill's container cut
 * off and removed. The backup and the drill were run on the staging host
 * (story 20.7's spec, Verification). ShellCheck runs in CI's quality job.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const hostRoot = join(repoRoot, 'deploy', 'host');
const read = (path: string) => readFileSync(join(hostRoot, path), 'utf8');
const script = read('shift-ops.sh');
const scratch = mkdtempSync(join(tmpdir(), 'shift-ops-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function ops(args: string[], options: { etc?: string; input?: string; env?: Record<string, string> } = {}) {
  const result = spawnSync('bash', [join(hostRoot, 'shift-ops.sh'), ...args], {
    encoding: 'utf8',
    input: options.input ?? '',
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', SHIFT_OPS_ETC: options.etc ?? join(scratch, 'none'), ...options.env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A configuration directory holding `<env>.env` with these lines. */
function etcWith(name: string, lines: string[]) {
  const dir = join(scratch, `etc-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'staging.env'), `${lines.join('\n')}\n`);
  return dir;
}

/** The body of one shell function, from `name() {` to its closing `}`. */
function functionBody(name: string): string {
  const start = script.indexOf(`\n${name}() {`);
  expect(start, `${name}() is defined`).toBeGreaterThan(-1);
  return script.slice(start, script.indexOf('\n}\n', start));
}

describe('configuration', () => {
  it('reads KEY=VALUE data with defaults, and prints the effective settings', () => {
    const etc = etcWith('ok', ['# comment', '', 'SERVICE_UUID=abc123def456', 'KEEP_DAILY=3', 'OFFSITE=off']);
    const { status, stdout } = ops(['config', 'staging'], { etc });
    expect(status).toBe(0);
    expect(stdout).toContain('database container     supabase-db-abc123def456');
    expect(stdout).toContain('abc123def456_supabase-db-config abc123def456_supabase-storage-data');
    expect(stdout).toContain('backup directory       /var/backups/shift/staging');
    expect(stdout).toContain('kept                   3 daily, 4 weekly (day 7, Europe/Zagreb), 5 manual');
    expect(stdout).toContain('off-site               off');
  });

  it.each([
    ['an unknown key', ['SERVICE_UUID=abc123def456', 'PASSWORD=x'], /unknown key PASSWORD/],
    ['no service id', ['KEEP_DAILY=7'], /SERVICE_UUID/],
    ['a relative backup directory', ['SERVICE_UUID=abc123def456', 'BACKUP_DIR=backups'], /BACKUP_DIR/],
    ['keeping none', ['SERVICE_UUID=abc123def456', 'KEEP_WEEKLY=0'], /KEEP_WEEKLY/],
    ['rclone with no remote', ['SERVICE_UUID=abc123def456', 'OFFSITE=rclone'], /RCLONE_REMOTE/],
    ['an unknown off-site mode', ['SERVICE_UUID=abc123def456', 'OFFSITE=s3'], /OFFSITE is off or rclone/],
    ['a malformed job', ['SERVICE_UUID=abc123def456', 'JOBS=notify'], /JOBS/],
    ['a line that is not KEY=VALUE', ['SERVICE_UUID=abc123def456', 'export X'], /not KEY=VALUE/],
  ])('refuses %s', (_, lines, message) => {
    const { status, stderr } = ops(['config', 'staging'], { etc: etcWith(`bad-${lines.join('-').replace(/\W/g, '')}`, lines) });
    expect(status).toBe(1);
    expect(stderr).toMatch(message);
  });

  it('never sources the file: a command substitution in a value is not run', () => {
    const marker = join(scratch, 'sourced');
    const etc = etcWith('inject', ['SERVICE_UUID=abc123def456', `BACKUP_TZ=$(touch ${marker})`]);
    expect(ops(['config', 'staging'], { etc }).status).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses a missing file and a malformed environment name', () => {
    expect(ops(['config', 'staging']).stderr).toMatch(/no configuration at/);
    expect(ops(['config', '../etc/passwd']).stderr).toMatch(/not an environment name/);
  });
});

describe('retention (prune)', () => {
  function sets(dir: string, names: string[], complete = true) {
    for (const name of names) {
      mkdirSync(join(dir, name), { recursive: true });
      if (complete) writeFileSync(join(dir, name, 'SHA256SUMS'), '');
    }
  }

  it('keeps the newest complete sets and never touches a partial, an incomplete or a foreign directory', () => {
    const dir = join(scratch, 'daily');
    const days = Array.from({ length: 9 }, (_, index) => `202611${String(10 + index)}T013000Z`);
    sets(dir, days);
    sets(dir, ['.partial-20261120T013000Z', 'notes'], true);
    sets(dir, ['20261101T013000Z'], false);
    const { status, stdout } = ops(['prune', dir, '7']);
    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toEqual(['pruned daily/20261110T013000Z', 'pruned daily/20261111T013000Z']);
    expect(readdirSync(dir).sort()).toEqual(['.partial-20261120T013000Z', '20261101T013000Z', ...days.slice(2), 'notes'].sort());
  });

  it('keeps labelled manual sets the same way, and refuses to keep none', () => {
    const dir = join(scratch, 'manual');
    sets(dir, ['20261101T010000Z-pre-migration', '20261102T010000Z-pre-migration', '20261103T010000Z-before-0075']);
    expect(ops(['prune', dir, '2']).stdout.trim()).toBe('pruned manual/20261101T010000Z-pre-migration');
    expect(ops(['prune', dir, '0']).status).toBe(1);
  });
});

describe('copy-counts: rows per table, read from the dump itself', () => {
  it('counts each COPY block, empty ones included, sorted', () => {
    const text = [
      'SET statement_timeout = 0;',
      'COPY public.members (id, name) FROM stdin;',
      '1\tAna',
      '2\tline one\\nline two',
      '\\.',
      'COPY auth.users (id) FROM stdin;',
      '\\.',
      'COPY public."order" (id) FROM stdin;',
      '7',
      '\\.',
      '',
    ].join('\n');
    const { status, stdout } = ops(['copy-counts'], { input: text });
    expect(status).toBe(0);
    expect(stdout).toBe('auth.users\t0\npublic."order"\t1\npublic.members\t2\n');
  });
});

describe('alert', () => {
  it('with no hook: says the failure is only in the journal, and succeeds', () => {
    const { status, stdout, stderr } = ops(['alert', 'shift-backup@staging.service'], { etc: join(scratch, 'no-hook') });
    expect(status).toBe(0);
    expect(stderr).toContain('SHIFT_ALERT shift-backup@staging.service failed');
    expect(stdout).toMatch(/no alert hook/);
  });

  it('refuses a hook that is not executable, and a malformed unit name', () => {
    const etc = join(scratch, 'hook');
    mkdirSync(etc, { recursive: true });
    writeFileSync(join(etc, 'alert-hook'), '#!/bin/sh\n', { mode: 0o600 });
    expect(ops(['alert', 'shift-backup@staging.service'], { etc }).stderr).toMatch(/not an executable file/);
    expect(ops(['alert', 'x; rm -rf /'], { etc }).stderr).toMatch(/not a unit name/);
  });

  it('runs the hook only when root owns it and nobody else may read or write it', () => {
    const body = functionBody('run_hook');
    expect(body).toContain(`[[ $(stat -c '%u' "$hook") == 0 ]] || die`);
    expect(body).toContain('& 8#077');
    expect(body).toContain('timeout 60 "$hook" "$unit"');
    expect(functionBody('do_alert')).toContain('journalctl -u "$unit" -n 30 --no-pager -o cat 2>/dev/null || true');
  });
});

describe('shift-ops.sh, read-only towards the stack', () => {
  it('is strict bash with a private umask', () => {
    expect(script.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(script).toContain('\nset -euo pipefail\numask 077\n');
  });

  it('touches the stack only through pg_dump, pg_dumpall, pg_restore and read-only psql', () => {
    const execs = script.split('\n').filter((line) => /docker exec/.test(line) && /\$DB_CONTAINER/.test(line));
    expect(execs.length).toBeGreaterThan(0);
    for (const line of execs) {
      expect(line, line).toMatch(/docker exec (-i )?(-e PGOPTIONS='-c default_transaction_read_only=on' )?"\$DB_CONTAINER"( \\$| timeout \d+ pg_dump | timeout \d+ pg_dumpall )/);
    }
    expect(functionBody('psql_ro')).toContain("-e PGOPTIONS='-c default_transaction_read_only=on'");
    // Nothing stops, restarts, removes or changes a container but the drill's own.
    for (const line of script.split('\n').filter((candidate) => /docker (rm|stop|restart|kill|update|compose|volume rm)/.test(candidate))) {
      expect(line, line).toMatch(/\$DRILL_(CONTAINER|VOLUME)/);
    }
    expect(script).not.toMatch(/\/data\/coolify/);
  });

  it('a set holds no role password, and is renamed into place only when complete', () => {
    const body = functionBody('do_backup');
    expect(body).toContain('pg_dumpall -U "$DB_USER" --roles-only --no-role-passwords');
    expect(body).toContain('pg_dump -U "$DB_USER" -d postgres -Fc');
    expect(body).toContain('PARTIAL=$dir/.partial-$name');
    expect(body).toContain('trap cleanup_partial EXIT');
    expect(body.indexOf('sha256sum')).toBeLessThan(body.indexOf('mv -T -- "$PARTIAL" "$dir/$name"'));
    expect(body.indexOf('mv -T -- "$PARTIAL"')).toBeLessThan(body.indexOf('prune "$dir"'));
    expect(body).toContain('chmod 0600 "$PARTIAL"/*');
    expect(script).toContain('readonly SET_NAME_RE=');
  });

  it('the off-site copy is off by default, only adds, and fails loudly', () => {
    expect(script).toContain('  OFFSITE=off\n');
    const body = functionBody('offsite_copy');
    expect(body).toContain('[[ $OFFSITE == rclone ]] || return 0');
    expect(body).toContain('copy --immutable');
    expect(body).not.toMatch(/\b(sync|delete|purge|move)\b/);
    expect(body).toMatch(/rclone is not installed; the local set is kept/);
  });

  it('the drill checks the set, cuts its database off, never runs the restored jobs, and removes it however it ends', () => {
    const body = functionBody('do_drill');
    expect(body.indexOf('sha256sum --quiet -c SHA256SUMS')).toBeLessThan(body.indexOf('docker volume create'));
    expect(body).toContain('trap cleanup_drill EXIT');
    expect(body.indexOf('trap cleanup_drill EXIT')).toBeLessThan(body.indexOf('docker volume create'));
    expect(body.match(/docker run [^\n]*--network none/g)).toHaveLength(2);
    expect(body).toContain('-c cron.launch_active_jobs=off');
    expect(body).toContain("show cron.launch_active_jobs') == off");
    expect(body).toContain('--env-file "$DRILL_SCRATCH/env"');
    expect(body).not.toMatch(/-e POSTGRES_PASSWORD/);
    expect(body).toContain('--clean --if-exists --exit-on-error');
    expect(body).toContain('cmp -s "$DRILL_SCRATCH/expected.tsv" "$DRILL_SCRATCH/restored.tsv"');
    expect(body).toContain('count(decrypted_secret) from vault.decrypted_secrets');
    expect(functionBody('cleanup_drill')).toContain('docker rm -f -v "$DRILL_CONTAINER"');
    expect(functionBody('cleanup_drill')).toContain('docker volume rm "$DRILL_VOLUME"');
  });

  it('the jobs check covers the three cron jobs, the failed calls and the backup age, read-only', () => {
    expect(script).toContain('JOBS="notify:10 remind:20 housekeeping:1560"');
    const body = functionBody('do_jobs_check');
    expect(body).toContain('from cron.job j');
    expect(body).toContain('net._http_response');
    expect(body).toContain('status_code is distinct from 200 or timed_out or error_msg is not null');
    expect(body).toContain('BACKUP_MAX_AGE_HOURS');
    expect(body).not.toMatch(/docker exec/);
  });

  it('installs every source it lists, and the units it installs exist', () => {
    const listed = /readonly SOURCES=\(([^)]*)\)/.exec(script)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    expect(listed.length).toBe(7);
    for (const source of listed) expect(existsSync(join(hostRoot, source)), source).toBe(true);
  });
});

describe('the units', () => {
  const unit = (name: string) => read(join('systemd', name));
  const values = (text: string, key: string) => [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))].map((match) => match[1]);

  it('the backup runs nightly at 01:30 Europe/Zagreb and catches up a missed night', () => {
    const timer = unit('shift-backup@.timer');
    expect(values(timer, 'OnCalendar')).toEqual(['*-*-* 1:30 Europe/Zagreb']);
    expect(values(timer, 'Persistent')).toEqual(['true']);
  });

  it('the jobs check runs every 15 minutes', () => {
    expect(values(unit('shift-jobs-check@.timer'), 'OnCalendar')).toEqual(['*:0/15']);
  });

  it('both services run the installed tool and alert on failure', () => {
    for (const [name, command] of [
      ['shift-backup@.service', 'backup'],
      ['shift-jobs-check@.service', 'jobs-check'],
    ] as const) {
      const text = unit(name);
      expect(values(text, 'ExecStart')).toEqual([`/usr/local/sbin/shift-ops ${command} %i`]);
      expect(values(text, 'OnFailure')).toEqual(['shift-alert@%n.service']);
      expect(values(text, 'Type')).toEqual(['oneshot']);
      expect(values(text, 'UMask')).toEqual(['0077']);
    }
    expect(values(unit('shift-alert@.service'), 'ExecStart')).toEqual(['/usr/local/sbin/shift-ops alert %i']);
  });

  it('the alert hook example fails until a delivery is chosen', () => {
    const hook = read('alert-hook.example');
    expect(hook.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(hook.trimEnd().endsWith('exit 1')).toBe(true);
  });
});

describe('public repository', () => {
  const texts: [string, string][] = [
    ...['shift-ops.sh', 'ops.env.example', 'alert-hook.example'].map((path): [string, string] => [path, read(path)]),
    ...['spec-20-7-backups-leave-the-host-and-a-restore-is-rehearsed.md', 'spec-20-8-someone-hears-when-shift-is-down.md'].map(
      (name): [string, string] => [name, readFileSync(join(repoRoot, '_bmad-output', 'implementation-artifacts', name), 'utf8')],
    ),
  ];

  it('the tool, its examples and the two specs name no address, host or Coolify id of ours', () => {
    for (const [where, text] of texts) {
      for (const [address] of text.matchAll(/\b\d{1,3}(?:[.-]\d{1,3}){3}\b/g)) {
        expect(address.startsWith('127.'), `${where}: ${address}`).toBe(true);
      }
      expect(text, where).not.toMatch(/sslip\.io|\.ts\.net\b/);
      // Coolify's resource ids: 24 lowercase letters and numbers, mixed.
      for (const [token] of text.matchAll(/\b[a-z0-9]{24}\b/g)) {
        expect(/[a-z]/.test(token) && /\d/.test(token), `${where}: ${token}`).toBe(false);
      }
    }
  });
});

// ------------------------------------------------------------ with a stub docker

/**
 * A `docker` on PATH that answers what shift-ops asks of a stack, from
 * environment variables: the database's state, the dump, the cron jobs'
 * rows, the failed calls. Nothing here needs Docker, root or a database.
 */
const stubDir = join(scratch, 'stub-bin');
mkdirSync(stubDir, { recursive: true });
writeFileSync(
  join(stubDir, 'docker'),
  [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'args="$*"',
    'case "$1" in',
    '  inspect)',
    '    case "$3" in',
    "      '{{.State.Running}}') [[ -n ${STUB_DB_DOWN:-} ]] && exit 1; echo true ;;",
    "      '{{.Config.Image}}') echo supabase/postgres:test ;;",
    "      '{{.Image}}') echo sha256:$(printf 'a%.0s' {1..64}) ;;",
    '    esac ;;',
    '  volume) echo "$STUB_VOLUMES/$5" ;;',
    '  run)',
    '    cat >/dev/null',
    '    if [[ $args == *--data-only* ]]; then printf \'COPY public.members (id) FROM stdin;\\n1\\n2\\n\\\\.\\nCOPY auth.users (id) FROM stdin;\\n\\\\.\\n\'; fi ;;',
    '  exec)',
    '    if [[ $args == *" pg_dump "* ]]; then [[ -n ${STUB_DUMP_FAIL:-} ]] && exit 1; echo DUMP; exit 0; fi',
    '    if [[ $args == *pg_dumpall* ]]; then echo "-- roles"; exit 0; fi',
    '    sql="$args $(cat)"',
    '    case "$sql" in',
    '      *pg_postmaster_start_time*) echo "${STUB_UPTIME:-999999}" ;;',
    '      *"from cron.job j"*) job=$(grep -oE "jobname = .[a-z_]+" <<<"$sql" | cut -c12-); var="STUB_JOB_$job"; if [[ -n ${!var:-} ]]; then echo "${!var}"; fi ;;',
    '      *"group by answer"*) echo "${STUB_CALLS:-}" ;;',
    '      *"count(*) from net._http_response"*) echo "${STUB_COUNT:-0}" ;;',
    '      *server_version*) echo 17.6 ;;',
    '      *schema_migrations*) echo 0074 ;;',
    '    esac ;;',
    'esac',
    '',
  ].join('\n'),
  { mode: 0o755 },
);

const OK_JOBS = { STUB_JOB_notify: 't|succeeded|30|', STUB_JOB_remind: 't|succeeded|120|', STUB_JOB_housekeeping: 't|succeeded|3600|' };

/** A stack's scratch world: its config, backups, volumes, lock and state. */
function stack(name: string, extra: string[] = []) {
  const root = join(scratch, `stack-${name}`);
  const backups = join(root, 'backups');
  const volumes = join(root, 'volumes');
  for (const volume of ['abc123def456_supabase-db-config', 'abc123def456_supabase-storage-data']) {
    mkdirSync(join(volumes, volume), { recursive: true });
    writeFileSync(join(volumes, volume, 'file'), volume);
  }
  mkdirSync(join(root, 'lock'), { recursive: true });
  const etc = etcWith(`stack-${name}`, ['SERVICE_UUID=abc123def456', `BACKUP_DIR=${backups}`, 'DISK_MAX_PERCENT=0', ...extra]);
  const env = {
    PATH: `${stubDir}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    SHIFT_OPS_ALLOW_NONROOT: '1',
    SHIFT_OPS_LOCK_DIR: join(root, 'lock'),
    SHIFT_OPS_STATE: join(root, 'state'),
    STUB_VOLUMES: volumes,
  };
  const run = (args: string[], stub: Record<string, string> = {}) => ops(args, { etc, env: { ...env, ...stub } });
  return { backups, run };
}

/** A complete set named for a time `hoursAgo` before now. */
function setAt(dir: string, hoursAgo: number) {
  const stamp = new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  mkdirSync(join(dir, stamp), { recursive: true });
  writeFileSync(join(dir, stamp, 'SHA256SUMS'), '');
  return stamp;
}

const zagrebWeekday = (date: Date) =>
  String(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/Zagreb' }).format(date)) + 1);

describe('backup, run against a stub docker', () => {
  it('writes a complete set, sweeps an interrupted one, and counts rows from the dump', () => {
    const { backups, run } = stack('ok', [`WEEKLY_DAY=${zagrebWeekday(new Date())}`]);
    mkdirSync(join(backups, 'daily', '.partial-20261101T013000Z'), { recursive: true });
    const { status, stdout, stderr } = run(['backup', 'staging']);
    expect(status, stderr).toBe(0);
    expect(stdout).toContain('removed an interrupted set: daily/.partial-20261101T013000Z');
    const daily = readdirSync(join(backups, 'daily'));
    expect(daily).toHaveLength(1);
    const set = join(backups, 'daily', daily[0]!);
    expect(readdirSync(set).sort()).toEqual(
      ['MANIFEST', 'SHA256SUMS', 'db.dump', 'roles.sql', 'row-counts.tsv', 'supabase-db-config.tar.gz', 'supabase-storage-data.tar.gz'].sort(),
    );
    expect(readFileSync(join(set, 'row-counts.tsv'), 'utf8')).toBe('auth.users\t0\npublic.members\t2\n');
    expect(readFileSync(join(set, 'MANIFEST'), 'utf8')).toMatch(/^db_image_id=sha256:a{64}$/m);
    expect(spawnSync('sha256sum', ['--quiet', '-c', 'SHA256SUMS'], { cwd: set }).status).toBe(0);
    // Today is the weekly day: the same set, hard-linked.
    expect(readdirSync(join(backups, 'weekly'))).toEqual(daily);
  });

  it('keeps no weekly set on another day, unless the newest is a week old', () => {
    const other = String((Number(zagrebWeekday(new Date())) % 7) + 1);
    const fresh = stack('not-weekly', [`WEEKLY_DAY=${other}`]);
    expect(fresh.run(['backup', 'staging']).status).toBe(0);
    expect(existsSync(join(fresh.backups, 'weekly')) ? readdirSync(join(fresh.backups, 'weekly')) : []).toEqual([]);

    const late = stack('weekly-catch-up', [`WEEKLY_DAY=${other}`]);
    const old = setAt(join(late.backups, 'weekly'), 8 * 24);
    expect(late.run(['backup', 'staging']).status).toBe(0);
    expect(readdirSync(join(late.backups, 'weekly'))).toHaveLength(2);
    expect(readdirSync(join(late.backups, 'weekly'))).toContain(old);
  });

  it('a failed dump leaves no set and no partial, and fails', () => {
    const { backups, run } = stack('dump-fails');
    const { status, stderr } = run(['backup', 'staging'], { STUB_DUMP_FAIL: '1' });
    expect(status).toBe(1);
    expect(stderr).toMatch(/pg_dump failed; no set written/);
    expect(readdirSync(join(backups, 'daily'))).toEqual([]);
  });

  it('a manual set prints the gate\'s value, and an empty label is refused', () => {
    const { backups, run } = stack('manual');
    const { status, stdout } = run(['backup', 'staging', '--manual', 'pre-migration']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^PRE_MIGRATION_BACKUP_AT=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/m);
    expect(readdirSync(join(backups, 'manual'))[0]).toMatch(/^\d{8}T\d{6}Z-pre-migration$/);
    expect(run(['backup', 'staging', '--manual', '']).status).toBe(1);
  });
});

describe('jobs-check, run against a stub docker', () => {
  function checked(name: string, stub: Record<string, string>, withBackup = true) {
    const world = stack(name);
    if (withBackup) setAt(join(world.backups, 'daily'), 2);
    return { ...world, result: world.run(['jobs-check', 'staging'], { ...OK_JOBS, ...stub }) };
  }

  it('passes when every job ran in time, few calls failed and the backup is fresh', () => {
    const { result } = checked('all-ok', { STUB_COUNT: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('OK   job notify: last success 0 minutes ago');
    expect(result.stdout).toContain('OK   calls: 1 failed in the last 20 minutes');
  });

  it.each([
    ['a stale job', { STUB_JOB_notify: 't|succeeded|660|' }, 'FAIL job notify: last success 11 minutes ago (limit 10)'],
    ['a failed last run', { STUB_JOB_housekeeping: 't|failed|90000|HOUSEKEEPING_HALTED 900 candidates' }, 'FAIL job housekeeping: its last run failed: HOUSEKEEPING_HALTED 900 candidates'],
    ['an inactive job', { STUB_JOB_remind: 'f|succeeded|60|' }, 'FAIL job remind: inactive'],
    ['a missing job', { STUB_JOB_remind: '' }, 'FAIL job remind: not scheduled'],
    ['notify never succeeding', { STUB_JOB_notify: 't|none|never|', STUB_UPTIME: '3600' }, 'FAIL job notify: no successful run recorded'],
    ['housekeeping never run on a database up longer than its limit', { STUB_JOB_housekeeping: 't|none|never|' }, 'FAIL job housekeeping: no successful run recorded'],
    ['two failed calls', { STUB_COUNT: '2', STUB_CALLS: '401 INVOKE_SECRET_REFUSED x2' }, 'FAIL calls: 2 failed in the last 20 minutes: 401 INVOKE_SECRET_REFUSED x2;'],
  ])('fails on %s', (name, stub, line) => {
    const { result } = checked(`fail-${name.replace(/\W+/g, '-')}`, stub);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(line);
  });

  it('only notes a long job that has not run yet on a database up less than its limit', () => {
    const { result } = checked('fresh-housekeeping', { STUB_JOB_housekeeping: 't|none|never|', STUB_UPTIME: '7200' });
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('NOTE job housekeeping: no successful run yet (last run: none)');
  });

  it('fails with no daily set, or a stale one', () => {
    expect(checked('no-backup', {}, false).result.stdout).toMatch(/FAIL backup: no daily set/);
    const stale = stack('stale-backup');
    setAt(join(stale.backups, 'daily'), 30);
    const result = stale.run(['jobs-check', 'staging'], OK_JOBS);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL backup: the newest daily set is 30 hours old');
  });

  it('alerts once per failure, again when it changes, and reports the recovery', () => {
    const { run } = checked('dedupe', { STUB_JOB_notify: 't|succeeded|660|' });
    const again = run(['jobs-check', 'staging'], { ...OK_JOBS, STUB_JOB_notify: 't|succeeded|720|' });
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/still failing as alerted at/);
    const changed = run(['jobs-check', 'staging'], { ...OK_JOBS, STUB_JOB_notify: 't|succeeded|720|', STUB_JOB_remind: 'f|succeeded|60|' });
    expect(changed.status).toBe(1);
    const recovered = run(['jobs-check', 'staging'], OK_JOBS);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain('RECOVERED: every check of staging passes again');
    expect(run(['jobs-check', 'staging'], OK_JOBS).stdout).not.toContain('RECOVERED');
  });
});
