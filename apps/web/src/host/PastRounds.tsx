// The big screen's "Past rounds" list: this room's saved rounds, newest first. Replay opens a round
// in demo mode, with a way back to this room; Evidence opens its board here. The owner's /admin
// page shows every room's rounds with the same list.
import type { RoundSummary } from '@deadpan/shared';
import { useEffect, useState } from 'react';

interface Props {
  /** The live room: its rounds are listed, and a replay comes back to it. */
  room: string;
  onEvidence: (room: string, round: number) => void;
  onClose: () => void;
}

export function PastRounds({ room, onEvidence, onClose }: Props) {
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rounds?room=${room}`, { signal: AbortSignal.timeout(10_000) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server error ${res.status}.`);
        return (await res.json()) as RoundSummary[];
      })
      .then((list) => !cancelled && setRounds(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [room]);

  return (
    <div className="rounds-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="rounds" role="dialog" aria-label="Past rounds">
        <header className="rounds-head">
          <div>
            <p className="eyebrow rounds-eyebrow">Room {room}</p>
            <h1 className="rounds-title">Past rounds.</h1>
            <p className="rounds-sub">Replay a round played in this room just as it happened, or open its evidence.</p>
          </div>
          <button className="btn glass" onClick={onClose}>
            Close
          </button>
        </header>

        {error && <p className="rounds-status bad">{error}</p>}
        {!rounds && !error && <p className="rounds-status">Loading the recordings…</p>}
        {rounds?.length === 0 && (
          <p className="rounds-status">No saved rounds in room {room} yet. Every round that finishes is saved here.</p>
        )}
        {rounds && rounds.length > 0 && <RoundList rounds={rounds} from={room} onEvidence={onEvidence} />}
      </section>
    </div>
  );
}

interface ListProps {
  rounds: RoundSummary[];
  /** Where a replay's way back goes: a room code, or "admin". */
  from: string;
  onEvidence: (room: string, round: number) => void;
}

export function RoundList({ rounds, from, onEvidence }: ListProps) {
  return (
    <ul className="rounds-list">
      {rounds.map((r) => (
        <li key={`${r.room}-${r.round}`} className="round-row">
          <div className="round-who">
            <span className="round-name">
              Room {r.room} · Round {r.round}
            </span>
            <span className="round-players">{r.players.join(', ')}</span>
          </div>
          <span className="round-when">
            {when(r.startedAt)} · {length(r.endedAt - r.startedAt)}
          </span>
          <span className={`round-result ${r.caught === null ? '' : r.caught ? 'caught' : 'escaped'}`}>
            {r.caught === null ? 'No verdict' : r.caught ? 'Caught' : 'Escaped'}
            {r.word && <span className="round-word"> · {r.word}</span>}
          </span>
          <span className="round-actions">
            <button className="btn glass" onClick={() => onEvidence(r.room, r.round)}>
              Evidence
            </button>
            {r.replayable ? (
              <a className="btn soft" href={`/host/${r.room}?demo=${r.round}&from=${from}`}>
                Replay
              </a>
            ) : (
              // Rounds from before demo mode have no event log to play back.
              <span className="btn soft" aria-disabled title="Recorded before replays existed">
                Replay
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Oct 10, 8:28 PM". */
function when(t: number): string {
  return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "1 min 38 s". */
function length(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
