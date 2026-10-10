import { ANSWER_CAP_MS, type GameState, type SpokenLine, type TurnInfo, type Verdict } from '@deadpan/shared';
import { useEffect, useState, type Ref } from 'react';
import { withPeriod } from '../ui';

interface Props {
  game: GameState;
  verdict: Verdict | null;
  /** What the detective is saying right now. */
  line: SpokenLine | null;
  /** Live transcript of the current answer. */
  transcript: string;
  serverNow(): number;
  name(id: string): string;
  /** The text block at the top, measured so the faces sit below it. */
  stageRef?: Ref<HTMLDivElement>;
  /** The evidence chips along the bottom, measured so the cards sit above them. */
  dockRef?: Ref<HTMLUListElement>;
}

/** The end of a long transcript, so the latest words stay on one line. */
function tail(text: string, max = 90): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  return `…${cut.slice(cut.indexOf(' ') + 1)}`;
}

/** short, long or longer, so long lines get a smaller serif. */
function lengthClass(text: string): string {
  return text.length > 130 ? 'longer' : text.length > 70 ? 'long' : '';
}

function eyebrowFor(turn: TurnInfo): string {
  if (turn.kind === 'baseline') return `Calibrating · Question ${turn.index} of ${turn.total}`;
  if (turn.kind === 'followup') return 'Follow-up';
  return `Questioning · Question ${turn.index} of ${turn.total}`;
}

/** The big screen's overlay during a round: who's asked, the detective's line, the timer and the verdict. */
export function Interrogation({ game, verdict, line, transcript, serverNow, name, stageRef, dockRef }: Props) {
  const turn = game.turn;
  const ticking = game.phase === 'deal' || turn?.stage === 'answering';
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [ticking, serverNow]);
  const msUntil = (t: number | null) => (t === null ? null : Math.max(0, t - now));

  if (game.phase === 'verdict') {
    const shown = game.verdictStage !== 'deliberating' && verdict;
    return (
      <>
        <div className="stage verdict" ref={stageRef}>
          <p className="stage-eyebrow">Verdict · Round {game.round}</p>
          {!shown && <h1 className="stage-line">{line ? `“${line.text}”` : 'The detective is deliberating.'}</h1>}

          {shown && game.verdictStage === 'accusing' && (
            <>
              <p className="accused-kicker">The detective accuses</p>
              <h1 className="accused-name">{withPeriod(name(verdict.accusedId))}</h1>
              {line && <p className="accused-line">“{line.text}”</p>}
            </>
          )}

          {shown && game.verdictStage === 'revealed' && (
            <>
              <h1 className="verdict-title">{verdict.correct ? 'Caught.' : 'Escaped.'}</h1>
              <p className="verdict-text">
                {verdict.correct ? (
                  <>
                    The detective accused {name(verdict.accusedId)}, and {name(verdict.imposterId)} was the imposter.
                  </>
                ) : (
                  <>
                    The detective accused {name(verdict.accusedId)}, but {name(verdict.imposterId)} was the imposter.
                  </>
                )}{' '}
                The word was <span className="word">{verdict.word}</span>.
              </p>
              <p className="verdict-source">
                {verdict.source === 'gemini'
                  ? `Gemini verdict${verdict.confidence !== null ? ` · ${Math.round(verdict.confidence * 100)}% sure` : ''}`
                  : 'Local verdict · Gemini was unavailable'}
              </p>
            </>
          )}
        </div>

        {/* The detective's evidence appears one chip at a time while the accusation is spoken. */}
        {shown && game.verdictStage === 'accusing' && verdict.evidence.length > 0 && (
          <ul className="chips-dock" ref={dockRef}>
            {verdict.evidence.map((e, i) => (
              <li key={e} style={{ animationDelay: `${0.4 + i * 0.9}s` }}>
                {e}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (game.phase === 'deal') {
    const left = msUntil(game.dealEndsAt);
    return (
      <div className="stage" ref={stageRef}>
        <p className="stage-eyebrow">The deal</p>
        <h1 className="stage-line">{line ? `“${line.text}”` : 'Secrets dealt.'}</h1>
        <p className="stage-asks">Hold the case file on your phone to read it.</p>
        {left !== null && <p className="stage-count">{Math.ceil(left / 1000)}</p>}
      </div>
    );
  }

  // Calibration, questions and the follow-up. The detective's line plays as subtitles; once it has
  // played, the question stays up while the answer is timed.
  const spoken = line?.text ?? turn?.text ?? null;
  const left = turn?.stage === 'answering' ? msUntil(turn.answerDeadline) : null;
  return (
    <div className="stage asking" ref={stageRef}>
      <p className="stage-eyebrow">{turn ? eyebrowFor(turn) : game.phase === 'baseline' ? 'Calibrating' : 'Questioning'}</p>
      <p className="stage-asks">
        {turn ? (
          <>
            The detective asks <b>{name(turn.playerId)}</b>
          </>
        ) : line ? (
          'The detective says'
        ) : (
          'Stand by'
        )}
      </p>
      {spoken ? (
        <h1 key={spoken} className={`stage-line ${lengthClass(spoken)} ${line ? '' : 'quiet'}`}>
          “{spoken}”
        </h1>
      ) : (
        <h1 className="stage-line quiet">{game.phase === 'baseline' ? 'Setting the scene.' : 'Thinking it over.'}</h1>
      )}
      <div className="timer" style={{ visibility: left === null ? 'hidden' : 'visible' }} aria-hidden={left === null}>
        <span className="timer-track">
          <span className="timer-fill" style={{ transform: `scaleX(${left === null ? 1 : left / ANSWER_CAP_MS})` }} />
        </span>
        <span className="timer-left">{left === null ? '' : `${Math.ceil(left / 1000)}s`}</span>
      </div>
      {/* Always laid out, so the faces below don't move when the transcript starts. */}
      <p className="stage-transcript">{turn?.stage === 'answering' && transcript ? transcript : ' '}</p>
    </div>
  );
}
