import { assertFfmpeg } from '../../src/audio/encode.js';

/**
 * Whether this machine can run the tests that actually encode or decode audio.
 *
 * Absent ffmpeg means two different things in two places. On a contributor's
 * machine it means the test cannot run, and the honest report is `skipped` —
 * the same rule the pipeline applies to its own checks. On CI it means the
 * runner is misconfigured: the workflow installs ffmpeg before it gets here,
 * so a quiet skip would turn a broken runner into a green tick.
 */
export const hasFfmpeg = await (async (): Promise<boolean> => {
  try {
    await assertFfmpeg();
    return true;
  } catch (error) {
    if (process.env.CI) {
      throw new Error(
        `CI installs ffmpeg before running the tests, but it is not usable here: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return false;
  }
})();
