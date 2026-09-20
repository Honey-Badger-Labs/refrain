# Working on Refrain

A static-first PWA that streams a pre-rendered audio library, plus the batch pipeline that makes it.
Two systems joined by one file format: the studio writes a catalogue, the listener reads it, and
the arrow only points one way.

Read `docs/ARCHITECTURE.md` before changing anything structural. `docs/DECISIONS.md` says why things
are the way they are — check it before "fixing" something that looks odd.

## Commands

```bash
npm install
npm test            # 236 tests, all workspaces, ~20s
npm run typecheck
npm run lint
npm run build       # catalogue → pipeline → listener
npm run dev         # listener on :5173
npm run studio      # review API on :5174 + review page on :5173
npm run pilot       # full pipeline: ingest → render → publish → verify (~3 min, needs ffmpeg)
npm run smoke       # browser smoke test against a running preview
npm run pipeline -- <command>
```

`npm run pilot` and any render need **ffmpeg with libopus** on the PATH. Nothing else is required.

## Invariants — do not break these without saying so out loud

These are not style preferences. Each one is load-bearing, and most have a test guarding them.

1. **Candidates are never served.** Unpublished audio lives in `work/candidates/`, gitignored. Only
   `refrain publish` moves a file into `apps/listener/public/library/`, and only for a track with a
   recorded approval. (SEC-6)
2. **A check that cannot run reports `skipped`, never `pass`.** If a transcriber is absent, word
   accuracy is unknown and must be reported as unknown. A green report that means "we didn't look"
   is worse than no report.
3. **Lyric prep may re-break lines; it may never change a word.** `assertSameWords` enforces this at
   ingest. Do not add a "helpful" normalisation that modernises spelling.
4. **The catalogue is generated, never hand-edited.** It carries a content hash; the app recomputes
   it on load and refuses a mismatch. Editing `catalogue.json` by hand will fail `refrain verify`
   and CI. (SEC-2, SEC-10)
5. **Nothing from a URL is rendered.** Route segments are shape-checked, then resolved to catalogue
   records, and the records are what reach the DOM. No `dangerouslySetInnerHTML`, anywhere. (SEC-1)
6. **A render is a pure function of (chunk, preset, seed).** The synth adapter is tested for
   sample-for-sample equality across runs. Keep new adapters deterministic where the provider allows
   it.
7. **Re-rendering clears the verdict.** The take being judged has changed, so the approval no longer
   applies.
8. **The listener fetches only its own origin.** No CDN, no font host, no analytics. The CSP in
   `index.html` says `default-src 'self'` and that is the design, not an oversight.

## Layout

| Path | |
| --- | --- |
| `packages/catalogue` | Schemas, route parsing, content hashing, source selection. **Both apps import this; neither trusts the file it parses.** |
| `packages/pipeline` | The `refrain` CLI. Commands in `src/commands/`, render adapters in `src/render/`, checks in `src/checks/`. |
| `apps/listener` | The public PWA. Never imports from `packages/pipeline`. |
| `apps/studio` | Private QC tool. Localhost only. Not a deployment target — do not add a build step that suggests otherwise. |
| `content/` | Source text, presets, provider configs. Plain files, readable without running anything. |
| `data/store.json` | Studio records. Committed for the pilot so the repo is runnable; behind a `Store` interface so Postgres can replace it. |

## Conventions

- **TypeScript strict, including `noUncheckedIndexedAccess`.** Array access returns `T | undefined`;
  handle it rather than reaching for `!` out of habit.
- **Comments explain *why*, never *what*.** If a comment restates the code, delete it. If a decision
  looks strange, the comment is where its reason belongs.
- **British English in prose and user-facing strings** ("licence" the noun, "normalise", "colour" in
  comments). Code identifiers stay as their libraries spell them.
- **Errors tell the reader what to do next.** `"ffmpeg is not on PATH. Install it and run again"`,
  not `"ENOENT"`.
- **No new runtime dependencies without a reason in the commit message.** Runtime deps are React,
  React DOM and Zod. The pipeline has none. Icons are generated with `node:zlib` rather than an
  image library, on purpose. (SEC-9)
- Zero-dependency solutions are preferred where they are under ~150 lines and testable.

## Tests

- Vitest, one run across all workspaces. jsdom for the listener; the shared shims live in
  `test/setup.ts`.
- **Test behaviour, not implementation.** The route tests feed hostile URLs; the check tests feed
  broken audio; the pipeline test runs the real thing in a temp directory.
- A bug fix gets a regression test that fails before the fix. Two in this repo carry a comment
  saying what went wrong — follow that pattern.
- The browser smoke test (`scripts/smoke.mjs`) is the end-to-end gate: it plays real audio and walks
  hostile routes. Run it if you touch routing, the player, or the service worker.

## Before you commit

```bash
npm run lint && npm run typecheck && npm test
npm run pipeline -- verify     # if you touched the pipeline or the library
```

Commit messages: a short imperative subject, then *why* in the body — what was tried, what a test
caught, what the reader would otherwise wonder about. Look at `git log` for the register.

## Things that will bite you

- **Chromium has no AAC.** The browser smoke test plays the Opus encoding. That is not a bug; it is
  also why tracks ship in two formats.
- **`npm run pilot` rewrites `apps/listener/public/library/`.** New hashes, new file names, a big
  diff. Only run it when you mean to.
- **Publishing twice** used to break because the track's path had already been rewritten to the
  public one. Candidate files are found by convention now — do not reintroduce a lookup by stored
  path.
- **The service worker caches aggressively.** If a change seems not to take effect in a preview,
  check the cache name got a new build id.
- **Vite's base path is `/refrain/`.** Set `REFRAIN_BASE=/` for a root deploy.

## Out of scope unless asked

Drama mode, accounts, favourites sync, reading plans, per-chunk Open Graph images. Each is recorded
in `docs/ARCHITECTURE.md` with the reason it is not built. Do not start one as a side effect of
another task.
