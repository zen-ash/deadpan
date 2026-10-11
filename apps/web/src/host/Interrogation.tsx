import { ANSWER_CAP_MS, TRUTHS_QUESTIONS, type GameState, type SpokenLine, type TruthsVerdict, type TurnInfo, type Verdict } from '@deadpan/shared';
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
  if (turn.kind === 'followup') return turn.about ? `Follow-up · On question ${turn.about}` : 'Follow-up';
  // Two Truths and a Lie counts each player's own questions, since each lies on one of them.
  if (turn.seq) return `Two truths, one lie · Question ${turn.seq} of ${TRUTHS_QUESTIONS}`;
  return `Questioning · Question ${turn.index} of ${turn.total}`;
}

/** "Ash", "Ash and Zen", "Ash, Zen and Riya". */
function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The headline after a Two Truths and a Lie reveal. */
function truthsTitle(v: TruthsVerdict): string {
  const n = v.picks.length;
  if (v.caught === 0) return 'Fooled.';
  if (v.caught === n) return n === 1 ? 'Caught.' : 'Caught them all.';
  return `Caught ${v.caught} of ${n}.`;
}

function truthsText(v: TruthsVerdict, name: (id: string) => string): string {
  if (v.picks.length === 1) {
    const p = v.picks[0]!;
    return p.correct
      ? `${name(p.playerId)} lied on question ${p.lie}, and the detective found it.`
      : `${name(p.playerId)} lied on question ${p.lie}; the detective picked question ${p.picked}.`;
  }
  const found = v.picks.filter((p) => p.correct).map((p) => name(p.playerId));
  const missed = v.picks.filter((p) => !p.correct).map((p) => name(p.playerId));
  const parts: string[] = [];
  if (found.length > 0) parts.push(`The detective found ${list(found.map((n) => `${n}’s`))} ${found.length === 1 ? 'lie' : 'lies'}.`);
  if (missed.length > 0) parts.push(`${list(missed)} got away with ${missed.length === 1 ? 'it' : 'theirs'}.`);
  return parts.join(' ');
}

function sourceText(v: Verdict): string {
  return v.source === 'gemini'
    ? `Gemini verdict${v.confidence !== null ? ` · ${Math.round(v.confidence * 100)}% sure` : ''}`
    : 'Local verdict · Gemini was unavailable';
}

/** The big screen's overlay during a round: who's asked, the detective's line, the timer and the verdict. */
export function Interrogation({ game, verdict, line, transcript, serverNow, name, stageRef }: Props) {
  const turn = game.turn;
  const ticking = game.phase === 'deal' || turn?.stage === 'answering';
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!ticking) return;
    // Catch up at once: the clock stood still between turns.
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [ticking, serverNow]);
  const msUntil = (t: number | null) => (t === null ? null : Math.max(0, t - now));

  if (game.phase === 'verdict') {
    const stage = verdict ? (game.verdictStage ?? 'deliberating') : 'deliberating';
    const truths = verdict?.mode === 'truths' ? verdict : null;
    const imposter = verdict && verdict.mode !== 'truths' ? verdict : null;
    // The evidence, shown one chip at a time while the accusation is spoken. With 5 or 6 players the
    // lie picks are on the cards instead: their reasons wouldn't fit in two rows.
    const chips = truths
      ? truths.picks.length <= 4
        ? truths.picks.map((p) => `${name(p.playerId)}, question ${p.picked}: ${p.why}`)
        : []
      : (imposter?.evidence ?? []);
    const eyebrow = stage === 'accusing' ? (truths ? 'The detective names' : 'The detective accuses') : `Verdict · Round ${game.round}`;
    return (
      <div className="stage verdict" ref={stageRef}>
        <p className="stage-eyebrow">{eyebrow}</p>
        {/* The drumroll, the accusation and the reveal share one box, as tall as the accusation (whose
            parts have fixed heights), so the faces and cards keep their size through the whole verdict. */}
        <div className="verdict-frame">
          <div className={`verdict-slide ${stage === 'deliberating' ? 'on' : ''}`}>
            <h1 className="stage-line">{stage === 'deliberating' && line ? `“${line.text}”` : 'The detective is deliberating.'}</h1>
          </div>

          <div className={`verdict-slide ${stage === 'accusing' ? 'on' : ''}`}>
            <h1 className="accused-name">{imposter ? withPeriod(name(imposter.accusedId)) : truths ? 'The lies.' : '\u00a0'}</h1>
            <p className="accused-line">{stage === 'accusing' && line ? `“${line.text}”` : ''}</p>
            <ul className="verdict-chips">
              {stage === 'accusing' &&
                chips.map((c, i) => (
                  <li key={c} title={c} style={{ animationDelay: `${0.4 + i * 0.9}s` }}>
                    <span>{c}</span>
                  </li>
                ))}
            </ul>
          </div>

          <div className={`verdict-slide ${stage === 'revealed' ? 'on' : ''}`}>
            {truths && (
              <>
                <h1 className="verdict-title">{truthsTitle(truths)}</h1>
                <p className="verdict-text">{truthsText(truths, name)}</p>
                <p className="verdict-source">{sourceText(truths)}</p>
              </>
            )}
            {imposter && (
              <>
                <h1 className="verdict-title">{imposter.correct ? 'Caught.' : 'Escaped.'}</h1>
                <p className="verdict-text">
                  The detective accused {name(imposter.accusedId)}, {imposter.correct ? 'and' : 'but'} {name(imposter.imposterId)} was the
                  imposter. The word was <span className="word">{imposter.word}</span>.
                </p>
                <p className="verdict-source">{sourceText(imposter)}</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (game.phase === 'deal') {
    const left = msUntil(game.dealEndsAt);
    return (
      <div className="stage" ref={stageRef}>
        <p className="stage-eyebrow">The deal</p>
        <h1 className="stage-line">{line ? `“${line.text}”` : 'Secrets dealt.'}</h1>
        <p className="stage-asks">
          {game.mode === 'truths' ? 'Your phone says which answer to lie on.' : 'Hold the case file on your phone to read it.'}
        </p>
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
