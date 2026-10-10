import { useEffect, useState } from 'react';
import type { PhoneSignals } from './signals';

const db = (rms: number) => (rms > 0 ? `${(20 * Math.log10(rms)).toFixed(0)} dB` : '–');
const n = (v: number, digits = 2) => v.toFixed(digits);

/** Live readout of what the phone is measuring, drawn over the camera preview. */
export function DebugOverlay({ signals, scribe }: { signals: PhoneSignals; scribe: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const { face, voice } = signals;
  const f = face?.face;
  const s = face?.stats;

  return (
    <div className="debug" aria-hidden>
      <div>
        <b>face</b>{' '}
        {face && s
          ? `${n(s.fps, 1)} fps · ${n(s.inferMs, 0)} ms · ${s.delegate}${s.errors ? ` · ${s.errors} errors` : ''}`
          : signals.faceError
            ? `failed: ${signals.faceError}`
            : 'loading…'}
      </div>
      {f && s && (
        <>
          <div className={f.present ? '' : 'warn'}>
            <b>seen</b> {f.present ? 'yes' : 'NO FACE'} <b>blink</b> {n(f.blinkPm, 1)}/min{' '}
            <span className="dim">
              (score {n(s.blinkScore)} ear {n(s.ear)})
            </span>
          </div>
          <div>
            <b>lip</b> {n(f.lipPress)} <b>brow</b> {n(f.brow)} <b>head</b> {n(f.headMotion, 1)}
          </div>
          <div>
            <b>gaze</b> {n(f.gazeOff)} <span className="dim">(MYTH)</span> <b>jaw</b> {n(s.jawOpen)}{' '}
            <b>talk</b> {f.speaking ? 'yes' : 'no'}
          </div>
        </>
      )}
      <div>
        <b>pitch</b> {voice.lastPitchHz ? `${voice.lastPitchHz.toFixed(0)} Hz` : '–'}{' '}
        <span className="dim">clarity {n(voice.lastClarity)}</span>
      </div>
      <div>
        <b>level</b> {db(voice.rms)} <b>floor</b> {db(voice.noiseFloor)}
      </div>
      <div>
        <b>vad</b> {voice.vadMode} · {voice.speaking ? <span className="hot">SPEAKING</span> : 'quiet'}
        {voice.vadNote && <span className="dim"> ({voice.vadNote})</span>}
      </div>
      <div>
        <b>net</b> {n(signals.packetsPerSecond, 1)} packets/s <b>scribe</b> {scribe}
      </div>
    </div>
  );
}
