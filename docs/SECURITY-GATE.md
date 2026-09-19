# Security gate

The spec's release gate is SEC-1, SEC-2, SEC-5, SEC-6 and SEC-7. This is where each requirement
stands, what enforces it, and what is honestly still open.

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| SEC-1 | No DOM XSS via the hash route or share links | **Met** | `packages/catalogue/src/routes.ts`, `ids.ts`. Segments are shape-checked against a strict id pattern before any lookup, then resolved to catalogue records; the app renders the records, never the URL. No `dangerouslySetInnerHTML` anywhere. Tested with script tags, encoded script tags, traversal, null bytes and broken percent-encoding, in unit tests and in the browser. |
| SEC-2 | No content injection through the catalogue | **Met** | `refrain publish` generates the catalogue; nothing hand-edits it, and `refrain verify` fails CI if it does not match its own hash. The app parses it against a Zod schema and refuses it otherwise. CSP allows no inline script. |
| SEC-3 | No bulk scraping or hotlinking of audio | **Partly met** | File names carry the audio's content hash, so they are not guessable. GitHub Pages offers no rate limiting, signed URLs or referrer checks. Behind a CDN this needs tokenised paths; on Pages the honest position is that the library is public. |
| SEC-4 | Feedback form spam and stored XSS | **Partly met** | There is no server to POST to, so there is nothing to spam; feedback is held locally, length-capped at 500 characters and capped at 25 items. If `VITE_FEEDBACK_ENDPOINT` is configured, that endpoint needs its own bot check and rate limit. The studio renders every stored message as text. |
| SEC-5 | Studio compromise | **Met for the pilot** | The studio API binds to 127.0.0.1, serves only from the candidates directory with a containment check on every path, and caps request bodies. It is not a deployment target. Moving to Supabase means reviewer accounts with MFA and Row Level Security on every table; the `Store` interface is the seam. |
| SEC-6 | Unpublished audio must not leak | **Met** | Candidates live in `work/candidates`, which is gitignored and never copied into the app's `public/`. Only `refrain publish` moves a byte across, and only for a track with a recorded approval. A pipeline test asserts the library does not exist until publish runs. |
| SEC-7 | Browser hardening | **Partly met** | A strict CSP ships in a `<meta>` tag: `default-src 'self'`, no inline script, no third-party origin at all. `X-Frame-Options`, `frame-ancestors` and HSTS cannot be set from a meta tag; `github.io` sends HSTS itself, so a github.io deploy is covered and a custom domain must add the rest at the edge. |
| SEC-8 | Privacy law (GDPR, POPIA) | **Met by not collecting** | No analytics, no cookies, no accounts, no network request to any origin but its own. `localStorage` holds a remembered style and voice and any unsent feedback, on the listener's own device. |
| SEC-9 | Supply chain | **Met** | Lockfile committed. Runtime dependencies are React, React DOM and Zod; the pipeline has none beyond the catalogue package, and the icons are generated with `node:zlib` rather than an image library. `npm audit` runs in CI. |
| SEC-10 | Stale or poisoned cached files | **Met** | Cache names carry a build id derived from the built assets, so a deploy cannot be served from an old cache. Published audio file names carry the file's SHA-256, so a changed track is a different URL. The app verifies the catalogue's content hash on every load and refuses to start if it fails. |

## Release gate

Of the five gating items, SEC-1, SEC-2, SEC-5 and SEC-6 are met. **SEC-7 is partly met** and is the
one thing to decide before calling this public:

- On `honey-badger-labs.github.io/refrain/`, HSTS comes from github.io and the meta CSP covers the
  rest. The gate passes.
- On a custom domain, put Cloudflare or similar in front and add `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` and a
  `Content-Security-Policy` header with `frame-ancestors 'none'`. Until that is in place the gate
  does not pass.

SEC-3 is the other honest gap. A static public library on GitHub Pages can be mirrored by anyone.
The spec already names the mitigating position — treat the library as a service, not an asset you
can defend — and that is the right call while the audio is placeholder. It becomes a real decision
the day a paid model renders the library.

## Checking it yourself

```bash
npm test                      # includes the hostile-route cases
npm run pipeline -- verify    # hash and integrity check over the published library
npm audit --omit=dev
```

The browser smoke test in CI loads the app, plays a track, and asserts that four hostile routes land
on the not-found view with nothing executed.
