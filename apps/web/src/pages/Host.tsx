import { MAX_PLAYERS, type PlayerInfo } from '@deadpan/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { live } from '../host/live';
import { SuspectCard } from '../host/SuspectCard';
import { RoomSocket } from '../lib/socket';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function Host({ code }: { code: string }) {
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [qr, setQr] = useState('');
  const joinUrl = `${location.origin}/play/${code}`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''));
  }, [joinUrl]);

  useEffect(() => {
    const socket = new RoomSocket({
      onOpen: () => socket.send({ t: 'host_join', room: code }),
      onConnectedChange: setConnected,
      onMessage: (msg) => {
        if (msg.t === 'room') {
          live.setRoster(msg.players);
          setPlayers(msg.players);
        } else {
          live.handle(msg);
        }
      },
      onBinary: (data) => live.handleMesh(data),
    });
    return () => socket.close();
  }, [code]);

  return (
    <main className={`host ${players.length > 0 ? 'has-players' : ''}`}>
      <section className="host-join">
        <h1 className="wordmark">DEADPAN</h1>
        <div className="qr">{qr && <img src={qr} alt={`QR code for ${joinUrl}`} />}</div>
        <p className="muted">Scan to join, or open</p>
        <p className="join-url">
          {location.host}/play/<b>{code}</b>
        </p>
        {LOCAL_HOSTS.has(location.hostname) && (
          <p className="banner warn">
            Phones can't reach localhost. Open this page through the https tunnel link so the QR code works.
          </p>
        )}
      </section>

      <section className="host-players">
        <header>
          <h2>Suspects</h2>
          <span className="muted">
            {players.length}/{MAX_PLAYERS}
          </span>
        </header>
        {players.length === 0 ? (
          <p className="muted waiting">Waiting for players…</p>
        ) : (
          <div className={`suspect-grid count-${players.length}`}>
            {players.map((p) => (
              <SuspectCard key={p.id} player={p} />
            ))}
          </div>
        )}
        <footer className="muted small">
          <span className={`dot ${connected ? 'ok' : 'bad'}`} /> {connected ? `Room ${code} is live` : 'Reconnecting…'}
        </footer>
      </section>
    </main>
  );
}
