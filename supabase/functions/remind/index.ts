/**
 * remind — the Deno wiring, and nothing else (AD-14; story 17.2).
 *
 * Every decision lives in `handler.ts`, which imports only `@shift/domain`
 * and is asserted from Vitest (AD-15). The domain resolves through this
 * function's `deno.json` onto the package's tsc-built `dist` (AD-7): never
 * `src/`, an `npm:` or `jsr:` specifier, or a copy. Nothing here is fetched
 * at start: the image bundles it all into the eszip.
 *
 * AD-17: the gateway's address, the secret key and the invoke secret are its
 * whole environment, read by `handler.ts`'s `readConfiguration` alone.
 */

import { createHandler, readConfiguration } from './handler.ts';

/**
 * `admin-auth/deno-runtime.d.ts` declares the global `Deno` for the one
 * type-check project every function shares, so this file names the runtime
 * through `globalThis`, typed by its own shim, as `notify` does.
 */
const runtime = (globalThis as unknown as { Deno: RemindDenoRuntime }).Deno;

const configuration = readConfiguration((name) => runtime.env.get(name));

if (!configuration.ok) {
  console.error(`remind is misconfigured: ${configuration.code}`);
}

runtime.serve(
  createHandler(configuration, {
    fetch: (input, init) => fetch(input, init),
    timeout: (milliseconds) => AbortSignal.timeout(milliseconds),
    log: (code) => console.error(`remind: ${code}`),
  }),
);
