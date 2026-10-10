import type { GameState, Phase, SpokenLine, Verdict } from '@deadpan/shared';
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
  /** What the detective is saying right now. */
  line: SpokenLine | null;
  /** Live transcript of the current answer. */
  transcript: string;
  serverNow(): number;
  name(id: string): string;
  onPlayAgain(): void;
  onEnd(): void;
}

/** The big screen's left column during a round: what the detective is doing right now. */
export function Interrogation({ game, verdict, line, transcript, serverNow, name, onPlayAgain, onEnd }: Props) {
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
    if (game.verdictStage === 'deliberating' || !verdict) {
      return (
        <div className="interrogation">
          <p className="phase-banner">Verdict</p>
          {line ? <p className="subtitle">“{line.text}”</p> : <p className="subtitle muted">The detective is deliberating…</p>}
        </div>
      );
    }
    return (
      <VerdictPanel
        verdict={verdict}
        revealed={game.verdictStage === 'revealed'}
        line={line}
        name={name}
        onPlayAgain={onPlayAgain}
        onEnd={onEnd}
      />
    );
  }

  return (
    <div className="interrogation">
      <p className="phase-banner">
        {PHASE_LABEL[game.phase]}
        {turn && turn.total > 1 && ` · ${turn.index}/${turn.total}`}
      </p>
      {game.phase === 'deal' && (
        <>
          <p className="subtitle">{line ? `“${line.text}”` : "Secrets dealt. Hold your card to read it. One of you doesn't know the word."}</p>
          <p className="big-countdown">{secondsUntil(game.dealEndsAt)}</p>
        </>
      )}
      {!turn && game.phase !== 'deal' && line && <p className="subtitle">“{line.text}”</p>}
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

interface VerdictProps {
  verdict: Verdict;
  /** False while the accusation is being spoken; the truth comes after. */
  revealed: boolean;
  line: SpokenLine | null;
  name(id: string): string;
  onPlayAgain(): void;
  onEnd(): void;
}

function VerdictPanel({ verdict, revealed, line, name, onPlayAgain, onEnd }: VerdictProps) {
  const fmt = (v: number | null, digits = 2) => (v === null ? '–' : v.toFixed(digits));
  if (!revealed) {
    return (
      <div className="verdict">
        <p className="phase-banner">Verdict</p>
        <p className="muted">The detective accuses</p>
        <p className="accused-name">{name(verdict.accusedId)}</p>
        <p className="subtitle">“{line?.text ?? verdict.spoken}”</p>
        <ul className="evidence">
          {verdict.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="verdict">
      <p className="phase-banner">Verdict</p>
      <p className="muted">The detective accused</p>
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
      {line && <p className="subtitle">“{line.text}”</p>}
      <p className="muted small">
        {verdict.source === 'gemini'
          ? `Gemini verdict${verdict.confidence !== null ? `, ${Math.round(verdict.confidence * 100)}% sure` : ''}`
          : 'Local verdict (Gemini was unavailable)'}
      </p>
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
