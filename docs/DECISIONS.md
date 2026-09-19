# Decisions

The spec's four decisions, the open questions it left, and what building the thing settled.

## Carried from the spec

| ID | Decision | Revisit when |
| --- | --- | --- |
| R-1 | Pre-render everything; nothing generated at listen time | Personalised content becomes a goal |
| R-2 | The public app is static; the studio is private and separate | Accounts or social features need a live API |
| R-3 | Sung mode first, drama mode second | The pilot shows drama is cheaper to QC |
| R-4 | Every track is traceable to chunk, preset and recipe | Never |

R-4 is now a test, not a promise: the synth renderer is a pure function of `(chunkId, presetId,
seed)` and a test asserts sample-for-sample equality across two runs.

## Settled while building

| ID | Decision | Why |
| --- | --- | --- |
| R-5 | The pilot corpus is ten Blake poems, not 150 Psalms | Short metrical text is the hardest case for word accuracy and the easiest for a reviewer to judge in under a minute. It also makes the rights page a single uncontested sentence, which a Bible edition does not: the spec's suggested Berean Standard Bible needs its current terms confirmed, and that is a task, not a fact. |
| R-6 | Two delivery formats per track: Opus first, AAC second | No single codec covers every browser at a sensible size. Opus is about a third smaller and is what most listeners get; Safari and older iOS need AAC. The browser is asked with `canPlayType` rather than guessed from the user agent. |
| R-7 | Reading order comes from the source file name, ids come from the title | A poet's order is not alphabetical, and a link into the library should survive a reordering. |
| R-8 | A check that cannot run reports `skipped`, never `pass` | With no transcriber installed, word accuracy is unknown. A pipeline that reports unknown as passing is worse than one with no check at all, because it is believed. |
| R-9 | Auto-approval is possible but marked, and refused by publish unless asked for | CI and the placeholder pilot need to run end to end without a person. Principle 3 survives by making the bypass visible: the reviewer is recorded as `auto:*` and `publish` refuses it without `--allow-auto`. |
| R-10 | Share links point at a generated per-state HTML page, not the hash route | A hash route is invisible to a crawler, so every shared poem previewed as "Refrain". One tiny generated page per chunk × preset carries the real title and opening line and redirects back. No script in it. |
| R-11 | The studio store is a JSON file behind a `Store` interface | The repository has to be runnable with `npm install` and nothing else. Supabase is one more implementation of the same interface, not a rewrite, and the spec's Row Level Security lives there. |

## The spec's open questions

**Pilot corpus: Psalms or a poetry collection?** — Answered: poetry, and specifically Blake. See R-5.
A 150-chapter book is the right shape for the MVP's 600 tracks; it is the wrong shape for a pilot
whose job is to produce four cost numbers as fast as possible.

**Which music model has commercial output terms and the best word accuracy?** — Not answered, and
not answerable from here: it needs a paid test of two or three models against the accuracy check,
which now exists and is the right instrument for the comparison. The `RenderAdapter` interface and
the `modelTerms` field in the provenance record are the slots the answer goes into.

**Free, donation-funded, or paid?** — Not answered; it is a business decision, not a technical one.
What the build can say is that it changes SEC-3 from a note into a requirement: a library that
someone has paid to render is an asset worth protecting, and GitHub Pages cannot protect it.

**Own product, or a module sharing MelodyFlow's pipeline?** — The pipeline does not want sharing.
MelodyFlow is a zero-build single-file PWA; this needs a build, a catalogue contract and a review
tool. What they should share is the *look* — the Nocturne palette is deliberately the same — and
eventually a Honey Badger Labs component package, not this pipeline.

**Which forced aligner works on sung audio?** — Not answered, but the shape of the answer is clear:
separate the vocal stem first (Demucs or similar), then force-align the known lyrics against the
stem with WhisperX or the Montreal Forced Aligner. The synth adapter sidesteps this by emitting its
own timings, which is exactly why a model-backed adapter must not be trusted to do the same. The
exit test is not "it ran" but "the highlight lands on the right line for a whole poem".

## Where the spec was wrong

- It says the listener stack is "the same as MelodyFlow". MelodyFlow is vanilla JavaScript in a
  single `index.html` with no build step. React + TypeScript + Vite + Tailwind is a reasonable
  choice for this app, but it is a new stack for the lab, not a shared one.
- The MVP arithmetic — 150 chunks × 2 styles × 2 voices — is 600 tracks, but that is 4 takes of 150
  chunks, not the "one engine, two render modes" matrix the scope table implies. Worth restating
  before anyone budgets from it.
- "Word accuracy 99% or better" is a target with no instrument behind it until a transcriber is
  installed. The check exists; the number does not, and `refrain status` says so.
