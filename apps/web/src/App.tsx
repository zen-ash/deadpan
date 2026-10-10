import { normalizeRoomCode } from '@deadpan/shared';
import { lazy, Suspense } from 'react';
import { Landing } from './pages/Landing';
import { Play } from './pages/Play';

// The big screen pulls in three.js; phones never download it.
const Host = lazy(() => import('./pages/Host').then((m) => ({ default: m.Host })));

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="center-page">
      <h1 className="wordmark">DEADPAN</h1>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <a className="button" href="/">
        Back to start
      </a>
    </main>
  );
}

export function App() {
  const path = window.location.pathname;
  if (path === '/') return <Landing />;

  const match = path.match(/^\/(host|play|replay)\/([^/]+)(?:\/(\d+))?\/?$/);
  if (!match) return <Message title="Nothing here" body="That page doesn't exist." />;

  const [, kind, rawCode, round] = match;
  const code = normalizeRoomCode(decodeURIComponent(rawCode!));
  if (!code) return <Message title="Bad room code" body="Room codes are 4 letters, like KTXB." />;

  if (kind === 'host' && !round) {
    return (
      <Suspense fallback={<main className="center-page muted">Loading the big screen…</main>}>
        <Host code={code} />
      </Suspense>
    );
  }
  if (kind === 'play' && !round) return <Play code={code} />;
  if (kind === 'replay' && round) {
    return <Message title={`Room ${code}, round ${round}`} body="The evidence board arrives in a later milestone." />;
  }
  return <Message title="Nothing here" body="That page doesn't exist." />;
}
