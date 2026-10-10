import { useEffect, useRef } from 'react';
import { micLevel } from '../lib/media';

/** Rest heights of the five bars, in px. */
const SHAPE = {
  meter: [8, 14, 10, 6, 4],
  wave: [6, 14, 10, 16, 8],
};

/**
 * Five small bars driven by the mic. As a meter, bars light up left to right with the level; as a
 * wave ("the detective is listening"), they all stay dark and grow when the player speaks.
 */
export function MicBars({ analyser, mode = 'meter' }: { analyser: AnalyserNode | null; mode?: 'meter' | 'wave' }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bars = ref.current ? Array.from(ref.current.children as HTMLCollectionOf<HTMLElement>) : [];
    if (!analyser || bars.length === 0) return;
    const buffer = new Float32Array(analyser.fftSize);
    const shape = SHAPE[mode];
    let smooth = 0;
    let frame = requestAnimationFrame(function draw(now) {
      const db = 20 * Math.log10(micLevel(analyser, buffer) + 1e-8);
      const fill = Math.min(1, Math.max(0, (db + 60) / 45)); // -60 dB empty, -15 dB full
      smooth += (fill - smooth) * (fill > smooth ? 0.5 : 0.12);
      bars.forEach((bar, i) => {
        const rest = shape[i]!;
        if (mode === 'meter') {
          const on = smooth > i / bars.length + 0.02;
          bar.classList.toggle('off', !on);
          bar.style.height = `${on ? Math.round(rest + 4 * smooth) : rest}px`;
        } else {
          const wobble = 0.75 + 0.25 * Math.sin(now / 140 + i * 1.7);
          bar.style.height = `${Math.round(3 + (rest - 3) * Math.max(0.25, smooth * 1.6) * wobble)}px`;
        }
      });
      frame = requestAnimationFrame(draw);
    });
    return () => cancelAnimationFrame(frame);
  }, [analyser, mode]);

  return (
    <span ref={ref} className={`mic-bars ${mode}`} role="img" aria-label="Mic level">
      {SHAPE[mode].map((h, i) => (
        <span key={i} className={mode === 'meter' ? 'off' : ''} style={{ height: h }} />
      ))}
    </span>
  );
}
