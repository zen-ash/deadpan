import type { GameState, Phase, SpokenLine, Verdict } from '@deadpan/shared';
import { useEffect, useState } from 'react';

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Lobby',
  baseline: 'Calibrating',
  deal: 'The deal',
  question: 'Questioning',
  followup: 'Follow-up',
  verdict: 'Verdict',
  replay: 'Evidence',
};

interface Props {
  game: GameState;
  verdict: Verdict | null;
  /** What the detective is saying right now. */
  line: SpokenLine | null;
  /** Live transcript of the current answer. */
  transcript: string;
  serverNow(): number;
  name(id: string): string;
  onEvidence(): void;
  onPlayAgain(): void;
  onLobby(): void;
}

/** The big screen's overlay during a round: phase, subtitles, live transcript and the verdict. */
export function Interrogation({ game, verdict, line, transcript, serverNow, name, onEvidence, onPlayAgain, onLobby }: Props) {
  const turn = game.turn;
  const ticking = game.phase === 'deal' || turn?.stage === 'answering';
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [ticking, serverNow]);
  const secondsUntil = (t: number | null) => (t === null ? null : Math.max(0, Math.ceil((t - now) / 1000)));

  const subtitle = line?.text ?? (turn?.stage === 'asking' ? turn.text : null);
  const accusing = game.phase === 'verdict' && game.verdictStage !== 'deliberating' && verdict;

  return (
    <div className="stage">
      <p className="phase-banner">
        {PHASE_LABEL[game.phase]}
        {turn && turn.total > 1 && (
          <span className="muted">
            {' '}
            · {turn.index}/{turn.total}
          </span>
        )}
      </p>

      {turn && game.phase !== 'verdict' && (
        <p className="addressee">
          Detective → <b>{name(turn.playerId)}</b>
          {turn.stage === 'answering' && <span className="countdown"> · {secondsUntil(turn.answerDeadline)}s</span>}
        </p>
      )}
      {subtitle && <p className="subtitle">“{subtitle}”</p>}
      {turn?.stage === 'answering' && !line && <p className="subtitle quiet">“{turn.text}”</p>}
      {turn?.stage === 'answering' && transcript && <p className="live-transcript">{transcript}</p>}

      {game.phase === 'deal' && (
        <>
          {!line && <p className="subtitle">Secrets dealt. Hold your card to read it.</p>}
          <p className="big-countdown">{secondsUntil(game.dealEndsAt)}</p>
        </>
      )}
      {game.phase === 'verdict' && game.verdictStage === 'deliberating' && !line && (
        <p className="subtitle quiet">The detective is deliberating…</p>
      )}

      {accusing && (
        <p className="accused-line">
          <span className="muted">The detective accuses </span>
          <span className="accused-name">{name(verdict.accusedId)}</span>
        </p>
      )}

      {/* The result takes the top of the screen once the truth is out; the face stays visible. */}
      {game.phase === 'verdict' && game.verdictStage === 'revealed' && verdict && (
        <div className={`result ${verdict.correct ? 'caught' : 'missed'}`}>
          <p className="result-stamp">{verdict.correct ? 'Caught' : 'Escaped'}</p>
          <p>
            The imposter was <b>{name(verdict.imposterId)}</b>. The word was <b className="word">{verdict.word}</b>.
          </p>
          <p className="muted small">
            {verdict.source === 'gemini'
              ? `Gemini verdict${verdict.confidence !== null ? `, ${Math.round(verdict.confidence * 100)}% sure` : ''}`
              : 'Local verdict (Gemini was unavailable)'}
          </p>
          <div className="button-row">
            <button className="button primary" onClick={onEvidence}>
              Evidence board
            </button>
            <button className="button" onClick={onPlayAgain}>
              Play again
            </button>
            <button className="button" onClick={onLobby}>
              Lobby
            </button>
          </div>
        </div>
      )}

      {/* Evidence chips appear one by one along the bottom, below the suspects' cards. */}
      {accusing && game.verdictStage === 'accusing' && (
        <ul className="evidence-chips dock">
          {verdict.evidence.map((e, i) => (
            <li key={e} style={{ animationDelay: `${0.4 + i * 0.9}s` }}>
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
