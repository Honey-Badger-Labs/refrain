# Music providers for Refrain

Researched 17 October 2026, after ElevenLabs Music was parked (PR #7). Sources are official terms,
pricing and docs pages only, read on that date. Quotes are verbatim. Nothing was generated or bought.
Terms change: re-read the page before spending, and record `checkedOn` in the provider config.

## What Refrain needs from a licence

A free, public PWA of **sung** public-domain poems, pre-rendered offline, streamed in the app and
downloadable by listeners for offline play. So a provider must:

1. **Sing custom lyrics** we supply, word for word (the whole product is word accuracy).
2. Allow the output in a **public app**, including **streaming** to listeners and **listener downloads**.
3. Have **no "music library" / standalone-redistribution ban** like ElevenLabs Music Terms §4.8(f)
   ("any collection of Output … made available to third parties for those third parties to use, license, download …").
4. Ideally give us **ownership** of the output, an **API** the pipeline can call, and a low cost per usable track
   (pilot ≈ 40 tracks, MVP ≈ 600).

## Summary

Score: ✅ meets, ⚠️ meets with a caveat, ❌ fails. "Sings lyrics" is a hard gate.

| Provider | Sings custom lyrics | Public app + streaming + downloads | Library / redistribution ban | Ownership | API | Price (USD) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Mureka API** | ✅ | ✅ | ✅ none found | ✅ assigned to you | ✅ | ~$0.045/song, $10 minimum top-up | **1st** |
| **Google Lyria 3.5 (Gemini API)** | ✅ | ⚠️ under-18 audience clause | ✅ none found | ✅ Google claims none | ✅ | $0.08/song, paid tier only | **2nd** |
| **Synthesizer V Studio 2 Pro** (singing synth, not generative) | ✅ exact notes + lyrics | ✅ | ⚠️ "compilation … in isolation" clause | ✅ (publish freely) | ❌ desktop app | $99 one-off (+$79/extra voice) | **3rd** (accuracy route) |
| ACE-Step 1.5 (open weights, self-hosted) | ✅ | ✅ no service terms | ✅ MIT licence | ✅ | ✅ self-run | $0 + GPU time | 4th: needs a GPU, no indemnity |
| Suno | ✅ | ✅ on Pro/Premier | ✅ none found | ✅ assigned on Pro/Premier | ❌ no official API; bots banned | $10/mo Pro ($8 yearly), $30/mo Premier ($24 yearly) | 5th: 20–60 downloads/mo, manual |
| ElevenLabs Music (reference) | ✅ | ⚠️ streaming banned on Starter | ❌ library ban on all self-serve plans | n/a | ✅ | $6/mo Starter | Parked (PR #7) |
| MiniMax Music | ✅ | — | — | — | ❌ closed to new users | — | Out |
| Udio | ✅ | ❌ no downloads, non-commercial | ❌ | ❌ | ❌ | — | Out |
| Stable Audio 3.0 | ❌ not documented | — | — | ✅ you own outputs | ✅ | — | Out (instrumental) |
| Mubert | ❌ instrumental | ✅ "App & Services" on Pro | — | — | ✅ | $39/mo Pro | Out |
| Soundraw | ❌ instrumental | ❌ standalone distribution banned | ❌ | — | — | — | Out |
| AIVA | ❌ instrumental | ⚠️ | ❌ large-scale upload banned | ✅ on Pro | ❌ separate deal | €33/mo Pro (yearly) | Out |
| Beatoven | ❌ background music | — | — | — | — | — | Out |
| Loudly | ❌ own models instrumental; vocal model is Mureka's | — | — | — | — | — | See Mureka |
| Human singer (Fiverr / SoundBetter) | ✅ perfect | ✅ | ✅ | ✅ assigned on Fiverr by default | ❌ | per gig, not verified | Flagship tracks only |
| Public-domain recordings (LibriVox etc.) | ⚠️ only what exists | ✅ | ✅ | public domain | ❌ | $0 | Supplement, not a pipeline |

No provider has been measured for word accuracy except ElevenLabs (96.7–96.9%). Every ✅ above is a
licence finding, not a quality finding. The bake-off still has to run.

---

## Detail, with sources

### 1. Mureka (API platform)

- **Terms:** Mureka API Service Agreement, https://platform.mureka.ai/service_terms.pdf, "Effective Date: December 3, 2025".
- **Use in an app:** the agreement covers use "for your own websites, applications, products, or services (each a "Customer Application")" and lets you "make Customer Applications available to End Users".
- **Ownership (§3.2):** "you (a) retain all ownership rights in Input and (b) own all Output. We hereby assign to you all our right, title, and interest, if any, in and to Output."
- **Restrictions (§2):** security, infringement, minors' *use of the Services* without consent, reverse engineering, using output to train models, extracting data outside the APIs, trading API keys. **No music-library, streaming or redistribution ban found.**
- **IP indemnity (§10.1):** "We agree to defend and indemnify you for any damages finally awarded … arising out of a third party claim alleging that the Services (including training data we use to train a model that powers the Services) infringe any third party intellectual property right". It excludes "(d) Claims related to Customer Applications", so the app itself isn't covered.
- **Commercial use (API FAQ, https://platform.mureka.ai/docs/en/faq.html):** "All content generated through paid API calls comes with full usage rights and commercial authorization. You are free to use it in commercial products, platform distribution, advertisements, videos, and other business scenarios."
- **Lyrics:** the pricing page lists song generation with "Song length not exceeding 5m30s", "Supports full song downloads and generates lyrics by default". Custom lyrics are a song-API input.
- **Price (https://platform.mureka.ai/pricing):** "$ 0.045/song", "Up to 1 concurrent request | $ 10", so the minimum top-up is $10, valid 12 months (FAQ). The page renders client-side; figures were read from Mureka's own page as indexed. Re-check at purchase.
- **Fit:** the best licence match found. Pilot cost ≈ 40 × $0.045 ≈ $1.80 per take; MVP ≈ $27 per full take of 600.

### 2. Google Lyria 3.5 (Gemini API)

- **Docs:** https://ai.google.dev/gemini-api/docs/music-generation, "Last updated 2026-10-01 UTC". "With Lyria 3.5, you can generate high-quality, 44.1 kHz stereo audio … These models deliver structural coherence, including vocals, timed lyrics, and full instrumental arrangements." Under "Provide custom lyrics": "You can write your own lyrics and include them in the prompt."
- **Limitations (same page):** "All generated audio includes a SynthID audio watermark". The Pro model "generates songs that last a couple of minutes; exact duration can be influenced through your prompt". Prompts asking for "copyrighted lyrics" are blocked (public-domain text should pass, but test it).
- **Price (https://ai.google.dev/gemini-api/docs/pricing):** "Lyria 3.5 (Full Song) … Free Tier: Not available … Paid Tier: $0.08 per song". Free tier "Used to improve our products: Yes", paid "No".
- **Terms:** Gemini API Additional Terms of Service, https://ai.google.dev/gemini-api/terms, "Effective March 23, 2026".
  - Ownership: "Google won't claim ownership over that content. You acknowledge that Google may generate the same or similar content for others".
  - No music-library or redistribution clause found.
  - **Caveat, age clause:** "You also will not use the Services as part of a website, application, or other service … that is directed towards or is likely to be accessed by individuals under the age of 18." Refrain calls the API only offline in the studio, never from the public app, so the app arguably isn't an "API Client", but a children's poetry app is close to the line. Get a person to decide, or ask Google.
  - Also: "Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes".
- **Fit:** strong and cheap. Pilot ≈ $3.20 per take; MVP ≈ $48. The age clause is the one open question.

### 3. Synthesizer V Studio 2 Pro (Dreamtonics): the word-accuracy route

Not a generative "song from a prompt" model. You enter **notes and lyrics** and a virtual voice sings
them, so every word is there by construction. Refrain's synth adapter already writes melodies with
line timings, which could be exported as the score.

- **Product (https://store.dreamtonics.com/product/synthesizer-v-studio-2-pro):** "$99.00 excl. tax … creating realistic-sounding original songs or vocal covers by simply entering notes and lyrics, choosing a voice … Includes one complimentary voice". Extra voices are "$79.00 excl. tax" each (store voice pages).
- **Voice EULA (https://dreamtonics.com/wp-content/uploads/2025/02/SynthesizerV_VDB_EULA_ALL.txt, "Last Revision 2023/4/14"):** you may "Publish … the Renditions or include the Renditions in publishable media, including but not limited to videos, CDs, DVDs, websites, podcasts … non-commercially or commercially". Conditions:
  - "Any compilation of the Renditions must not be Presented in isolation that facilitates the creation of derived works by a third party. For example, the creation of re-licensable sample packs from the SVD is strictly prohibited." Refrain is a listening library, not a sample pack, but note it.
  - "When Presenting a Rendition, the User must not use names other than designated by Dreamtonics to identify the SVD." Credit the voice by its real name, or don't name it.
  - "Renditions must not be used as the input to a singing synthesis or speech synthesis model".
  - Trial (FLT) voices: "commercial usage … is strictly prohibited".
- **Summary page (https://dreamtonics.com/terms/):** "Distribute or publish works created with this voice database for commercial or non-commercial purposes, with no limitation on the revenue." It also says "This license is granted to a single person".
- **No API.** A desktop editor (Windows/macOS) with in-editor scripting, so it can't run on the box.
- **Fit:** the only option where word accuracy isn't a gamble. The cost is human time per poem, plus a one-off $99–$178.

### 4. ACE-Step 1.5 (open weights)

- **Repo:** https://github.com/ace-step/ACE-Step-1.5, README: "This project is licensed under [MIT]". Model card licence: `mit`. Multilingual lyrics input ("Supports 50+ languages with lyrics prompt"). ACE-Step v1 was Apache-2.0.
- **No service terms at all,** so no library, streaming or ownership clauses. Also **no indemnity**, and the authors warn of "unintentional copyright infringement due to stylistic similarity" (v1 README).
- **Hardware:** "CUDA GPU recommended (also supports MPS / ROCm / Intel XPU / CPU)". The quality tiers want 8–24 GB VRAM. The box has 8 CPU cores and no GPU, so it would need a rented GPU or Jakes's machine.
- **Fit:** cheapest at scale and licence-clean, but quality and accuracy are unknown and it needs engineering time.

### 5. Suno

- **Terms:** https://suno.com/terms, "Effective Date: September 3, 2026".
  - Ownership on paid tiers: "if you are a user who has subscribed to the Pro or Premier paid tier of the Service, Suno hereby assigns to you all of its right, title and interest in and to any Output owned by Suno and generated from Submissions made by you".
  - Free and Basic: "you will only use such Outputs for your lawful, personal and non-commercial purposes."
  - Commercial use is tied to downloads: "You may commercially exploit Output solely to the extent it adheres to Suno's Conditions of Access and Use … provided you have obtained a permitted download of that Output in accordance with the download allocations for your applicable service tier".
  - Rights holders: "Applicable rights holders may also have the right to collect revenue related to distribution of Outputs on third party platforms."
  - Automation is banned: "engage in or use any data mining, robots, scraping, or similar data gathering or extraction methods". There is no official public API.
  - "use the Services … to create, develop or improve any competing products or services". Refrain isn't a generator, so low risk.
  - No music-library ban found.
- **Pricing (https://suno.com/pricing):** Pro "$8 /month … Saves $24 by billing yearly!", i.e. $10 monthly, "20 song downloads per month", "Commercial use rights". Premier "$24 /month … Saves $72 by billing yearly!", i.e. $30 monthly, "60 song downloads per month".
- **Fit:** licence OK, but manual web-only generation and download caps (600 tracks ≈ 10 months of Premier, or bought extras) make it a poor pipeline.

### Ruled out

- **MiniMax Music (https://platform.minimax.io/docs/guides/music-generation):** "Starting August 20, 2026, the paid APIs (Music Generation and Lyrics Generation) will no longer be available to new users".
- **Udio (https://www.udio.com/terms-of-service, "Last Revised on November 12, 2025"):** "You may not download copies of any Output". Also "exploit the Services, any Output, or the outputs of other users for any commercial purpose" is prohibited.
- **Soundraw (https://soundraw.io/terms, "Updated: 2025-06-12"):** prohibits "Selling, distributing without charge, or granting a sublicense for the Generated Music (excluding videos and other deliverables created using said Generated Music) without the Company's prior consent". A standalone-music app is exactly that. It's also an instrumental generator.
- **AIVA (https://www.aiva.ai/legal/1 and /pricing):** an instrumental composer (MIDI/audio). "Licensee is not permitted to use the music as part of a large scale upload or licensing to any third party." Pro "€33 / month … Billed Annually … Copyright owned by YOU". API access only by separate agreement.
- **Mubert (https://mubert.com/render/pricing):** an instrumental generator. Pro lists "Commercial Usage … App & Services" at "$39 / month" ($32.49 billed yearly), but it can't sing poems.
- **Beatoven (https://www.beatoven.ai/terms-of-use, "Last update: 5 June 2024"):** "help content creators create their own soundtracks". Controls are "sections, sounds, moods, dynamics, genres, styles", with no sung lyrics.
- **Stable Audio 3.0 (https://stability.ai/stable-audio):** "a model family trained on fully licensed data". All demo prompts are instrumental and no lyric input is documented, so it's unverified for singing. Licence FAQ (https://stability.ai/license): "as between you and Stability, you own outputs generated from the Core Models". Community licence is free under $1M revenue. Worth re-checking only if Stability ships vocals.
- **Loudly (https://www.loudly.com/terms, dated 21.01.2026):** its sung model is a reseller: "Loudly's music generation model "MANTA-1" utilizes technology provided by Mureka". "Any rights … in Partner Output are granted (if at all) by the applicable third-party provider". Go to Mureka directly.

### Non-AI fallbacks

- **Commissioned singer.** Fiverr Help Center (https://help.fiverr.com/hc/en-us/articles/360011454477-FAQs-for-clients): "Unless the Gig description clearly states otherwise, you are granted all intellectual property rights when the order is delivered. This includes copyrights for the delivered work, and the freelancer waives any moral rights." Fiverr's main ToS page blocked our fetch, so this quote comes from its official help centre. Price is set per gig and wasn't researched. SoundBetter's terms page didn't load, so check the contract per hire. Use for a handful of flagship tracks, not 600.
- **Public-domain recordings.** LibriVox (https://librivox.org/pages/public-domain/): "all our recordings are public domain (definitely in the USA, and maybe in your country as well". They are mostly spoken, with a few sung. Hymn tunes (e.g. 18th–19th-century melodies) are public domain as compositions, but each *recording* has its own rights. Use them as melodies for Synthesizer V or as reference, not as a source of finished tracks.

## Recommendation

Run the existing bake-off, unchanged, on **Mureka API and Google Lyria 3.5**: the same three poems, one
take each, with the same transcribe-and-diff instrument. That costs about $0.14 + $0.24 of usage, but
Mureka needs a $10 minimum top-up. Whichever clears the "≥98% mean accuracy" gate wins. If neither does,
**Synthesizer V** is the accuracy-guaranteed route, at the price of human time per poem. Before
publishing anything from Lyria, settle the under-18 clause.

To add a provider: copy `content/providers/elevenlabs-music.json` and fill in `modelTerms` from this page.
