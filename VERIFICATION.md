# Local verification — 2026-09-13

Input: the supplied `scuri-main.zip`.

Input SHA-256: `bbc86e3f98330ff77b46d030f1f0f797aeccc91cfb32fcb9eb15e391c3e724b3`.

Environment: Windows, Node.js 24.19.0, pnpm 11.19.0, Next.js 16.3.0, Vitest 4.1.10. Public dependencies were installed using a temporary pnpm lock imported from the supplied npm lock. That temporary lock, dependency store, node_modules, build output and local Git metadata are not part of the deliverable. No package dependency changes are included.

| Check | Result |
| --- | --- |
| Baseline unit suite | 54 tests passed in 8 files |
| Final `pnpm test` | **85 tests passed in 10 files**, including 31 new regression tests |
| `pnpm typecheck` | Passed; final production build also completed TypeScript checking |
| `pnpm lint` | Passed, zero errors and warnings |
| `pnpm build` (`next build --webpack`) | Passed: compiled, typechecked, prerendered all 4 static pages and completed build traces |
| `git diff --check` | Passed |

New tests exercise fabricated in-memory project/page/asset rows only. Supabase, Drive downloads/uploads, image preparation and IndexedDB calls are mocked where appropriate; the safety suite blocks accidental real fetches. The mock cloud enforces primary-row and page/frame uniqueness and models the page FK cascade. No helper seeds, resets or modifies a real database.

The build used empty public Supabase/Google Drive configuration and disabled Next.js telemetry. Process-spawning checks ran through the permitted local execution path after the Windows sandbox blocked child process startup. No Supabase, Drive, Vercel, GitHub, browser session or real credentials were used.

Reproduce from the fixed source using the existing npm scripts:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Run unit checks without live service configuration. Live database, OAuth, browser UI and physical-device acceptance tests are outside this verification. There was no deployment or Islands recovery. The fix's multi-request write limitation and the manual recovery boundary are documented in `PHOTO_SYNC_FIX.md` and `ISLANDS_RECOVERY.md`.
