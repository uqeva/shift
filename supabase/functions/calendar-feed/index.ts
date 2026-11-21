/**
 * calendar-feed — the Deno wiring, and nothing else (AD-14; story 16.4).
 *
 * Every decision lives in `handler.ts`, which imports only `@shift/domain`
 * and `@shift/ics` and is asserted from Vitest (AD-15). Both resolve through
 * this function's `deno.json` onto the packages' tsc-built `dist` (AD-7):
 * never `src/`, an `npm:` or `jsr:` specifier, or a copy. Nothing here is
 * fetched at start: the image bundles it all into the eszip.
 *
 * AD-17: the publishable key and the gateway's address are its whole
 * environment; it never holds the secret key.
 */

import { createHandler, readConfiguration } from './handler.ts';

/**
 * `admin-auth/deno-runtime.d.ts` declares the global `Deno` for the one
 * type-check project every function shares, so this file names the runtime
 * through `globalThis`, typed by its own shim, as `notify` does.
 */
const runtime = (globalThis as unknown as { Deno: CalendarFeedDenoRuntime }).Deno;

const configuration = readConfiguration((name) => runtime.env.get(name));

if (!configuration.ok) {
  console.error(`calendar-feed is misconfigured: ${configuration.code}`);
}

runtime.serve(
  createHandler(configuration, {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    digest: (data) => crypto.subtle.digest('SHA-256', data),
    log: (code) => console.error(`calendar-feed: ${code}`),
    timeout: (milliseconds) => AbortSignal.timeout(milliseconds),
  }),
);
