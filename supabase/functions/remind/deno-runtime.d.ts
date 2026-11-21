/**
 * The Deno surface `remind/index.ts` touches, and nothing more.
 *
 * The global `Deno` is declared by `admin-auth/deno-runtime.d.ts` in the
 * same type-check project, and a second `declare const Deno` would not
 * compile, so this shim declares an interface of its own that `index.ts`
 * reads `globalThis.Deno` through (as `notify`'s and `calendar-feed`'s do).
 */

interface RemindDenoRuntime {
  readonly env: {
    get(name: string): string | undefined;
  };
  serve(handler: (request: Request) => Promise<Response>): unknown;
}
