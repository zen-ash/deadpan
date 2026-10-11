import { normalizeRoomCode } from '@deadpan/shared';
import { lazy, Suspense } from 'react';
import { Landing } from './pages/Landing';
import { Play } from './pages/Play';

// The big screen pulls in three.js; phones never download it.
const Host = lazy(() => import('./pages/Host').then((m) => ({ default: m.Host })));
const EvidenceBoard = lazy(() => import('./host/EvidenceBoard').then((m) => ({ default: m.EvidenceBoard })));

/** The big screen and the replay sit on the dark stage; everything else is light. */
export function surfaceFor(path: string): 'light' | 'dark' {
  return /^\/(host|replay)\//.test(path) ? 'dark' : 'light';
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="message-page">
      <span className="wordmark">DEADPAN</span>
      <h1 className="message-title">{title}</h1>
      <p className="lead">{body}</p>
      <a className="btn black" href="/">
        Back to start
      </a>
    </main>
  );
}

function Loading({ text }: { text: string }) {
  return <main className="loading-page">{text}</main>;
}

export function App() {
  const path = window.location.pathname;
  if (path === '/') return <Landing />;

  const match = path.match(/^\/(host|play|replay)\/([^/]+)(?:\/(\d+))?\/?$/);
  if (!match) return <Message title="Nothing here." body="That page doesn't exist." />;

  const [, kind, rawCode, round] = match;
  const code = normalizeRoomCode(decodeURIComponent(rawCode!));
  if (!code) return <Message title="Bad room code." body="Room codes are 4 letters, like KTXB." />;

  if (kind === 'host' && !round) {
    // ?demo=N plays back round N of this room from its recording (?demo alone means round 1).
    const demo = new URLSearchParams(location.search).get('demo');
    return (
      <Suspense fallback={<Loading text="Loading the big screen…" />}>
        <Host code={code} demo={demo === null ? undefined : Math.max(1, Math.floor(Number(demo)) || 1)} />
      </Suspense>
    );
  }
  if (kind === 'play' && !round) return <Play code={code} />;
  if (kind === 'replay' && round) {
    return (
      <Suspense fallback={<Loading text="Loading the evidence board…" />}>
        <main className="replay-page">
          <EvidenceBoard room={code} round={Number(round)} onClose={() => location.assign(`/host/${code}`)} closeLabel={`Back to room ${code}`} />
        </main>
      </Suspense>
    );
  }
  return <Message title="Nothing here." body="That page doesn't exist." />;
}
