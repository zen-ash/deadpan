import type { AnswerResult, PlayerInfo } from '@deadpan/shared';
import { HeartIcon, pulseText, SPIKE } from '../ui';
import type { CardVariant } from './layout';
import { faceLostRecently, useLivePlayer, type LivePlayer } from './live';

const MYTH_TIP = 'Looking away is not a reliable sign of lying. Shown for fun, not used in the verdict.';

/** Where the round is, which decides what the card's corner and sub-line say. */
export type CardMoment = 'lobby' | 'calibrating' | 'questioning' | 'verdict' | 'revealed';

interface CardProps {
  player: PlayerInfo;
  /** lobby: name and pulse; full: every signal; compact: the key ones, for 5–6 players. */
  variant: CardVariant;
  moment: CardMoment;
  /** Latest drift during the round, the round's mean once revealed. */
  drift: number | null;
  lastAnswer?: AnswerResult;
  active?: boolean;
  benched?: boolean;
  role?: 'imposter' | 'innocent';
  stamp?: 'caught' | 'accused' | 'escaped';
}

/** "+1.2" or "−0.4", with a real minus sign. */
function signed(v: number, digits = 1): string {
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;
}

/** A z-score as a bar: 0 is calm, 3 is far off. */
const zFill = (z: number | null | undefined) => (z === null || z === undefined ? null : Math.max(0, z) / 3);
const isHot = (z: number | null | undefined) => (z ?? 0) > SPIKE;

interface RowProps {
  label: string;
  /** How full the bar is, 0–1. */
  fill: number | null;
  value: string | null;
  hot?: boolean;
  myth?: boolean;
}

function Row({ label, fill, value, hot, myth }: RowProps) {
  return (
    <div className={`row ${myth ? 'myth' : ''} ${hot ? 'hot' : ''}`}>
      <span className="row-label">
        {label}
        {myth && (
          <span className="myth-tag" title={MYTH_TIP}>
            Myth
          </span>
        )}
      </span>
      <span className="row-track">
        <span className="row-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, fill ?? 0))})` }} />
      </span>
      <span className={`row-value ${value === null ? 'empty' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

function Status({ player, live, moment, active, benched, drift }: Pick<CardProps, 'player' | 'moment' | 'active' | 'benched' | 'drift'> & { live: LivePlayer }) {
  if (moment === 'revealed' && !benched) {
    return (
      <span className="suspect-status drift" title="How far their answers drifted from their own calm baseline">
        <span className="drift-label">Drift</span>
        <span className={`drift-value ${isHot(drift) ? 'hot' : ''}`}>{drift === null ? '—' : signed(drift)}</span>
      </span>
    );
  }
  let tone = '';
  let text: string;
  if (live.stale) [tone, text] = ['bad', 'No signal'];
  else if (!player.cam || !player.mic) [tone, text] = ['warn', 'Check phone'];
  else if (moment === 'lobby') text = 'Ready';
  else if (!live.features?.face.present) [tone, text] = ['warn', 'Face lost'];
  else if (benched) [tone, text] = ['idle', 'Next round'];
  else if (active && moment === 'verdict') [tone, text] = ['bad', 'Accused'];
  else if (active) [tone, text] = ['answering', 'Answering'];
  else text = 'Listening';
  return (
    <span className={`suspect-status ${tone}`}>
      <span className="dot" />
      {text}
    </span>
  );
}

/** One suspect's card next to their face on the big screen. */
export function SuspectCard({ player, variant, moment, drift, lastAnswer, active, benched, role, stamp }: CardProps) {
  const p = useLivePlayer(player.id);
  const f = p.features;
  const m = lastAnswer?.metrics;
  const z = lastAnswer?.z;
  const over = moment === 'verdict' || moment === 'revealed';
  const bpm = p.stale ? null : (f?.hr.bpm ?? null);

  const rt = m?.rtMs != null ? `${(m.rtMs / 1000).toFixed(1)} s` : null;
  const pitch = m?.pitchShiftSt != null ? `${signed(m.pitchShiftSt)} st` : null;
  const fillers = m?.fillers != null ? String(m.fillers) : null;
  const blinks = f ? Math.round(f.face.blinkPm) : null;
  const lips = f ? f.face.lipPress.toFixed(2) : null;
  const gaze = f ? f.face.gazeOff.toFixed(2) : null;

  const head = (
    <header className="suspect-head">
      <span className="suspect-name">{player.name}</span>
      <Status player={player} live={p} moment={moment} active={active} benched={benched} drift={drift} />
    </header>
  );
  const foot = (
    <footer className="suspect-foot">
      <span className="pulse">
        <HeartIcon bpm={bpm} size={variant === 'lobby' ? 16 : 15} />
        {pulseText(bpm, f?.hr.quality ?? 0, p.stale, over)}
      </span>
      {variant !== 'lobby' && faceLostRecently(p) && <span className="foot-note">Face lost at times</span>}
    </footer>
  );
  const sub =
    moment === 'revealed' && role ? (
      <p className={`suspect-sub ${role}`}>{role === 'imposter' ? 'The imposter' : 'Innocent'}</p>
    ) : moment === 'calibrating' ? (
      <p className="suspect-sub">Calibrating</p>
    ) : (
      <p className="suspect-sub">
        {drift !== null && (
          <>
            Drift <span className={isHot(drift) ? 'hot' : ''}>{signed(drift)}</span>
          </>
        )}
      </p>
    );

  return (
    <article className={`suspect-card ${variant} ${active ? 'active' : ''} ${stamp ? 'accused' : ''}`}>
      {stamp && <span className={`card-stamp ${stamp}`}>{stamp === 'caught' ? 'Caught' : stamp === 'accused' ? 'Accused' : 'Escaped'}</span>}
      {head}

      {variant === 'full' && (
        <>
          {sub}
          <div className="rows">
            <Row label="Response" fill={zFill(z?.rt)} value={rt} hot={isHot(z?.rt)} />
            <Row label="Pitch" fill={zFill(z?.pitch)} value={pitch} hot={isHot(z?.pitch)} />
            <Row label="Fillers" fill={zFill(z?.fillers)} value={fillers} hot={isHot(z?.fillers)} />
            <Row label="Blinks" fill={f ? f.face.blinkPm / 40 : null} value={blinks === null ? null : `${blinks}/min`} />
            <Row label="Lip press" fill={f ? f.face.lipPress / 0.5 : null} value={lips} />
            <Row label="Gaze" fill={f?.face.gazeOff ?? null} value={gaze} myth />
          </div>
          {foot}
        </>
      )}

      {variant === 'compact' && (
        <>
          {sub}
          <div className="tiles">
            <Tile label="Response" value={rt} hot={isHot(z?.rt)} />
            <Tile label="Pitch st" value={m?.pitchShiftSt != null ? signed(m.pitchShiftSt) : null} hot={isHot(z?.pitch)} />
            <Tile label="Fillers" value={fillers} hot={isHot(z?.fillers)} />
          </div>
          <div className="mini">
            <span>
              Blinks <b className={blinks === null ? 'empty' : ''}>{blinks ?? '—'}</b>
            </span>
            <span>
              Lips <b className={lips === null ? 'empty' : ''}>{lips ?? '—'}</b>
            </span>
            <span className="myth">
              Gaze <b className={gaze === null ? 'empty' : ''}>{gaze ?? '—'}</b>
              <span className="myth-tag" title={MYTH_TIP}>
                Myth
              </span>
            </span>
          </div>
          {foot}
        </>
      )}

      {variant === 'lobby' && foot}
    </article>
  );
}

function Tile({ label, value, hot }: { label: string; value: string | null; hot: boolean }) {
  return (
    <span className={`tile ${hot ? 'hot' : ''}`}>
      <b className={value === null ? 'empty' : ''}>{value ?? '—'}</b>
      <span>{label}</span>
    </span>
  );
}
