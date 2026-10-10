import type { AnswerResult, PlayerInfo } from '@deadpan/shared';
import { Canvas } from '@react-three/fiber';
import { FaceMesh } from './FaceMesh';
import { useLivePlayer } from './live';

interface BarProps {
  label: string;
  value: number | null;
  max: number;
  min?: number;
  format: (v: number) => string;
  myth?: boolean;
}

function Bar({ label, value, max, min = 0, format, myth }: BarProps) {
  const fill = value === null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  return (
    <div className={`bar ${myth ? 'myth' : ''}`}>
      <span className="bar-label">
        {label}
        {myth && <span className="myth-tag">MYTH</span>}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ transform: `scaleX(${fill})` }} />
      </span>
      <span className="bar-value">{value === null ? '–' : format(value)}</span>
    </div>
  );
}

const db = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -100);

interface CardProps {
  player: PlayerInfo;
  /** Being questioned right now. */
  active?: boolean;
  /** Joined mid-round; plays in the next one. */
  benched?: boolean;
  lastAnswer?: AnswerResult;
  badge?: 'accused' | 'imposter';
}

/** One player on the big screen: their live neon face mesh and signal bars. */
export function SuspectCard({ player, active, benched, lastAnswer, badge }: CardProps) {
  const p = useLivePlayer(player.id);
  const f = p.features;
  const speaking = p.speaking || !!f?.voice.vad;

  return (
    <article className={`suspect-card ${speaking ? 'speaking' : ''} ${active ? 'active' : ''} ${benched ? 'benched' : ''}`}>
      {badge && <span className={`card-badge ${badge}`}>{badge === 'accused' ? 'Accused' : 'Imposter'}</span>}
      <div className="mesh-view">
        <Canvas camera={{ position: [0, 0, 1.6], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
          <FaceMesh id={player.id} />
        </Canvas>
        {(p.stale || !f?.face.present) && <span className="mesh-note">{p.stale ? 'no signal' : 'no face'}</span>}
      </div>
      <header className="suspect-head">
        <span className={`dot ${player.cam && player.mic && !p.stale ? 'ok' : 'bad'}`} />
        <span className="suspect-name">{player.name}</span>
        {speaking && <span className="talking">speaking</span>}
        <span className="muted small">{f ? `${f.fps.toFixed(0)} fps` : ''}</span>
      </header>
      <div className="bars">
        <Bar label="Blinks" value={f?.face.blinkPm ?? null} max={40} format={(v) => `${v.toFixed(0)}/min`} />
        <Bar label="Lip press" value={f?.face.lipPress ?? null} max={0.5} format={(v) => v.toFixed(2)} />
        <Bar label="Brow" value={f?.face.brow ?? null} max={0.6} format={(v) => v.toFixed(2)} />
        <Bar label="Head motion" value={f?.face.headMotion ?? null} max={60} format={(v) => v.toFixed(0)} />
        <Bar label="Pitch" value={p.pitchHz} min={70} max={300} format={(v) => `${v.toFixed(0)} Hz`} />
        <Bar label="Voice" value={f ? db(f.voice.rms) : null} min={-60} max={-10} format={(v) => `${v.toFixed(0)} dB`} />
        <Bar label="Gaze" value={f?.face.gazeOff ?? null} max={1} format={(v) => v.toFixed(2)} myth />
      </div>
      {lastAnswer && <LastAnswer answer={lastAnswer} />}
    </article>
  );
}

/** The latest answer's measurements, against this player's own baseline. */
function LastAnswer({ answer }: { answer: AnswerResult }) {
  const m = answer.metrics;
  const parts = [
    m.rtMs === null ? 'no answer heard' : `RT ${(m.rtMs / 1000).toFixed(1)} s`,
    m.pitchShiftSt !== null && `pitch ${m.pitchShiftSt >= 0 ? '+' : ''}${m.pitchShiftSt.toFixed(1)} st`,
    m.fillers !== null && `${m.fillers} filler${m.fillers === 1 ? '' : 's'}`,
    m.pauseCount !== null && `${m.pauseCount} pause${m.pauseCount === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return (
    <div className="last-answer">
      <span className="last-answer-label">{answer.kind === 'baseline' ? 'Baseline' : 'Last answer'}</span>
      <span>{parts.join(' · ')}</span>
      {answer.delivery !== null && (
        <span className={`delivery ${answer.delivery > 0.5 ? 'hot' : ''}`}>
          drift {answer.delivery >= 0 ? '+' : ''}
          {answer.delivery.toFixed(2)}
        </span>
      )}
      {m.transcript && <span className="last-transcript">“{m.transcript}”</span>}
    </div>
  );
}
