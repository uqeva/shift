import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * STORY 19.2 (AD-22's probe): `scripts/probe/signup-enumeration.mjs` passes a
 * gateway that answers every address alike and fails one that does not. The
 * probe is run as a process against in-process stand-ins; nothing here opens a
 * database or a container. Its runs against 20.1's rehearsal stack and staging
 * are 20.5's (deferred-work).
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PROBE = join(repoRoot, 'scripts', 'probe', 'signup-enumeration.mjs');
const CONFIRMED = 'potvrden@example.com';
const UNCONFIRMED = 'nepotvrden@example.com';

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) resolve();
    else server.close(() => resolve());
  });
  server = undefined;
});

type Answer = (path: string, body: Record<string, unknown>) => { status: number; body: string; headers?: Record<string, string> };

async function gateway(answer: Answer): Promise<string> {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const answered = answer(request.url ?? '', body);
      response.writeHead(answered.status, { 'content-type': 'application/json', ...answered.headers });
      response.end(answered.body);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

function probe(api: string, extra: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [PROBE],
      {
        env: {
          PATH: process.env['PATH'] ?? '',
          SHIFT_PROBE_API: api,
          SHIFT_PROBE_KEY: 'sb_publishable_probe',
          SHIFT_PROBE_KNOWN_CONFIRMED: CONFIRMED,
          SHIFT_PROBE_KNOWN_UNCONFIRMED: UNCONFIRMED,
          SHIFT_PROBE_NEW_DOMAIN: 'example.com',
          SHIFT_PROBE_SAMPLES: '3',
          ...extra,
        },
      },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : Number((error as { code?: number }).code ?? 1), stdout, stderr });
      },
    );
  });
}

/** Kong as AD-22 builds it: `200 {}` on every mail route, one refusal on the grant. */
const MASKED: Answer = (path) =>
  path.startsWith('/auth/v1/token')
    ? { status: 400, body: '{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}' }
    : { status: 200, body: '{}' };

describe('the gateway enumeration probe (story 19.2, B1, B2, B5)', () => {
  it('passes a gateway that gives every address one answer, and prints no address', async () => {
    const result = await probe(await gateway(MASKED));

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('== signup: status 200, 1 body, 1 header set');
    expect(result.stdout).toContain('B8 residual (reported, not asserted)');
    expect(result.stdout + result.stderr).not.toContain(CONFIRMED);
    expect(result.stdout + result.stderr).not.toContain('@');
  });

  it('fails a gateway whose body names a known address', async () => {
    const leaking: Answer = (path, body) =>
      path === '/auth/v1/signup' && body['email'] === CONFIRMED ? { status: 200, body: '{"identities":[]}' } : MASKED(path, body);
    const result = await probe(await gateway(leaking));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('FAIL signup: more than one body');
  });

  it('fails a gateway whose headers differ, and one whose grant tells the two refusals apart', async () => {
    const headed: Answer = (path, body) =>
      path === '/auth/v1/recover' && body['email'] === UNCONFIRMED
        ? { status: 200, body: '{}', headers: { 'x-upstream': 'gotrue' } }
        : path.startsWith('/auth/v1/token') && body['email'] === CONFIRMED
          ? { status: 400, body: '{"error_code":"wrong_password"}' }
          : MASKED(path, body);
    const result = await probe(await gateway(headed));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('FAIL recover: more than one set of headers');
    expect(result.stderr).toContain('FAIL token: an unknown address and a wrong password answer differently');
  });

  it('fails a gateway that answers a kind slower than one timing class', async () => {
    server = undefined;
    const api = await new Promise<string>((resolve) => {
      server = createServer((request, response) => {
        let raw = '';
        request.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf8');
        });
        request.on('end', () => {
          const body = JSON.parse(raw || '{}') as Record<string, unknown>;
          const answered = MASKED(request.url ?? '', body);
          const delay = request.url === '/auth/v1/signup' && body['email'] === CONFIRMED ? 150 : 0;
          setTimeout(() => {
            response.writeHead(answered.status, { 'content-type': 'application/json' });
            response.end(answered.body);
          }, delay);
        });
      });
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${String((server?.address() as AddressInfo).port)}`));
    });
    const result = await probe(api);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/FAIL signup: the medians span \d+\.\d ms, wider than one class/);
  });

  it('stops on the mail limit, and refuses missing inputs', async () => {
    const limited = await probe(await gateway(() => ({ status: 429, body: '{"message":"API rate limit exceeded"}' })));
    expect(limited.code).toBe(1);
    expect(limited.stderr).toContain("answered 429 (Kong's mail limit)");

    const missing = await probe('', {});
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('SHIFT_PROBE_API is not set');
  });

  it('stops on the sign-in limit, and on a transport failure, rather than counting either as an answer', async () => {
    const limited = await probe(
      await gateway((path, body) =>
        path.startsWith('/auth/v1/token') ? { status: 429, body: '{"message":"API rate limit exceeded"}' } : MASKED(path, body),
      ),
    );
    expect(limited.code).toBe(1);
    expect(limited.stderr).toContain('token answered 429 (the sign-in limit)');

    // A port nothing listens on: closed at once after it is chosen.
    const closed = await gateway(MASKED);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const unreachable = await probe(closed);
    expect(unreachable.code).toBe(1);
    expect(unreachable.stderr).toContain('FAIL signup: transport failure');
  });

  it('refuses plain http to anything but loopback (the key and the grants never travel in clear text)', async () => {
    const remote = await probe('http://staging.example.com');
    expect(remote.code).toBe(2);
    expect(remote.stderr).toContain('SHIFT_PROBE_API must be https unless it is loopback');
  });
});
