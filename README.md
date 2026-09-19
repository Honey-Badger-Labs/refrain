# Refrain

A static-first PWA that streams a pre-rendered audio library: public-domain text, set to music,
checked by a person, then played with the words following the audio. Nothing is generated while you
listen, so the runtime is a CDN and a folder of files.

**Live app:** https://honey-badger-labs.github.io/refrain/

> The recordings in this repository were made by a synthesiser that lives in `packages/pipeline`,
> not by a music model. They are placeholders — real enough to stream, seek, cache and normalise,
> and labelled as placeholders everywhere they appear. Swapping in a model means writing one render
> adapter; nothing else changes.

## What is here

| Path | What it is |
| --- | --- |
| `apps/listener` | The public app. React + TypeScript + Vite + Tailwind, PWA, offline downloads. Deployed to GitHub Pages. |
| `apps/studio` | The private QC page. Runs on a reviewer's machine against the local store. Never deployed. |
| `packages/catalogue` | The contract between them: record schemas, catalogue building, route parsing, integrity hashing. |
| `packages/pipeline` | The batch pipeline and its CLI: ingest, chunk, lyric prep, render, auto checks, publish, verify. |
| `content/` | The source text and the render presets. Plain files, readable without running anything. |
| `docs/` | Architecture, pipeline, security gate, decisions. |

Two systems, one direction of travel. The studio makes files; the listener reads them. The public
app never talks to a database or a model, and the private side never serves a byte to the internet.

## Getting started

```bash
npm install
npm run pilot        # ingest, render 40 tracks, check, publish, verify. ~3 minutes
npm run dev          # the listener on http://localhost:5173
```

`npm run pilot` needs `ffmpeg` with `libopus` on the PATH. Everything else is npm.

```bash
npm test             # 197 tests
npm run typecheck
npm run lint
npm run build        # production build of the listener
```

### Reviewing candidates

```bash
npm run pipeline -- render --force      # make some candidates
npm run studio                          # API on :5174, review page on :5173
```

Space plays, `j` and `k` move, `a` approves, `1`–`5` reject with a reason. The verdict, the
reviewer and the reason are written to the track's provenance record. Nothing is published without
one — `refrain publish` refuses a track whose only approval came from the auto checks unless you
pass `--allow-auto`, which is how the pilot and CI get through.

### The pipeline

```
refrain ingest       read content/corpora, run the no-word-change gate, record chunks
refrain render       chunk × preset → candidate audio + alignment + auto checks
refrain approve      record a human verdict
refrain reject       record a human verdict and why
refrain publish      copy approved audio into the library, write catalogue.json
refrain verify       parse, re-hash and re-check everything in the published library
refrain status       where the pilot stands
```

`docs/PIPELINE.md` has the detail, including how to plug in a real model.

## Design principles

1. **The script is canonical, audio is a render.** Any track can be deleted and regenerated from
   its recipe. Lyric prep may re-break lines; it may not change a word, and a gate enforces that.
2. **Render offline, serve static.** No AI cost or latency per play.
3. **A human gate before publish.** A rejection keeps its reason so the next take can be different
   rather than just re-rolled.
4. **Rights first.** A corpus with no recorded licence cannot be ingested. Every track carries a
   provenance record, and the app shows it.
5. **No account needed to listen.**
6. **Offline first.** A book downloads with one tap and plays with no network.

## Deploying

Pushing to `main` builds the listener and deploys it to GitHub Pages. The base path is `/refrain/`;
set `REFRAIN_BASE=/` to build for a root domain.

## Licence

Code: MIT, see `LICENCE`. Text: public domain, recorded per corpus in `content/corpora/*/corpus.json`
and shown in the app under **Text, voices and rights**. The synthetic voices model no real person.
