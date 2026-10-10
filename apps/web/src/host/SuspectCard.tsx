import type { AnswerResult, PlayerInfo } from '@deadpan/shared';
import type { CardVariant } from './layout';
import { useLivePlayer } from './live';
import { driftCss } from './theme';

interface BarProps {
  label: string;
  /** How full the bar is, 0–1. */
  fill: number | null;
  value: string;
  hot?: boolean;
  myth?: boolean;
}

function Bar({ label, fill, value, hot, myth }: BarProps) {
  return (
    <div className={`bar ${myth ? 'myth' : ''} ${hot ? 'hot' : ''}`}>
      <span className="bar-label">
        {label}
        {myth && <span className="myth-tag">MYTH</span>}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, fill ?? 0))})` }} />
      </span>
      <span className="bar-value">{value}</span>
    </div>
  );
}

/** A z-score as a bar: 0 is calm, 3 is far off. */
const zFill = (z: number | null | undefined) => (z === null || z === undefined ? null : Math.max(0, z) / 3);

function Heart({ bpm, quality }: { bpm: number | null; quality: number }) {
  const grade = bpm === null ? 'none' : quality >= 0.45 ? 'good' : 'fair';
  return (
    <span className={`heart ${grade}`} title="Camera heart rate (for show; never used as evidence)">
      <svg viewBox="0 0 24 24" aria-hidden style={bpm ? { animationDuration: `${60 / bpm}s` } : undefined}>
        <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z" />
      </svg>
      <span>{bpm === null ? '––' : Math.round(bpm)}</span>
      <span className="quality">{grade === 'none' ? 'no signal' : `Q ${quality.toFixed(2)}`}</span>
    </span>
  );
}

interface CardProps {
  player: PlayerInfo;
  /** lobby: name only; full: every signal; compact: the key ones, for 5–6 players. */
  variant: CardVariant;
  /** Drift of the latest answer, which also colours the face. */
  drift: number | null;
  lastAnswer?: AnswerResult;
  active?: boolean;
  benched?: boolean;
  badge?: 'accused' | 'imposter' | 'both';
}

/** One suspect's card next to their face on the big screen. */
export function SuspectCard({ player, variant, drift, lastAnswer, active, benched, badge }: CardProps) {
  const p = useLivePlayer(player.id);
  const f = p.features;
  const m = lastAnswer?.metrics;
  const z = lastAnswer?.z;
  const speaking = p.speaking || !!f?.voice.vad;
  const healthy = player.cam && player.mic && !p.stale;
  const heart = <Heart bpm={f?.hr.bpm ?? null} quality={f?.hr.quality ?? 0} />;
  const rt = m?.rtMs != null ? `${(m.rtMs / 1000).toFixed(1)}s` : '–';
  const pitch = m?.pitchShiftSt != null ? `${m.pitchShiftSt >= 0 ? '+' : ''}${m.pitchShiftSt.toFixed(1)}` : '–';
  const fillers = m?.fillers != null ? String(m.fillers) : '–';
  const status = p.stale ? <span className="muted">no signal</span> : !f?.face.present ? <span className="warn-text">no face</span> : null;

  return (
    <article className={`suspect-card ${variant} ${active ? 'active' : ''} ${speaking ? 'speaking' : ''} ${benched ? 'benched' : ''}`}>
      {badge && (
        <span className={`card-badge ${badge}`}>{badge === 'both' ? 'Caught' : badge === 'accused' ? 'Accused' : 'Imposter'}</span>
      )}
      <header className="suspect-head">
        <span className={`dot ${healthy ? 'ok' : 'bad'}`} />
        <span className="suspect-name">{player.name}</span>
        {variant !== 'lobby' && drift !== null && (
          <span className="drift" style={{ color: driftCss(drift) }}>
            {drift >= 0 ? '+' : ''}
            {drift.toFixed(1)}
          </span>
        )}
      </header>

      {variant === 'full' && (
        <>
          <div className="bars">
            <Bar label="Response" fill={zFill(z?.rt)} value={rt} hot={(z?.rt ?? 0) > 1} />
            <Bar label="Pitch" fill={zFill(z?.pitch)} value={pitch === '–' ? pitch : `${pitch}st`} hot={(z?.pitch ?? 0) > 1} />
            <Bar label="Fillers" fill={zFill(z?.fillers)} value={fillers} hot={(z?.fillers ?? 0) > 1} />
            <Bar label="Blinks" fill={f ? f.face.blinkPm / 40 : null} value={f ? `${Math.round(f.face.blinkPm)}/m` : '–'} />
            <Bar label="Lip press" fill={f ? f.face.lipPress / 0.5 : null} value={f ? f.face.lipPress.toFixed(2) : '–'} />
            <Bar label="Gaze" fill={f?.face.gazeOff ?? null} value={f ? f.face.gazeOff.toFixed(2) : '–'} myth />
          </div>
          <footer className="suspect-foot">
            {heart}
            {status}
          </footer>
        </>
      )}

      {variant === 'compact' && (
        <>
          <div className="tiles">
            <Tile label="Response" value={rt} hot={(z?.rt ?? 0) > 1} />
            <Tile label="Pitch st" value={pitch} hot={(z?.pitch ?? 0) > 1} />
            <Tile label="Fillers" value={fillers} hot={(z?.fillers ?? 0) > 1} />
          </div>
          <div className="mini-row">
            <span>
              Blinks <b>{f ? Math.round(f.face.blinkPm) : '–'}</b>
            </span>
            <span>
              Lips <b>{f ? f.face.lipPress.toFixed(2) : '–'}</b>
            </span>
            <span className="myth">
              Gaze <b>{f ? f.face.gazeOff.toFixed(2) : '–'}</b> <span className="myth-tag">MYTH</span>
            </span>
          </div>
          <footer className="suspect-foot">
            {heart}
            {status}
          </footer>
        </>
      )}

      {variant === 'lobby' && (
        <footer className="suspect-foot">
          {heart}
          {status}
        </footer>
      )}
    </article>
  );
}

function Tile({ label, value, hot }: { label: string; value: string; hot: boolean }) {
  return (
    <span className={`tile ${hot ? 'hot' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}
