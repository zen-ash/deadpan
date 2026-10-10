import { ANSWER_CAP_MS, type GameState, type PlayerInfo, type TurnInfo, type Verdict } from '@deadpan/shared';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FingerprintIcon, headline, withPeriod } from '../ui';
import { MicBars } from './MicBars';

interface Props {
  code: string;
  game: GameState;
  playerId: string | null;
  players: PlayerInfo[];
  /** undefined until dealt; null means this player is the imposter. */
  secret: string | null | undefined;
  verdict: Verdict | null;
  /** The face has been out of the camera's view for a moment. */
  faceLost: boolean;
  analyser: AnalyserNode | null;
  serverNow(): number;
  onDone(turnId: string): void;
  /** Banners about the camera, mic or connection, shown under the screen's content. */
  children?: ReactNode;
}

/** What the phone shows during a round it's playing in. */
export function GamePanel({ code, game, playerId, players, secret, verdict, faceLost, analyser, serverNow, onDone, children }: Props) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  const turn = game.turn;
  const caseNo = `No. ${code}-${game.round}`;

  let screen: ReactNode;
  if (game.phase === 'verdict') {
    if (game.verdictStage === 'revealed' && verdict) {
      screen = <Result verdict={verdict} playerId={playerId} name={name} />;
    } else if (game.verdictStage === 'accusing' && verdict) {
      screen = (
        <>
          <p className="eyebrow">Verdict · Round {game.round}</p>
          <p className="result-accused">The detective accuses</p>
          <h1 className={`result-name ${lengthClass(name(verdict.accusedId), 5, 9)}`}>{withPeriod(name(verdict.accusedId))}</h1>
        </>
      );
    } else {
      screen = (
        <>
          <p className="eyebrow">Verdict · Round {game.round}</p>
          <h1 className="phone-title waiting-title">The detective is deliberating.</h1>
          <p className="phone-sub">Keep your eyes on the big screen.</p>
        </>
      );
    }
  } else if (turn && turn.playerId === playerId) {
    screen = <MyTurn turn={turn} faceLost={faceLost} analyser={analyser} serverNow={serverNow} onDone={onDone} />;
  } else if (game.phase === 'deal') {
    screen = (
      <>
        <h1 className="phone-title">Check your secret.</h1>
        <p className="phone-sub">Don’t let anyone see it.</p>
        {secret !== undefined && <CaseFile secret={secret} caseNo={caseNo} />}
        {secret !== undefined && <p className="hold-note">Let go to hide it again.</p>}
      </>
    );
  } else {
    const [title, sub] = watching(game, turn, name);
    screen = (
      <>
        <h1 className="phone-title">{title}</h1>
        <p className="phone-sub">{sub}</p>
        {secret !== undefined && <CaseFile secret={secret} caseNo={caseNo} short />}
      </>
    );
  }

  return (
    <section className="phone-main round">
      {screen}
      {children}
    </section>
  );
}

/** Headline and line under it while someone else is on the spot, or nobody is. */
function watching(game: GameState, turn: TurnInfo | null, name: (id: string) => string): [string, string] {
  if (turn) {
    const who = name(turn.playerId);
    if (turn.kind === 'baseline') return [`${who} is calibrating.`, 'Everyone answers an easy one first.'];
    if (turn.stage === 'asking') return [`The detective asks ${who}.`, 'Watch them closely.'];
    return [`${who} is answering.`, 'Watch them closely.'];
  }
  if (game.phase === 'baseline') return ['The detective sets the scene.', 'Answer naturally when it’s your turn.'];
  return ['The detective is thinking.', 'Keep your eyes on the big screen.'];
}

/** short, long or longer, by length, so long text gets a smaller size. */
function lengthClass(text: string, long: number, longer: number): string {
  return text.length > longer ? 'longer' : text.length > long ? 'long' : '';
}

const ARC_R = 108;
const ARC = 2 * Math.PI * ARC_R;

function MyTurn({
  turn,
  faceLost,
  analyser,
  serverNow,
  onDone,
}: {
  turn: TurnInfo;
  faceLost: boolean;
  analyser: AnalyserNode | null;
  serverNow(): number;
  onDone(turnId: string): void;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (turn.stage !== 'answering') return;
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [turn.stage, serverNow]);

  // A buzz when the detective turns to you (Android; iPhones don't allow vibration from the web).
  useEffect(() => {
    navigator.vibrate?.([70, 50, 70]);
  }, [turn.id]);

  const answering = turn.stage === 'answering';
  const left = answering && turn.answerDeadline !== null ? Math.max(0, turn.answerDeadline - now) : ANSWER_CAP_MS;
  const eyebrow =
    turn.kind === 'baseline'
      ? 'Calibration · Answer naturally'
      : turn.kind === 'followup'
        ? 'Follow-up · Just you'
        : `Your turn · Question ${turn.index} of ${turn.total}`;

  return (
    <>
      <p className="eyebrow ask-eyebrow">{eyebrow}</p>
      <h1 className={`ask-question ${lengthClass(turn.text, 70, 130)}`}>“{turn.text}”</h1>
      <p className="ask-hint">{turn.stage === 'asking' ? 'Listen to the detective.' : turn.stage === 'answering' ? 'Answer out loud.' : 'Got it.'}</p>
      {faceLost && <p className="banner warn">Keep your face in the camera.</p>}
      {/* The ring takes whatever height is left under the camera and the question. */}
      <div className="done-wrap">
        <button
          className="done"
          disabled={!answering}
          onClick={() => onDone(turn.id)}
          aria-label={answering ? `Done answering. ${Math.ceil(left / 1000)} seconds left.` : 'Wait for the question to finish'}
        >
          <svg viewBox="0 0 232 232" aria-hidden>
            <defs>
              <linearGradient id="dp-arc" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f0c94f" />
                <stop offset="1" stopColor="#b8922f" />
              </linearGradient>
            </defs>
            <circle className="done-track" cx="116" cy="116" r={ARC_R} />
            {answering && (
              <circle className="done-arc" cx="116" cy="116" r={ARC_R} stroke="url(#dp-arc)" strokeDasharray={`${(ARC * left) / ANSWER_CAP_MS} ${ARC}`} />
            )}
          </svg>
          <span className="done-face">
            {answering ? (
              <>
                <span className="done-word">Done.</span>
                <span className="done-hint">Tap when you’ve answered</span>
                <span className="done-left">{Math.ceil(left / 1000)} s left</span>
              </>
            ) : turn.stage === 'asking' ? (
              <>
                <span className="done-word">Listen.</span>
                <span className="done-hint">Answer when it ends</span>
              </>
            ) : (
              <>
                <span className="done-word">Got it.</span>
                <span className="done-hint">The detective is thinking</span>
              </>
            )}
          </span>
        </button>
      </div>
      <p className="listening">
        <MicBars analyser={analyser} mode="wave" />
        <span>The detective is listening</span>
      </p>
    </>
  );
}

/** The secret word (or the imposter's role), readable only while it's pressed and held. */
function CaseFile({ secret, caseNo, short = false }: { secret: string | null; caseNo: string; short?: boolean }) {
  const [shown, setShown] = useState(false);
  const hide = () => setShown(false);
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    setShown(down);
  };
  return (
    <div className={`casefile ${short ? 'short' : ''}`}>
      <span className="casefile-tab">Case file</span>
      <button
        className={`casefile-body ${shown ? 'open' : ''}`}
        aria-label={shown ? 'Your secret is showing. Let go to hide it.' : 'Press and hold to read your secret'}
        onPointerDown={() => setShown(true)}
        onPointerUp={hide}
        onPointerLeave={hide}
        onPointerCancel={hide}
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={hide}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="casefile-top">
          <span className="stamp-mini">Top secret</span>
          <span className="casefile-no">{caseNo}</span>
        </span>
        {!shown && (
          <span className="casefile-content">
            <FingerprintIcon />
            <span className="casefile-hint">Press and hold to read</span>
          </span>
        )}
        {shown && secret === null && (
          <span className="casefile-content">
            <span className="casefile-kicker">Your role</span>
            <span className="casefile-role">You’re the imposter.</span>
            <span className="casefile-small">You don’t get the word. Listen to the others, then bluff.</span>
          </span>
        )}
        {shown && secret !== null && (
          <span className="casefile-content">
            <span className="casefile-kicker">The word</span>
            <span className={`casefile-word ${lengthClass(secret, 6, 9)}`}>{headline(secret)}</span>
            <span className="casefile-small">Keep it to yourself.</span>
          </span>
        )}
      </button>
    </div>
  );
}

function Result({ verdict, playerId, name }: { verdict: Verdict; playerId: string | null; name(id: string): string }) {
  const accused = name(verdict.accusedId);
  const imposter = name(verdict.imposterId);
  const wasImposter = playerId === verdict.imposterId;
  const wasAccused = playerId === verdict.accusedId;
  const personal = wasImposter
    ? verdict.correct
      ? 'You got caught.'
      : 'You fooled the detective.'
    : wasAccused
      ? 'You were framed.'
      : verdict.correct
        ? 'Case closed.'
        : 'The imposter got away.';
  return (
    <>
      <p className="eyebrow">Verdict · Round {verdict.round}</p>
      <p className="result-accused">The detective accused</p>
      <h1 className={`result-name ${lengthClass(accused, 5, 9)}`}>{withPeriod(accused)}</h1>
      <span className={`stamp ${verdict.correct ? '' : 'cleared'}`}>{verdict.correct ? 'Caught' : 'Innocent'}</span>
      <p className="result-line">
        The imposter was {imposter}. The word was {verdict.word}.
      </p>
      <div className="result-card">
        <p className="display">{personal}</p>
        <p>The evidence is on the big screen.</p>
      </div>
    </>
  );
}
