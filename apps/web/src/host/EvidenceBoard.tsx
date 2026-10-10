// The evidence board: one lane per suspect along the round's timeline, with the questions, every
// word they said where they said it, their signal traces, and the spikes the detective noticed.
// It reads the round recording (rounds/<room>-<round>.json) from the server.
import type { AnswerResult, RoundFile, RoundSample } from '@deadpan/shared';
import { useEffect, useState } from 'react';

const W = 1200;
const LEFT = 120;
const RIGHT = 20;
const LANE = 178;
const TOP = 34;
const FILLER = /^(um+|uh+|uhm|erm|er|hmm+|mm)[,.!?]?$/i;

interface Props {
  room: string;
  round: number;
  onClose?: () => void;
}

export function EvidenceBoard({ room, round, onClose }: Props) {
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

  return (
    <section className="evidence-board">
      <header className="board-head">
        <div>
          <p className="phase-banner">Evidence board</p>
          <h2>
            Room {room} · Round {round}
            {data?.word && (
              <>
                {' '}
                · the word was <span className="word">{data.word}</span>
              </>
            )}
          </h2>
          {data?.verdict && <VerdictLine data={data} />}
        </div>
        {onClose && (
          <button className="button" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      {error && <p className="banner bad">{error}</p>}
      {!data && !error && <p className="muted">Loading the round…</p>}
      {data && <Timeline data={data} />}
      {data && (
        <p className="legend">
          <span className="key pitch">pitch</span>
          <span className="key voice">voice level</span>
          <span className="key lip">lip press</span>
          <span className="key blink">blink</span>
          <span className="key speech">speaking</span>
          <span className="key spike">spike vs. their own baseline</span>
        </p>
      )}
    </section>
  );
}

function VerdictLine({ data }: { data: RoundFile }) {
  const name = (id: string) => data.players.find((p) => p.id === id)?.name ?? '?';
  const v = data.verdict!;
  return (
    <p className="muted">
      Accused <b>{name(v.accusedId)}</b> · imposter <b>{name(v.imposterId)}</b> ·{' '}
      <span className={v.correct ? 'hot' : 'ok-text'}>{v.correct ? 'caught' : 'escaped'}</span>
    </p>
  );
}

function Timeline({ data }: { data: RoundFile }) {
  const t0 = data.turns[0]?.askedAt ?? data.startedAt;
  const t1 = data.endedAt || data.turns.at(-1)?.answerEnd || t0 + 60_000;
  const x = (t: number) => LEFT + ((t - t0) / Math.max(1, t1 - t0)) * (W - LEFT - RIGHT);
  const height = TOP + data.players.length * LANE + 10;

  // Seconds along the top.
  const ticks: number[] = [];
  for (let s = 0; s <= (t1 - t0) / 1000; s += 10) ticks.push(s);

  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Round timeline">
      {ticks.map((s) => (
        <g key={s}>
          <line x1={x(t0 + s * 1000)} x2={x(t0 + s * 1000)} y1={TOP - 8} y2={height} className="grid" />
          <text x={x(t0 + s * 1000)} y={TOP - 14} className="tick">
            {s}s
          </text>
        </g>
      ))}
      {data.players.map((p, i) => (
        <Lane key={p.id} data={data} playerId={p.id} name={p.name} y={TOP + i * LANE} x={x} t0={t0} t1={t1} />
      ))}
    </svg>
  );
}

interface LaneProps {
  data: RoundFile;
  playerId: string;
  name: string;
  y: number;
  x: (t: number) => number;
  t0: number;
  t1: number;
}

function Lane({ data, playerId, name, y, x, t0, t1 }: LaneProps) {
  const samples = (data.samples[playerId] ?? []).filter((s) => s[0] >= t0 && s[0] <= t1);
  const turns = data.turns.filter((t) => t.playerId === playerId);
  const answers = data.answers.filter((a) => a.playerId === playerId);
  const isImposter = data.imposterId === playerId;
  const traceTop = y + 34;
  const traceH = 74;

  const path = (value: (s: RoundSample) => number | null, min: number, max: number) => {
    let d = '';
    let pen = false;
    for (const s of samples) {
      const v = value(s);
      if (v === null) {
        pen = false;
        continue;
      }
      const k = Math.min(1, Math.max(0, (v - min) / (max - min)));
      d += `${pen ? 'L' : 'M'}${x(s[0]).toFixed(1)},${(traceTop + traceH * (1 - k)).toFixed(1)}`;
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

  return (
    <g className="lane">
      <rect x={0} y={y} width={W} height={LANE - 8} className={`lane-bg ${isImposter ? 'imposter' : ''}`} rx={8} />
      <text x={14} y={y + 26} className="lane-name">
        {name}
      </text>
      {isImposter && (
        <text x={14} y={y + 44} className="lane-tag">
          IMPOSTER
        </text>
      )}
      {data.verdict?.accusedId === playerId && (
        <text x={14} y={y + 60} className="lane-tag accused">
          ACCUSED
        </text>
      )}

      {turns.map((turn) => {
        const answer = answers.find((a) => a.turnId === turn.id);
        const start = turn.questionEnd ?? turn.askedAt;
        const end = turn.answerEnd ?? start;
        return (
          <g key={turn.id}>
            <rect x={x(turn.askedAt)} y={y + 8} width={Math.max(1, x(start) - x(turn.askedAt))} height={LANE - 24} className="asked" />
            <rect x={x(start)} y={y + 8} width={Math.max(2, x(end) - x(start))} height={LANE - 24} className={`answer ${turn.kind}`} />
            <text x={x(turn.askedAt) + 4} y={y + 22} className="question-label">
              {clip(turn.question, Math.max(8, Math.floor((x(end) - x(turn.askedAt)) / 6.2)))}
            </text>
            {answer && <Spikes answer={answer} x={x(start) + 4} y={y + 36} />}
          </g>
        );
      })}

      <path d={path((s) => (s[2] > 0 ? 20 * Math.log10(s[2]) : null), -60, -10)} className="trace voice" />
      <path d={path((s) => s[4], 0, 0.5)} className="trace lip" />
      <path d={path((s) => (s[1] > 0 ? s[1] : null), 70, 320)} className="trace pitch" />
      {blinks.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={traceTop + traceH + 4} y2={traceTop + traceH + 12} className="blink" />
      ))}
      {speaking.map((s) => (
        <rect key={s.from} x={x(s.from)} y={traceTop + traceH + 16} width={Math.max(1, x(s.to) - x(s.from))} height={4} className="speech" rx={2} />
      ))}
      <Words data={data} playerId={playerId} x={x} y={y + LANE - 30} />
    </g>
  );
}

/** Signals more than one standard deviation from this player's calm baseline. */
function Spikes({ answer, x, y }: { answer: AnswerResult; x: number; y: number }) {
  if (!answer.z) return null;
  const labels: [string, number | null][] = [
    ['RT', answer.z.rt],
    ['pitch', answer.z.pitch],
    ['fillers', answer.z.fillers],
    ['pauses', answer.z.pauses],
    ['blinks', answer.z.blink],
    ['lips', answer.z.lip],
  ];
  const spikes = labels.filter(([, z]) => z !== null && z > 1);
  return (
    <>
      {spikes.slice(0, 3).map(([label, z], i) => (
        <text key={label} x={x} y={y + i * 13} className="spike">
          {label} +{z!.toFixed(1)}σ
        </text>
      ))}
    </>
  );
}

/** Each transcribed word at the moment it was said, alternating rows so neighbours don't collide. */
function Words({ data, playerId, x, y }: { data: RoundFile; playerId: string; x: (t: number) => number; y: number }) {
  const items: { t: number; w: string }[] = [];
  for (const tr of data.transcripts.filter((t) => t.playerId === playerId)) {
    if (tr.words.length > 0) {
      for (const w of tr.words) items.push({ t: w.start, w: w.w });
    } else if (tr.text) {
      const turn = data.turns.find((t) => t.id === tr.turnId);
      if (turn?.questionEnd) items.push({ t: turn.questionEnd, w: `“${clip(tr.text, 40)}”` });
    }
  }
  const lastEnd = [-Infinity, -Infinity];
  return (
    <>
      {items.map((item, i) => {
        const px = x(item.t);
        const row = px > lastEnd[0]! ? 0 : px > lastEnd[1]! ? 1 : i % 2;
        lastEnd[row] = px + item.w.length * 5.6 + 4;
        return (
          <text key={`${item.t}-${i}`} x={px} y={y + row * 12} className={`word-label ${FILLER.test(item.w) ? 'filler' : ''}`}>
            {item.w}
          </text>
        );
      })}
    </>
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
