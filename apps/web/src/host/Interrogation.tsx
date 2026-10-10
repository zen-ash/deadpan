import type { GameState, Phase, Verdict } from '@deadpan/shared';
import { useEffect, useState } from 'react';

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Lobby',
  baseline: 'Calibration',
  deal: 'The deal',
  question: 'Questioning',
  followup: 'Follow-up',
  verdict: 'Verdict',
  replay: 'Replay',
};

interface Props {
  game: GameState;
  verdict: Verdict | null;
  /** Live transcript of the current answer. */
  transcript: string;
  serverNow(): number;
  name(id: string): string;
  onPlayAgain(): void;
  onEnd(): void;
}

/** The big screen's left column during a round: what the detective is doing right now. */
export function Interrogation({ game, verdict, transcript, serverNow, name, onPlayAgain, onEnd }: Props) {
  const turn = game.turn;
  const ticking = game.phase === 'deal' || turn?.stage === 'answering';
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [ticking, serverNow]);
  const secondsUntil = (t: number | null) => (t === null ? null : Math.max(0, Math.ceil((t - now) / 1000)));

  if (game.phase === 'verdict') {
    if (!verdict) return <p className="phase-banner">Deliberating…</p>;
    return <VerdictPanel verdict={verdict} name={name} onPlayAgain={onPlayAgain} onEnd={onEnd} />;
  }

  return (
    <div className="interrogation">
      <p className="phase-banner">
        {PHASE_LABEL[game.phase]}
        {turn && turn.total > 1 && ` · ${turn.index}/${turn.total}`}
      </p>
      {game.phase === 'deal' && (
        <>
          <p className="subtitle">Secrets dealt. Hold your card to read it. One of you doesn't know the word.</p>
          <p className="big-countdown">{secondsUntil(game.dealEndsAt)}</p>
        </>
      )}
      {turn && (
        <>
          <p className="addressee">
            Detective → <b>{name(turn.playerId)}</b>
          </p>
          <p className="subtitle">“{turn.text}”</p>
          <p className={`turn-stage ${turn.stage}`}>
            {turn.stage === 'asking' && 'asking…'}
            {turn.stage === 'answering' && `answering · ${secondsUntil(turn.answerDeadline)}s`}
            {turn.stage === 'scoring' && 'noted.'}
          </p>
          {transcript && <p className="live-transcript">{transcript}</p>}
        </>
      )}
      <button className="button" onClick={onEnd}>
        End round
      </button>
    </div>
  );
}

function VerdictPanel({ verdict, name, onPlayAgain, onEnd }: { verdict: Verdict; name(id: string): string; onPlayAgain(): void; onEnd(): void }) {
  const fmt = (v: number | null, digits = 2) => (v === null ? '–' : v.toFixed(digits));
  return (
    <div className="verdict">
      <p className="phase-banner">Verdict</p>
      <p className="muted">The detective accuses</p>
      <p className="accused-name">{name(verdict.accusedId)}</p>
      <p className={`verdict-result ${verdict.correct ? 'caught' : 'missed'}`}>
        {verdict.correct ? 'Caught.' : 'Wrong.'} The imposter was <b>{name(verdict.imposterId)}</b>.
      </p>
      <p className="muted">
        The word was <b className="word">{verdict.word}</b>
      </p>
      <ul className="evidence">
        {verdict.evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <table className="scores">
        <thead>
          <tr>
            <th>Suspect</th>
            <th>Delivery</th>
            <th>Content</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {[...verdict.scores]
            .sort((a, b) => b.combined - a.combined)
            .map((s) => (
              <tr key={s.playerId} className={s.playerId === verdict.accusedId ? 'top' : ''}>
                <td>{name(s.playerId)}</td>
                <td>{fmt(s.delivery)}</td>
                <td>{fmt(s.content)}</td>
                <td>{fmt(s.combined)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="muted small">Local verdict (the AI detective arrives in M3).</p>
      <div className="button-row">
        <button className="button primary" onClick={onPlayAgain}>
          Play again
        </button>
        <button className="button" onClick={onEnd}>
          Lobby
        </button>
      </div>
    </div>
  );
}
