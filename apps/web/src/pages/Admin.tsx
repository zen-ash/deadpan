// The owner's page: every saved round from every room, and how often the detective caught the
// imposter. The server only answers with the ADMIN_KEY; this tab remembers it until it closes.
import type { AdminRounds, ImposterLogEntry, RoundLogEntry, TruthsLogEntry } from '@deadpan/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { EvidenceBoard } from '../host/EvidenceBoard';
import { RoundList } from '../host/PastRounds';

const KEY_STORE = 'deadpan:admin-key';

function loadKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key: string | null) {
  try {
    if (key) sessionStorage.setItem(KEY_STORE, key);
    else sessionStorage.removeItem(KEY_STORE);
  } catch {
    // Private mode: the key just has to be typed again next time.
  }
}

export function Admin() {
  const [input, setInput] = useState('');
  const [data, setData] = useState<AdminRounds | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [evidence, setEvidence] = useState<{ room: string; round: number } | null>(null);

  async function open(key: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/rounds', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401) throw new Error('That key is wrong.');
      if (res.status === 503) throw new Error('ADMIN_KEY isn’t set on the server yet.');
      if (!res.ok) throw new Error(`Server error ${res.status}.`);
      setData((await res.json()) as AdminRounds);
      saveKey(key);
    } catch (err) {
      saveKey(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const key = loadKey();
    if (key) void open(key);
  }, []);

  useEffect(() => {
    if (!evidence) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEvidence(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [evidence]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) void open(input.trim());
  };
  const lock = () => {
    saveKey(null);
    setData(null);
    setInput('');
  };

  if (!data) {
    return (
      <main className="admin-page">
        <form className="admin-gate" onSubmit={submit}>
          <span className="wordmark">DEADPAN</span>
          <h1 className="admin-title">All rounds.</h1>
          <p className="admin-sub">Every saved round from every room. Enter your admin key.</p>
          <input
            className="admin-key"
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Admin key"
            autoComplete="current-password"
            aria-label="Admin key"
          />
          <button className="btn gold" disabled={loading || !input.trim()}>
            {loading ? 'Checking…' : 'Open'}
          </button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </main>
    );
  }

  const stats = accuracy(data.log);
  const lies = liesFound(data.log);
  return (
    <main className="admin-page">
      <section className="rounds admin">
        <header className="rounds-head">
          <div>
            <p className="eyebrow rounds-eyebrow">Admin</p>
            <h1 className="rounds-title">All rounds.</h1>
            <p className="rounds-sub">
              {stats
                ? `The detective caught the imposter in ${stats.caught} of ${stats.rounds} rounds (${pct(stats.caught / stats.rounds)}). Guessing would get about ${pct(stats.chance)}.`
                : 'No finished rounds with 2 or more players logged yet.'}
            </p>
            {stats && (
              <p className="rounds-sub">
                Gemini made {stats.gemini} of those verdicts; the local fallback made {stats.rounds - stats.gemini}. Single-player test
                rounds aren’t counted.
              </p>
            )}
            {lies && (
              <p className="rounds-sub">
                Two truths and a lie: the detective found {lies.caught} of {lies.total} lies ({pct(lies.caught / lies.total)}) over{' '}
                {lies.rounds} {lies.rounds === 1 ? 'round' : 'rounds'}. Guessing would get about {pct(lies.chance)}. Gemini judged{' '}
                {lies.gemini} of those rounds.
              </p>
            )}
          </div>
          <button className="btn glass" onClick={lock}>
            Lock
          </button>
        </header>
        {data.rounds.length === 0 ? (
          <p className="rounds-status">No saved rounds yet.</p>
        ) : (
          <RoundList rounds={data.rounds} from="admin" onEvidence={(room, round) => setEvidence({ room, round })} />
        )}
      </section>

      {evidence && (
        <div className="board-backdrop" onClick={(e) => e.target === e.currentTarget && setEvidence(null)}>
          <EvidenceBoard room={evidence.room} round={evidence.round} onClose={() => setEvidence(null)} />
        </div>
      )}
    </main>
  );
}

/** The Imposter accuracy stat from rounds.jsonl, over rounds with 2 or more players. */
function accuracy(log: RoundLogEntry[]) {
  const played = log.filter((e): e is ImposterLogEntry => e.mode !== 'truths' && e.players >= 2);
  if (played.length === 0) return null;
  return {
    rounds: played.length,
    caught: played.filter((e) => e.correct).length,
    gemini: played.filter((e) => e.source === 'gemini').length,
    // A random accusation is right one time in N.
    chance: played.reduce((sum, e) => sum + 1 / e.players, 0) / played.length,
  };
}

/**
 * Two Truths and a Lie: how many lies the detective found. Single-player rounds count, since a lie
 * among three answers is just as hard to find alone.
 */
function liesFound(log: RoundLogEntry[]) {
  const played = log.filter((e): e is TruthsLogEntry => e.mode === 'truths' && e.lies > 0);
  const options = played.flatMap((e) => e.options);
  if (played.length === 0 || options.length === 0) return null;
  return {
    rounds: played.length,
    total: played.reduce((n, e) => n + e.lies, 0),
    caught: played.reduce((n, e) => n + e.caught, 0),
    gemini: played.filter((e) => e.source === 'gemini').length,
    // A random pick among a player's answers is right one time in that many.
    chance: options.reduce((sum, n) => sum + 1 / Math.max(1, n), 0) / options.length,
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
