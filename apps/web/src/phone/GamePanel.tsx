import { ANSWER_CAP_MS, type GameState, type PlayerInfo, type TurnInfo, type Verdict } from '@deadpan/shared';
import { useEffect, useState } from 'react';

interface Props {
  game: GameState | null;
  playerId: string | null;
  players: PlayerInfo[];
  /** undefined until dealt; null means this player is the imposter. */
  secret: string | null | undefined;
  verdict: Verdict | null;
  /** The face has been out of the camera's view for a moment. */
  faceLost: boolean;
  serverNow(): number;
  onDone(turnId: string): void;
}

/** What the phone shows during a round. */
export function GamePanel({ game, playerId, players, secret, verdict, faceLost, serverNow, onDone }: Props) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';

  if (!game || game.phase === 'lobby') {
    return <p className="muted">Waiting for the host to start the round. Look at the big screen.</p>;
  }
  if (game.phase === 'verdict') {
    if (game.verdictStage === 'revealed' && verdict) return <VerdictCard verdict={verdict} playerId={playerId} name={name} />;
    if (game.verdictStage === 'accusing' && verdict) {
      return (
        <div className="verdict-card">
          <p className="muted">The detective accuses</p>
          <strong className="accused">{name(verdict.accusedId)}</strong>
        </div>
      );
    }
    return <p className="phase-note center">The detective is deliberating…</p>;
  }
  if (!playerId || !game.roundPlayers.includes(playerId)) {
    return <p className="muted">A round is in progress. You'll play in the next one.</p>;
  }

  const turn = game.turn;
  const mine = turn?.playerId === playerId;
  return (
    <div className="game">
      {turn && mine && <MyTurn turn={turn} faceLost={faceLost} serverNow={serverNow} onDone={onDone} />}
      {turn && !mine && (
        <p className="phase-note">
          {turn.kind === 'baseline' ? 'Calibrating ' : 'Questioning '}
          <b>{name(turn.playerId)}</b>
          {turn.kind === 'baseline' ? '. Stay relaxed.' : '. Watch them closely.'}
        </p>
      )}
      {!turn && game.phase === 'baseline' && <p className="phase-note">The detective is setting the scene. Answer naturally when it's your turn.</p>}
      {!turn && (game.phase === 'question' || game.phase === 'followup') && <p className="phase-note">The detective is thinking…</p>}
      {game.phase === 'deal' && <p className="phase-note">Check your secret. Don't let anyone see it.</p>}
      {secret !== undefined && <SecretCard secret={secret} />}
    </div>
  );
}

function MyTurn({ turn, faceLost, serverNow, onDone }: { turn: TurnInfo; faceLost: boolean; serverNow(): number; onDone(turnId: string): void }) {
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

  const left = turn.answerDeadline !== null ? Math.max(0, turn.answerDeadline - now) : ANSWER_CAP_MS;
  const ring = 2 * Math.PI * 54;
  return (
    <div className={`my-turn ${turn.stage}`}>
      <p className="turn-label">{turn.kind === 'baseline' ? 'Calibration · answer naturally' : 'Your turn'}</p>
      <p className="turn-question">“{turn.text}”</p>
      {faceLost && <p className="banner warn">Keep your face in the camera.</p>}
      {turn.stage === 'asking' && <p className="muted">Listen to the detective…</p>}
      {turn.stage === 'answering' && (
        <>
          <p className="answer-hint">Answer out loud</p>
          <button className="done-button" onClick={() => onDone(turn.id)}>
            <svg viewBox="0 0 120 120" aria-hidden>
              <circle className="done-track" cx="60" cy="60" r="54" />
              <circle
                className="done-progress"
                cx="60"
                cy="60"
                r="54"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - left / ANSWER_CAP_MS)}
              />
            </svg>
            <span className="done-label">
              Tap when
              <br />
              done
              <small>{Math.ceil(left / 1000)}s</small>
            </span>
          </button>
        </>
      )}
      {turn.stage === 'scoring' && <p className="muted">Got it.</p>}
    </div>
  );
}

/** The secret word (or the imposter card), visible only while it's pressed and held. */
function SecretCard({ secret }: { secret: string | null }) {
  const [shown, setShown] = useState(false);
  const hide = () => setShown(false);
  return (
    <button
      className={`secret ${shown ? 'shown' : ''} ${shown && secret === null ? 'imposter' : ''}`}
      onPointerDown={() => setShown(true)}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="secret-tab">Case file · top secret</span>
      {!shown && (
        <span className="secret-hint">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3a7 7 0 0 0-7 7v3M19 13v-3a7 7 0 0 0-11.2-5.6M9 21v-8a3 3 0 0 1 6 0v8M12 11v10M6 17v-2M18 18v-5" />
          </svg>
          Press and hold to read
        </span>
      )}
      {shown && secret === null && (
        <>
          <strong className="stamp">Imposter</strong>
          <span className="secret-label">You don't know the word. Blend in. Don't get caught.</span>
        </>
      )}
      {shown && secret !== null && (
        <>
          <span className="secret-label">The secret word is</span>
          <strong className="secret-word">{secret.toUpperCase()}</strong>
          <span className="secret-label">Describe it without saying it.</span>
        </>
      )}
    </button>
  );
}

function VerdictCard({ verdict, playerId, name }: { verdict: Verdict; playerId: string | null; name(id: string): string }) {
  const wasImposter = playerId === verdict.imposterId;
  return (
    <div className={`verdict-card ${verdict.correct ? 'caught' : 'missed'}`}>
      <p className="muted">The detective accused</p>
      <strong className="accused">{name(verdict.accusedId)}</strong>
      <span className="stamp small">{verdict.correct ? 'Caught' : 'Escaped'}</span>
      <p>
        The imposter was <b>{name(verdict.imposterId)}</b> and the word was <b>{verdict.word}</b>.
      </p>
      {wasImposter && <p className="verdict-you">{verdict.correct ? 'You got caught.' : 'You fooled the detective!'}</p>}
    </div>
  );
}
