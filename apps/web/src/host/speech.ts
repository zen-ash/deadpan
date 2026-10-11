// Fallback detective voice: the laptop's built-in speech synthesis, used when a line's audio from
// ElevenLabs can't play. Only ever used on the big screen; phones must never call speechSynthesis
// (on iOS it mutes the camera and mic).

const PREFERRED_VOICES = ['Daniel', 'Arthur', 'Fred', 'Alex', 'Google UK English Male'];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  for (const name of PREFERRED_VOICES) {
    const voice = voices.find((v) => v.name.startsWith(name));
    if (voice) return voice;
  }
  return voices[0] ?? null;
}

/**
 * Speaks a line and resolves when it has finished (or failed). Always resolves within a timeout
 * based on the line's length, so a stuck or blocked synthesizer can't stall the round. With
 * `aloud: false` it only waits about as long as speaking it would take.
 */
export function speakLine(text: string, { aloud = true } = {}): Promise<void> {
  return new Promise((resolve) => {
    const words = text.split(/\s+/).length;
    // Speaking can't plausibly take less than this; an earlier "end" is a browser glitch.
    const minMs = words * 220;
    const started = Date.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, Math.max(2000, words * 450) + 2000);

    if (!aloud || !('speechSynthesis' in window)) {
      // No voice at all: wait roughly as long as reading the line aloud would take.
      clearTimeout(timeout);
      setTimeout(finish, Math.max(1500, words * 380));
      return;
    }
    // Safari can fire "end" for a new utterance straight after cancel(), so only cancel when needed.
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.pitch = 0.8;
    const ended = () => setTimeout(finish, Math.max(0, minMs - (Date.now() - started)));
    utterance.onend = ended;
    utterance.onerror = ended;
    speechSynthesis.speak(utterance);
  });
}
