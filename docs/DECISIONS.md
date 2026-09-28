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
seed)` and a test asserts sample-for-sample equality across two runs. It does not hold for
ElevenLabs Music, which refuses a seed and a prompt together — the provider config says so rather
than implying otherwise.

**R-3 has been tested and stands.** Its revisit condition was "the pilot shows drama is cheaper to
QC", and the pilot does not show that. ElevenLabs Music sang three Blake poems at 96.9% word
accuracy with nothing dropped and nothing added, which puts sung mode in the "Close" band of the
bake-off gate — one more cycle on the prompt — and nowhere near the <90% that would have made drama
mode Phase 1.

The run very nearly said the opposite. It first reported 85.4% and printed "not usable for a
text-faithful library", which is the pivot verdict, and that number was an artefact of a weak
transcriber and of scoring Blake's spelling as the singer's mistakes. **A decision to reorder the
whole roadmap was one unexamined number away from being made.** See `docs/BAKEOFF.md`.

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
| R-13 | Accuracy is judged on what was sung; clipping means a flat top, not a loud peak | Both checks were failing good renders, and together they produced the wrong verdict. The accuracy check compared a 1794 page to a modern transcript, so `charter'd` against `chartered` and `tyger` against `tiger` counted as the singer's mistakes — both sides are normalised to the sung form before the diff, and the detail names what it set aside so the number can be read rather than taken. The corpus keeps its spelling; what changed is how two texts are judged the same. The clipping check counted every sample at the ceiling, which lossy decoding routinely exceeds on audio that was never clipped — but the deeper fault was ours, since `encodeWav` clamps to 16 bits and a render that decoded at 1.34 was flat-topped *by being saved*. Renders are normalised to -1 dBFS before writing, and the check now looks for samples at the ceiling and not moving, which is what destroyed audio looks like and what a loud one does not. |
| R-12 | A track's alignment is a token stream with a declared kind, not a list of text lines | The search that answers "which line is sounding now" is not about text. A tongue-drum arrangement indexes pads and a ukulele chart indexes chord shapes, and both want exactly the behaviour the synced text view already has, down to returning nothing during an instrumental passage. `Performance` names what an index points into so a consumer knows what it has been handed. Added beside `alignment` rather than replacing it: `lineIndex` is what every published `catalogue.json` says, the catalogue carries a content hash the app refuses on mismatch (invariant 4), and renaming the field would invalidate every library this code can play in order to buy a tidier name. `asTokenSpans` bridges the two spellings once per track rather than once per timeupdate, and `performances` is optional rather than defaulted so a track with nothing extra still serialises byte-for-byte as before. `refrain verify` passes the committed 40 unchanged. |

## The spec's open questions

**Pilot corpus: Psalms or a poetry collection?** — Answered: poetry, and specifically Blake. See R-5.
A 150-chapter book is the right shape for the MVP's 600 tracks; it is the wrong shape for a pilot
whose job is to produce four cost numbers as fast as possible.

**Which music model has commercial output terms and the best word accuracy?** — Half answered.
ElevenLabs Music has been measured: 96.9% as sung, $0.10 and 13 seconds per render. No second
provider has been tested, so this is a number rather than a comparison, and "best" is still open.
The terms half is untouched — `modelTerms.commercialUse` is still `false` and `checkedOn` still
empty, because reading a provider's terms is a person's job and not a pipeline's.

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
- "Word accuracy 99% or better" was a target with no instrument behind it. The number now exists —
  96.9% for ElevenLabs Music — and getting it showed the target was the easy half. The instrument
  had to be argued with twice first: a transcriber small enough to be wrong about a third of the
  errors, and a comparison that scored Blake's spelling against him. A threshold is only as good as
  the thing measuring against it, and the spec did not say which transcriber, which is the gap that
  produced an 11-point swing.
