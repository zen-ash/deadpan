// ElevenLabs Scribe v2 Realtime: the server mints a single-use token per turn, and the active
// phone connects straight to ElevenLabs with it. https://elevenlabs.io/docs/api-reference/tokens/create

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';
const REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const TOKEN_TIMEOUT_MS = 2500;

export const SCRIBE_SAMPLE_RATE = 16_000;

let warnedNoKey = false;

/**
 * A ready-to-open WebSocket URL for one turn, or null if Scribe is unavailable (no key, slow or
 * failing API). The round carries on without a transcript in that case.
 */
export async function scribeUrl(): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    if (!warnedNoKey) console.warn('[scribe] ELEVENLABS_API_KEY is not set; answers will have no transcripts');
    warnedNoKey = true;
    return null;
  }
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[scribe] token request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) return null;
    const params = new URLSearchParams({
      token,
      model_id: 'scribe_v2_realtime',
      audio_format: `pcm_${SCRIBE_SAMPLE_RATE}`,
      // One commit when the answer ends.
      commit_strategy: 'manual',
      // Word timings drive pauses, speech rate and the response-time cross-check. ElevenLabs
      // says filter_background_audio can't be combined with them, so it stays off.
      include_timestamps: 'true',
      // Keep "um" and "uh": filler counts are part of the score.
      no_verbatim: 'false',
      language_code: 'en',
    });
    return `${REALTIME_URL}?${params}`;
  } catch (err) {
    console.warn('[scribe] token request failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
