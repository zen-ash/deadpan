import { MAX_PLAYERS, type AnswerResult, type GameState, type PlayerInfo, type SpokenLine, type Verdict } from '@deadpan/shared';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { HostAudio } from '../host/audio';
import { Interrogation } from '../host/Interrogation';
import { live } from '../host/live';
import { SuspectCard } from '../host/SuspectCard';
import { RoomSocket } from '../lib/socket';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function Host({ code }: { code: string }) {
  const socketRef = useRef<RoomSocket | null>(null);
  const roundRef = useRef(0);
  const [audio] = useState(() => new HostAudio());
  const [soundOn, setSoundOn] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  /** What the detective is saying right now, for subtitles. */
  const [line, setLine] = useState<SpokenLine | null>(null);
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [qr, setQr] = useState('');
  const [game, setGame] = useState<GameState | null>(null);
  const [answers, setAnswers] = useState<AnswerResult[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [transcript, setTranscript] = useState<{ turnId: string; text: string } | null>(null);
  const [notice, setNotice] = useState('');
  const joinUrl = `${location.origin}/play/${code}`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''));
  }, [joinUrl]);

  useEffect(() => {
    const socket = new RoomSocket({
      onOpen: () => socket.send({ t: 'host_join', room: code }),
      onConnectedChange: setConnected,
      onMessage: (msg) => {
        switch (msg.t) {
          case 'room':
            live.setRoster(msg.players);
            setPlayers(msg.players);
            break;
          case 'state':
            if (msg.round !== roundRef.current) {
              roundRef.current = msg.round;
              setAnswers([]);
              setVerdict(null);
              setTranscript(null);
            }
            if (msg.phase === 'lobby') {
              setVerdict(null);
              setLine(null);
              audio.stopLines();
            }
            audio.setRoomTone(msg.phase !== 'lobby');
            setGame(msg);
            setNotice('');
            break;
          case 'answer':
            setAnswers((prev) => [...prev, msg]);
            break;
          case 'verdict':
            setVerdict(msg);
            break;
          case 'live_transcript':
            setTranscript({ turnId: msg.turnId, text: msg.text });
            break;
          case 'say': {
            const spoken = msg.line;
            setLine(spoken);
            // Report the moment the line finished: the answer's response time counts from there.
            audio.say(spoken, (at) => {
              socket.send({ t: 'tts_end', lineId: spoken.id, at: socket.clock.toServer(at) });
              setLine((current) => (current?.id === spoken.id ? null : current));
            });
            break;
          }
          case 'sfx':
            audio.sfx(msg.name);
            break;
          case 'error':
            setNotice(msg.message);
            break;
          default:
            live.handle(msg);
        }
      },
      onBinary: (data) => live.handleMesh(data),
    });
    socketRef.current = socket;
    audio.onBlocked = () => setSoundBlocked(true);
    return () => {
      socket.close();
      socketRef.current = null;
      audio.stopLines();
      audio.setRoomTone(false);
    };
  }, [code, audio]);

  const enableSound = () => {
    audio.unlock();
    setSoundOn(true);
    setSoundBlocked(false);
  };
  const send = (t: 'start_round' | 'end_round') => {
    // Starting a round is a click, which is what browsers need before they play sound.
    if (t === 'start_round') enableSound();
    socketRef.current?.send({ t });
  };
  const inRound = !!game && game.phase !== 'lobby';
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  const lastAnswer = (id: string) => answers.findLast((a) => a.playerId === id);

  return (
    <main className={`host ${players.length > 0 ? 'has-players' : ''}`}>
      <section className="host-join">
        <h1 className="wordmark">DEADPAN</h1>
        {inRound && game ? (
          <Interrogation
            game={game}
            verdict={verdict}
            line={line}
            transcript={transcript && transcript.turnId === game.turn?.id ? transcript.text : ''}
            serverNow={() => socketRef.current?.clock.now() ?? Date.now()}
            name={name}
            onPlayAgain={() => send('start_round')}
            onEnd={() => send('end_round')}
          />
        ) : (
          <>
            <div className="qr">{qr && <img src={qr} alt={`QR code for ${joinUrl}`} />}</div>
            <p className="muted">Scan to join, or open</p>
            <p className="join-url">
              {location.host}/play/<b>{code}</b>
            </p>
            <button className="button primary huge" disabled={players.length === 0} onClick={() => send('start_round')}>
              Start round
            </button>
            {players.length === 1 && <p className="muted small">Imposter needs 2+ players. One player works for testing.</p>}
            {LOCAL_HOSTS.has(location.hostname) && (
              <p className="banner warn">
                Phones can't reach localhost. Open this page through the https tunnel link so the QR code works.
              </p>
            )}
          </>
        )}
        {notice && <p className="banner bad">{notice}</p>}
        {!soundOn && (inRound || soundBlocked) && (
          <button className="button primary" onClick={enableSound}>
            Turn on the detective's voice
          </button>
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
              <SuspectCard
                key={p.id}
                player={p}
                active={game?.turn?.playerId === p.id}
                benched={inRound && !game?.roundPlayers.includes(p.id)}
                lastAnswer={lastAnswer(p.id)}
                badge={
                  game?.phase === 'verdict' && verdict
                    ? p.id === verdict.accusedId
                      ? 'accused'
                      : p.id === verdict.imposterId
                        ? 'imposter'
                        : undefined
                    : undefined
                }
              />
            ))}
          </div>
        )}
        <footer className="muted small">
          <span className={`dot ${connected ? 'ok' : 'bad'}`} /> {connected ? `Room ${code} is live` : 'Reconnecting…'}
          {inRound && <span> · join at {location.host}/play/{code}</span>}
        </footer>
      </section>
    </main>
  );
}
