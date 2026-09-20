# The bake-off

One question decides whether Refrain is worth six weeks: **does any available music model sing the
words accurately enough that a human listen is a confirmation rather than an investigation?**

Thirty hours of review sit downstream of that answer. This is how to buy it properly, once, for
about the price of a lunch.

## Before you spend anything

```bash
npm ci && npm run build               # `npm run pipeline` runs dist/, which npm ci does not create
npm run pipeline -- adapters          # what is configured, and whether its key is set
npm run pipeline -- bakeoff --dry-run # the exact prompt, the exact cost, nothing sent
```

Skip the build and the first command fails with `Cannot find module .../pipeline/dist/cli.js`,
which reads like a broken checkout rather than a missing step.

The dry run prints the prompt that would go to the provider. Read it. A bad prompt is the most
common reason a bake-off produces a number that means nothing, and it is free to fix at this point.

## Set it up

**1. Pick your contenders.** Each is a JSON file in `content/providers/`. One real one ships —
`elevenlabs-music.json`, which answers with audio bytes directly and accepts a seed. For a
provider that returns a job to poll, copy `polling-api.example.json`, drop the `.example`, and fill
in the paths from that provider's own docs.

A config never contains a key. It names the environment variable that does, and the loader refuses a
config where someone has pasted a key into that field.

**2. Confirm the terms, and write down that you did.** Every config carries
`modelTerms.commercialUse` and `checkedOn`. Both ship as `false` and empty on purpose: fill them in
only after reading that provider's actual terms, because this is the field the provenance record
inherits.

Two things worth knowing as of September 2026. ElevenLabs Music is a first-party API with a
documented `/v1/music` endpoint and seed support. [Suno's ownership terms turn on subscription
status](https://help.suno.com/en/articles/2416769): on a free plan Suno retains ownership and the
output is non-commercial only, while a paid subscriber "is considered the owner of the song" with
commercial rights that survive cancellation — and the terms were adjusted after its Warner
partnership, so read the current version rather than a summary.

**3. Set the keys.** In the environment — nothing here reads `.env`.

```bash
export ELEVENLABS_API_KEY=...
export REFRAIN_ASR_URL=https://api.openai.com/v1/audio/transcriptions
export REFRAIN_ASR_KEY=...
```

`.env.example` exists for the shape of the variables, not as a file the pipeline loads: the CLI
reads `process.env` and there is no dotenv dependency. A key written into `.env` and left there
produces `Missing keys:` on the dry run, with the key sitting in front of you looking correct. To
keep using the file, load it yourself — `set -a; . ./.env; set +a`, or run the CLI directly with
`node --env-file=.env packages/pipeline/dist/cli.js bakeoff --dry-run`.

Without an ASR endpoint (or a local `whisper-cli`), the run produces audio and **no accuracy
number** — which is the one thing it exists to produce. The command says so rather than quietly
skipping it.

## Run it

```bash
npm run pipeline -- bakeoff --providers elevenlabs-music,your-other-one --runs 2 --budget 15
```

Defaults pick three chunks by shape rather than by taste: the shortest poem, one in the middle, and
the longest. *The Sick Rose*, *London* and *The Tyger* break differently, and a model that handles
all three handles the corpus. Override with `--chunks the-lamb,the-tyger`.

`--runs 2` renders each chunk twice with different seeds, which is the cheapest look at variance —
one lucky take is not a result.

Safety rails: the run refuses to start if the estimate exceeds `--budget`, and stops mid-run rather
than crossing it. Nothing touches the main store; everything lands in `work/bakeoff/<timestamp>/`.

## Read the result

`report.md` gives a table per provider — mean and worst word accuracy, checks passed, mean render
time, cost, and **cost per usable render**, which is the number that actually matters. `report.json`
has every attempt. The audio is beside them, each with its transcript.

Then listen to three of them. The numbers narrow the field; whether it is worth hearing twice is not
a number.

## The gate

| Result | What it means | Next |
| --- | --- | --- |
| ≥98% mean accuracy, <$0.30 per usable | It works | Commit the six weeks. Free or donation-funded keeps the legal review small. |
| 90–98% | Close | One more cycle on the prompt, for the best provider only. Cap it at three hours. |
| <90%, or >$1 per usable | Sung mode does not work yet | **Pivot to drama mode, do not defer it.** Multi-voice TTS is far more accurate and far faster to review. Phase 2 becomes Phase 1. |
| No provider has clean commercial terms | Rights-blocked | Stop. That is not a build problem. |

## What this does not measure

**Alignment.** A music API returns audio, not line timings, so the adapter returns none and the
alignment check reports `skipped`. Synced text on real renders needs a separate step — separate the
vocal stem, then force-align the known lyrics against it — and that only becomes worth building
after a provider has passed this gate.

**Whether anyone wants to listen.** No bake-off answers that one.
