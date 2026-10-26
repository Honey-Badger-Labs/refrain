# Refrain: which music provider next?

I checked 15 options against Refrain's needs: sung poems, word for word, in a free public app, with
streaming and offline downloads. I used official terms and pricing pages only, read on 17 Oct 2026.
Full detail and quotes: `docs/MUSIC-PROVIDERS.md` (PR #8).

## Top 3

1. **Mureka API.** About **$0.045 a song** ($10 minimum top-up, valid 12 months).
   - Sings your lyrics, and has a proper API.
   - Its terms say "you … own all Output", and they cover apps used by end users.
   - **No music-library or streaming ban**, which is the clause that blocked ElevenLabs.
   - Mureka even indemnifies against training-data copyright claims.
2. **Google Lyria 3.5 (Gemini API).** **$0.08 a song**, paid tier only.
   - Sings custom lyrics, and "Google won't claim ownership".
   - No library ban.
   - One question: Google bars apps "likely to be accessed by individuals under the age of 18". We only use the API offline, not inside the app, but a poetry app for all ages is close to that line.
3. **Synthesizer V Studio 2 Pro.** **$99 one-off**, plus $79 for each extra voice.
   - Not AI-from-a-prompt: you type the notes and lyrics, so **every word is right by construction**.
   - Publishing commercially is allowed.
   - No API: it's a desktop app, so it takes my setup work and some of your time per poem.

Ruled out: Udio (no downloads at all), MiniMax (closed to new users), Soundraw, AIVA, Mubert,
Beatoven, Stable Audio (instrumental only). Suno's licence is fine, but it has no API and allows
20–60 downloads a month.

## My recommendation

**A.** Spend about $10 to test Mureka and Lyria head to head. We'd use the same 3 poems and the same
accuracy check as the ElevenLabs test, so the numbers line up. Usage is about $0.40, and the $10 is
Mureka's minimum top-up, which leaves credit for the pilot afterwards.

## Your decision (pick one)

- **A. Test Mureka + Lyria, about $10 total (recommended).** You'd need to make 2 quick sign-ups, each about 5 minutes (I'll send the steps):
  - a Mureka API account with a $10 top-up;
  - a Google AI Studio API key with billing turned on.
- **B. Mureka only, $10.** One sign-up. Skips the Lyria age-clause question.
- **C. Synthesizer V, $99.** Guaranteed word accuracy, slower to make. ⚠️ Needs serious thought: it runs on your computer, not mine.
- **D. Keep Refrain parked.** No spend.
