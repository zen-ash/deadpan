import type { GameState, PlayerInfo, TurnInfo, Verdict } from '@deadpan/shared';
import { useEffect, useState } from 'react';

interface Props {
  game: GameState | null;
  playerId: string | null;
  players: PlayerInfo[];
  /** undefined until dealt; null means this player is the imposter. */
  secret: string | null | undefined;
  verdict: Verdict | null;
  serverNow(): number;
  onDone(turnId: string): void;
}

/** What the phone shows during a round. */
export function GamePanel({ game, playerId, players, secret, verdict, serverNow, onDone }: Props) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';

  if (!game || game.phase === 'lobby') {
    return <p className="muted">Waiting for the host to start the round. Look at the big screen.</p>;
  }
  if (game.phase === 'verdict' && verdict) return <VerdictCard verdict={verdict} playerId={playerId} name={name} />;
  if (!playerId || !game.roundPlayers.includes(playerId)) {
    return <p className="muted">A round is in progress. You'll play in the next one.</p>;
  }

  const turn = game.turn;
  const mine = turn?.playerId === playerId;
  return (
    <div className="game">
      {turn && mine && <MyTurn turn={turn} serverNow={serverNow} onDone={onDone} />}
      {turn && !mine && (
        <p className="phase-note">
          {turn.kind === 'baseline' ? 'Calibrating ' : 'Questioning '}
          <b>{name(turn.playerId)}</b>
          {turn.kind === 'baseline' ? '. Stay relaxed.' : '. Watch them closely.'}
        </p>
      )}
      {game.phase === 'deal' && <p className="phase-note">Check your secret. Don't let anyone see it.</p>}
      {secret !== undefined && <SecretCard secret={secret} />}
    </div>
  );
}

function MyTurn({ turn, serverNow, onDone }: { turn: TurnInfo; serverNow(): number; onDone(turnId: string): void }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (turn.stage !== 'answering') return;
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [turn.stage, serverNow]);

  const left = turn.answerDeadline !== null ? Math.max(0, Math.ceil((turn.answerDeadline - now) / 1000)) : null;
  return (
    <div className={`my-turn ${turn.stage}`}>
      <p className="turn-label">{turn.kind === 'baseline' ? 'Calibration: answer naturally' : 'Your turn'}</p>
      <p className="turn-question">“{turn.text}”</p>
      {turn.stage === 'asking' && <p className="muted">Listen to the detective…</p>}
      {turn.stage === 'answering' && (
        <>
          <p className="answer-hint">
            Answer out loud{left !== null && <span className="countdown"> · {left}s</span>}
          </p>
          <button className="button primary huge" onClick={() => onDone(turn.id)}>
            Tap when done
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
      {!shown && <span className="secret-hint">Hold to see your secret</span>}
      {shown && secret === null && (
        <>
          <span className="secret-label">You are the</span>
          <strong>IMPOSTER</strong>
          <span className="secret-label">Blend in. Don't get caught.</span>
        </>
      )}
      {shown && secret !== null && (
        <>
          <span className="secret-label">The secret word is</span>
          <strong>{secret.toUpperCase()}</strong>
        </>
      )}
    </button>
  );
}

function VerdictCard({ verdict, playerId, name }: { verdict: Verdict; playerId: string | null; name(id: string): string }) {
  const wasImposter = playerId === verdict.imposterId;
  return (
    <div className={`verdict-card ${verdict.correct ? 'caught' : 'missed'}`}>
      <p className="muted">The detective accuses</p>
      <strong className="accused">{name(verdict.accusedId)}</strong>
      <p>
        {verdict.correct ? 'Caught. ' : 'Wrong. '}The imposter was <b>{name(verdict.imposterId)}</b> and the word was{' '}
        <b>{verdict.word}</b>.
      </p>
      {wasImposter && <p className="verdict-you">{verdict.correct ? 'You got caught.' : 'You fooled the detective!'}</p>}
    </div>
  );
}
