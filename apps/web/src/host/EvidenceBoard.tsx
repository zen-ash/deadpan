// The evidence board: one track per suspect along the round's timeline, with each question and
// answer window, what they said, their signal traces, and the spikes against their own baseline.
// It reads the round recording (rounds/<room>-<round>.json) from the server.
import type { AnswerResult, RoundFile, RoundSample } from '@deadpan/shared';
import { Fragment, useEffect, useState, type ReactElement } from 'react';
import { SPIKE } from '../ui';

/** The traces are drawn in a 1000 × 130 box, stretched to the track's width. */
const TRACE_W = 1000;
const TRACE_H = 130;
/** On the timeline each quote is cut off at this width, and before the next one starts; the full
    answers are listed under the timeline. */
const SAID_MAX_PX = 160;
/**
 * The filler words the server counts (server/src/scoring.ts): um, uh and friends, "you know", and
 * "like" only when it's set off with commas ("it's, like, a bird").
 */
const FILLER_RE = /\b(?:umm?|uhh?|uhm|erm|er|hmm|mm)\b|(?<=(?:^|[,.!?])\s*)like(?=\s*,)|\byou know\b/gi;
const KIND_LABEL = { baseline: 'Warm-up', question: 'Question', followup: 'Follow-up' } as const;

interface Props {
  room: string;
  round: number;
  onClose?: () => void;
  closeLabel?: string;
}

export function EvidenceBoard({ room, round, onClose, closeLabel = 'Close' }: Props) {
  const [data, setData] = useState<RoundFile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rounds/${room}/${round}`, { signal: AbortSignal.timeout(8000) })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'No recording of that round.' : `Server error ${res.status}`);
        return (await res.json()) as RoundFile;
      })
      .then((file) => !cancelled && setData(file))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [room, round]);

  const name = (id: string) => data?.players.find((p) => p.id === id)?.name ?? '?';
  const v = data?.verdict && data.verdict.mode !== 'truths' ? data.verdict : null;
  const truths = data?.verdict?.mode === 'truths' ? data.verdict : null;

  return (
    <section className="board" role="dialog" aria-label="Evidence board">
      <header className="board-head">
        <div>
          <p className="eyebrow board-eyebrow">Evidence board</p>
          <h1 className="board-title">
            Round {round}.{data?.word && ` The word was ${data.word}.`}
            {data?.mode === 'truths' && ' Two truths and a lie.'}
          </h1>
          <ul className="board-chips">
            <li>Room {room}</li>
            {v && <li>Accused: {name(v.accusedId)}</li>}
            {v && <li>Imposter: {name(v.imposterId)}</li>}
            {v && <li className={v.correct ? 'caught' : 'escaped'}>{v.correct ? 'Caught' : 'Escaped'}</li>}
            {truths && (
              <li className={truths.caught === truths.picks.length ? 'caught' : truths.caught === 0 ? 'escaped' : ''}>
                Found {truths.caught} of {truths.picks.length} {truths.picks.length === 1 ? 'lie' : 'lies'}
              </li>
            )}
          </ul>
        </div>
        {onClose && (
          <button className="btn outline" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </header>

      {!error && (
        <ul className="legend" aria-label="Legend">
          <li>
            <span className="key voice" />
            Voice level
          </li>
          <li>
            <span className="key lip" />
            Lip press
          </li>
          <li>
            <span className="key pitch" />
            Pitch
          </li>
          <li>
            <span className="key blink" />
            Blink
          </li>
          <li>
            <span className="key talk" />
            Speaking
          </li>
          <li>
            <span className="key window" />
            Question, then answer
          </li>
          <li>
            <span className="key spike">+2σ</span>
            Spike against their own baseline
          </li>
        </ul>
      )}

      {error && <p className="board-status bad">{error}</p>}
      {!data && !error && <p className="board-status">Loading the round…</p>}
      {data && <Timeline data={data} />}
    </section>
  );
}

function Timeline({ data }: { data: RoundFile }) {
  const t0 = data.turns[0]?.askedAt ?? data.startedAt;
  const t1 = Math.max(t0 + 1000, data.endedAt || data.turns.at(-1)?.answerEnd || t0 + 60_000);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));

  // Seconds along the top, every 10 s (20 s for long rounds).
  const span = (t1 - t0) / 1000;
  const step = span > 150 ? 20 : 10;
  const ticks: number[] = [];
  for (let s = 0; s <= span; s += step) ticks.push(s);

  return (
    <div className="board-scroll">
      <div className="board-chart">
        <div className="board-axis" aria-hidden>
          <span />
          <div className="axis">
            {ticks.map((s) => (
              <span key={s} style={{ left: `${pct(t0 + s * 1000)}%` }}>
                {s}s
              </span>
            ))}
          </div>
        </div>
        {data.players.map((p) => (
          <Track key={p.id} data={data} playerId={p.id} name={p.name} pct={pct} ticks={ticks.map((s) => t0 + s * 1000)} t0={t0} t1={t1} />
        ))}
      </div>
    </div>
  );
}

interface TrackProps {
  data: RoundFile;
  playerId: string;
  name: string;
  /** Time to percent of the track's width. */
  pct: (t: number) => number;
  ticks: number[];
  t0: number;
  t1: number;
}

const SPIKE_LABELS: [keyof NonNullable<AnswerResult['z']>, string][] = [
  ['rt', 'Response'],
  ['pitch', 'Pitch'],
  ['fillers', 'Fillers'],
  ['pauses', 'Pauses'],
  ['blink', 'Blinks'],
  ['lip', 'Lips'],
];

/** "Response +3.0σ · Lips +2.8σ": the biggest spikes against this player's baseline. */
function spikeText(answer: AnswerResult | undefined): string {
  if (!answer?.z) return '';
  const z = answer.z;
  return SPIKE_LABELS.map(([key, label]) => [label, z[key]] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null && entry[1] > SPIKE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, value]) => `${label} +${value.toFixed(1)}σ`)
    .join(' · ');
}

function Track({ data, playerId, name, pct, ticks, t0, t1 }: TrackProps) {
  const samples = (data.samples[playerId] ?? []).filter((s) => s[0] >= t0 && s[0] <= t1);
  const turns = data.turns.filter((t) => t.playerId === playerId);
  const truths = data.mode === 'truths';
  const isImposter = data.imposterId === playerId;
  const isAccused = data.verdict?.mode !== 'truths' && data.verdict?.accusedId === playerId;
  // Two Truths and a Lie: the answer they lied on, and the one the detective picked.
  const lie = data.lies?.[playerId];
  const pick = data.verdict?.mode === 'truths' ? data.verdict.picks.find((p) => p.playerId === playerId) : undefined;
  const marks = (seq: number | undefined) =>
    seq === undefined ? [] : [...(seq === lie ? ['The lie'] : []), ...(seq === pick?.picked ? ['Detective’s pick'] : [])];
  const x = (t: number) => (pct(t) / 100) * TRACE_W;

  const path = (value: (s: RoundSample) => number | null, min: number, max: number, top: number, height: number) => {
    let d = '';
    let pen = false;
    for (const s of samples) {
      const v = value(s);
      if (v === null) {
        pen = false;
        continue;
      }
      const k = Math.min(1, Math.max(0, (v - min) / (max - min)));
      d += `${pen ? 'L' : 'M'}${x(s[0]).toFixed(1)} ${(top + height * (1 - k)).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const blinks: number[] = [];
  for (let i = 1; i < samples.length; i++) if (samples[i]![3] > samples[i - 1]![3]) blinks.push(samples[i]![0]);

  const speaking = (data.speech[playerId] ?? []).reduce<{ from: number; to: number }[]>((spans, [t, on]) => {
    if (on) spans.push({ from: t, to: t1 });
    else if (spans.length > 0 && spans.at(-1)!.to === t1) spans.at(-1)!.to = t;
    return spans;
  }, []);

  // Each answer's window, what was said in it, and how far its label may run before the next one.
  const windows = turns.map((turn) => {
    const start = turn.questionEnd ?? turn.askedAt;
    const end = turn.answerEnd ?? start;
    const answer = data.answers.find((a) => a.turnId === turn.id);
    const said = data.transcripts.find((tr) => tr.turnId === turn.id)?.text.trim() ?? answer?.metrics.transcript.trim() ?? '';
    return { turn, start, end, said, answer, spike: spikeText(answer) };
  });
  const room = (i: number) => (i + 1 < windows.length ? pct(windows[i + 1]!.start) : 100) - pct(windows[i]!.start);

  return (
    <div className={`track ${isImposter ? 'imposter' : ''}`}>
      <div className="track-who">
        <span className="track-name">{name}</span>
        <div className="track-tags">
          {truths ? (
            <>
              {lie && <span className="tag">Lied on Q{lie}</span>}
              {pick && <span className={`tag ${pick.correct ? 'imposter' : 'accused'}`}>{pick.correct ? 'Lie found' : `Picked Q${pick.picked}`}</span>}
            </>
          ) : (
            <>
              {isImposter && <span className="tag imposter">Imposter</span>}
              {isAccused && <span className="tag accused">Accused</span>}
              {!isImposter && <span className="tag">Innocent</span>}
            </>
          )}
        </div>
      </div>

      <div className="track-chart">
        {ticks.map((t) => (
          <span key={t} className="grid-line" style={{ left: `${pct(t)}%` }} />
        ))}

        {windows.map(({ turn, start, end, said, spike }, i) => {
          const qLeft = pct(turn.askedAt);
          const qWidth = Math.max(0.2, pct(end) - qLeft);
          const aLeft = pct(start);
          const aWidth = Math.max(0.2, pct(end) - aLeft);
          const roomPct = room(i);
          return (
            <Fragment key={turn.id}>
              <span className="band-q" style={{ left: `${qLeft}%`, width: `${qWidth}%` }} />
              <span
                className={`band-a ${spike ? 'spike' : ''} ${turn.kind === 'question' && turn.seq === lie ? 'lie' : ''}`}
                style={{ left: `${aLeft}%`, width: `${aWidth}%` }}
              />
              <span className="band-label" title={turn.question} style={{ left: `${qLeft}%`, width: `${qWidth}%` }}>
                <b>{i + 1}</b> {turn.question}
              </span>
              {spike && (
                <span className="spike-pill" title={spike} style={{ left: `${aLeft}%`, maxWidth: `calc(${roomPct}% - 6px)` }}>
                  {spike}
                </span>
              )}
              {said && (
                <span className="said" title={said} style={{ left: `${aLeft}%`, maxWidth: `min(${SAID_MAX_PX}px, calc(${roomPct}% - 6px))` }}>
                  “{said}”
                </span>
              )}
            </Fragment>
          );
        })}

        <svg className="traces" viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" aria-hidden>
          <path d={path((s) => (s[2] > 0 ? 20 * Math.log10(s[2]) : null), -60, -10, 6, 118)} className="trace voice" />
          <path d={path((s) => s[4], 0, 0.5, 20, 104)} className="trace lip" />
          <path d={path((s) => (s[1] > 0 ? s[1] : null), 70, 320, 10, 100)} className="trace pitch" />
        </svg>

        {blinks.map((t) => (
          <span key={t} className="blink-tick" style={{ left: `${pct(t)}%` }} />
        ))}
        {speaking.map((s) => (
          <span key={s.from} className="talk-bar" style={{ left: `${pct(s.from)}%`, width: `${Math.max(0, pct(s.to) - pct(s.from))}%` }} />
        ))}
      </div>

      {/* Everything they said, in full, numbered to match the timeline. */}
      {windows.length > 0 && (
        <ol className="said-list">
          {windows.map(({ turn, said, answer, spike }, i) => (
            <li key={turn.id} className={`said-card ${spike ? 'spike' : ''} ${turn.kind === 'question' && turn.seq === lie ? 'lie' : ''}`}>
              <p className="said-q">
                <b>{i + 1}</b>
                <span>
                  {turn.kind === 'question' && turn.seq ? `Question ${turn.seq}` : KIND_LABEL[turn.kind]}
                  {turn.kind === 'followup' && turn.about ? ` on question ${turn.about}` : ''} · {turn.question}
                </span>
              </p>
              {turn.kind === 'question' && marks(turn.seq).length > 0 && (
                <p className="said-marks">
                  {marks(turn.seq).map((m) => (
                    <span key={m} className={`tag ${m === 'The lie' ? 'imposter' : 'accused'}`}>
                      {m}
                    </span>
                  ))}
                </p>
              )}
              <p className={`said-a ${said ? '' : 'none'}`}>{said ? <>“{withFillers(said)}”</> : 'No answer heard.'}</p>
              <p className="said-meta">
                {answerFacts(answer).map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
                {spike && <span className="spike-pill">{spike}</span>}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The answer's text with each filler word highlighted. */
function withFillers(text: string) {
  const parts: (string | ReactElement)[] = [];
  let last = 0;
  for (const m of text.matchAll(FILLER_RE)) {
    parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={m.index} className="filler">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/** "1.2 s to start · 2 fillers · 1 pause", from what the server measured. */
function answerFacts(answer: AnswerResult | undefined): string[] {
  if (!answer) return [];
  const m = answer.metrics;
  const facts: string[] = [];
  facts.push(m.rtMs === null ? 'Never started talking' : `${(m.rtMs / 1000).toFixed(1)} s to start`);
  if (m.fillers !== null) facts.push(`${m.fillers} ${m.fillers === 1 ? 'filler' : 'fillers'}`);
  if (m.pauseCount !== null) facts.push(`${m.pauseCount} ${m.pauseCount === 1 ? 'pause' : 'pauses'}`);
  if (m.pitchShiftSt !== null) facts.push(`pitch ${m.pitchShiftSt >= 0 ? '+' : '−'}${Math.abs(m.pitchShiftSt).toFixed(1)} st`);
  return facts;
}
