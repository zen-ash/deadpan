// Small pieces shared by the landing page, the phone and the big screen: the emblem row and the
// line icons. Icons are 24-unit strokes that take the text colour.

export function Emblems({ small = false }: { small?: boolean }) {
  return (
    <div className={`emblems ${small ? 'small' : ''}`} aria-hidden>
      <span className="emblem">
        <svg viewBox="0 0 24 24">
          <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
      </span>
      <span className="emblem main">D</span>
      <span className="emblem">
        <svg viewBox="0 0 24 24">
          <path d="M2 12h4l2.5-6 4 12 2.5-6H22" />
        </svg>
      </span>
    </div>
  );
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function CheckIcon({ ok }: { ok: boolean }) {
  return (
    <svg className={`icon check ${ok ? 'ok' : 'bad'}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Outline when there's no pulse yet; filled and beating at the measured rate when there is. */
export function HeartIcon({ bpm, size = 16 }: { bpm: number | null; size?: number }) {
  return (
    <svg
      className={`icon heart ${bpm ? 'beating' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      style={bpm ? { animationDuration: `${(60 / bpm).toFixed(2)}s` } : undefined}
    >
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  );
}

export function FingerprintIcon() {
  return (
    <svg className="icon fingerprint" width="48" height="48" viewBox="0 0 24 24" aria-hidden>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0v3" />
      <path d="M9 20.5c1-1.8 1.5-4 1.5-6.5v-3a1.5 1.5 0 0 1 3 0V14c0 2.3-.4 4.4-1.2 6.3" />
      <path d="M6.5 12.5c0 2.6-.4 4.6-1.3 6.3" />
      <path d="M17.5 15.5c0 1.6-.2 3-.6 4.4" />
      <path d="M4.2 7.2A8.5 8.5 0 0 1 19.8 7" />
    </svg>
  );
}

/** Display headlines always end with a period: "Ash" → "Ash.". Names keep the player's own spelling. */
export function withPeriod(text: string): string {
  const t = text.trim();
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** "egg" → "Egg.", for the secret word. */
export function headline(text: string): string {
  const t = text.trim();
  return t ? withPeriod(t[0]!.toUpperCase() + t.slice(1)) : t;
}

/** A z-score or drift counts as a spike, drawn in coral, above this. */
export const SPIKE = 1;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * Pulse quality below 0.3 never reaches the screen (the phone sends no bpm); above 0.45 is good.
 * Once the round is over, a missing pulse is no longer "being read".
 */
export function pulseText(bpm: number | null, quality: number, stale: boolean, over = false): string {
  if (stale) return 'No signal';
  if (bpm === null) return over ? 'No pulse signal' : 'Reading pulse…';
  return `${Math.round(bpm)} bpm · ${quality >= 0.45 ? 'good' : 'fair'} signal`;
}
