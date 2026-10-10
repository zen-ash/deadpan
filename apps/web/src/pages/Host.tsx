import { MAX_PLAYERS, type AnswerResult, type GameState, type PlayerInfo, type SpokenLine, type Verdict } from '@deadpan/shared';
import QRCode from 'qrcode';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HostAudio } from '../host/audio';
import { EvidenceBoard } from '../host/EvidenceBoard';
import { Interrogation } from '../host/Interrogation';
import { layoutSuspects, stageArea, type Reserved } from '../host/layout';
import { live } from '../host/live';
import { Room, type SuspectView } from '../host/Room';
import type { CardMoment } from '../host/SuspectCard';
import { SuspectCards } from '../host/SuspectCards';
import { RoomSocket } from '../lib/socket';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Height of the lobby's top bar, above "The lineup.". */
const TOP_BAR_H = 76;
/** Gap between a text block and the faces below it. */
const TEXT_GAP = 28;

interface Box {
  top: number;
  right: number;
  bottom: number;
  height: number;
}

/** An element's box on the page, kept up to date as it or the window changes size. */
function useBox<T extends Element>(): [(el: T | null) => void, Box | null] {
  const [el, setEl] = useState<T | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!el) {
      setBox(null);
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev && prev.top === r.top && prev.right === r.right && prev.bottom === r.bottom && prev.height === r.height
          ? prev
          : { top: r.top, right: r.right, bottom: r.bottom, height: r.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [el]);
  return [useCallback(setEl, []), box];
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

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
  /** The round shown on the evidence board, if it's open. */
  const [evidence, setEvidence] = useState<number | null>(null);
  const viewport = useViewport();
  // The suspects fit around these: the lobby's join panel and headline, the round's text block
  // at the top and the evidence chips at the bottom.
  const [panelRef, panelBox] = useBox<HTMLElement>();
  const [headRef, headBox] = useBox<HTMLDivElement>();
  const [stageRef, stageBox] = useBox<HTMLDivElement>();
  const [dockRef, dockBox] = useBox<HTMLUListElement>();
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
    setEvidence(null);
    socketRef.current?.send({ t });
  };
  const inRound = !!game && game.phase !== 'lobby';
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  const lastScored = (id: string) => answers.findLast((a) => a.playerId === id && a.kind !== 'baseline');

  // Where the lamp points: whoever is being questioned, a sweep during the drumroll, then the accused.
  const turn = game?.turn ?? null;
  const verdictShown = game?.phase === 'verdict' && game.verdictStage !== 'deliberating' && verdict;
  const focus: string | 'sweep' | null =
    game?.phase === 'verdict' ? (verdictShown ? verdict.accusedId : 'sweep') : (turn?.playerId ?? null);
  const activeId = verdictShown ? verdict.accusedId : (turn?.playerId ?? null);
  const revealed = game?.phase === 'verdict' && game.verdictStage === 'revealed' && verdict ? verdict : null;
  const moment: CardMoment = !inRound
    ? 'lobby'
    : revealed
      ? 'revealed'
      : game.phase === 'verdict'
        ? 'verdict'
        : game.phase === 'baseline'
          ? 'calibrating'
          : 'questioning';

  const suspects: SuspectView[] = players.map((p) => ({
    player: p,
    // Once revealed, the round's mean drift: what the detective weighed.
    drift: revealed ? (revealed.scores.find((s) => s.playerId === p.id)?.delivery ?? null) : (lastScored(p.id)?.delivery ?? null),
    lastAnswer: answers.findLast((a) => a.playerId === p.id),
    benched: inRound && !game?.roundPlayers.includes(p.id),
    role: revealed ? (p.id === revealed.imposterId ? 'imposter' : 'innocent') : undefined,
    stamp: revealed
      ? p.id === revealed.accusedId
        ? revealed.correct
          ? 'caught'
          : 'accused'
        : p.id === revealed.imposterId
          ? 'escaped'
          : undefined
      : undefined,
  }));

  // In the lobby, the empty seats take one more slot in the lineup.
  const openSeats = inRound ? 0 : MAX_PLAYERS - players.length;
  const headH = headBox?.height ?? 150;
  const reserved: Reserved = inRound
    ? {
        left: 0,
        top: (stageBox?.bottom ?? viewport.h * 0.32) + TEXT_GAP,
        bottom: dockBox ? viewport.h - dockBox.top + 16 : 24,
      }
    : { left: (panelBox?.right ?? 0) + 40, top: TOP_BAR_H + headH + TEXT_GAP, bottom: 24 };
  const area = stageArea(viewport, reserved);
  const slots = layoutSuspects(suspects.length + (openSeats > 0 ? 1 : 0), area, inRound, viewport.h);
  // "The lineup." sits just above the faces, centred over them.
  const facesTop = slots.length > 0 ? Math.min(...slots.map((s) => s.faceY - s.faceH / 2)) : area.y;
  const headX = area.x + area.w / 2;
  const headY = Math.max(TOP_BAR_H - 8, facesTop - headH - TEXT_GAP);

  return (
    <main className="host-stage">
      <Room suspects={suspects} slots={slots} focus={focus} activeId={activeId} calibrating={game?.phase === 'baseline'} />
      <SuspectCards suspects={suspects} slots={slots} openSeats={openSeats} activeId={activeId} moment={moment} />

      <div className="overlay">
        <header className={`top-bar ${inRound ? 'round' : ''}`}>
          {inRound ? (
            // During a round the join panel shrinks to this chip, so the faces get the full width.
            <aside className="join-chip" aria-label={`Join room ${code}`}>
              {qr && <img src={qr} alt={`QR code for ${joinUrl}`} />}
              <span className="join-chip-text">
                <span className="wordmark">DEADPAN</span>
                <span className="join-chip-code">{code}</span>
                {!connected && (
                  <span className="join-chip-status">
                    <span className="live-dot bad" /> Reconnecting…
                  </span>
                )}
              </span>
            </aside>
          ) : (
            <>
              <span className="wordmark">DEADPAN</span>
              <span className="open-tag">
                <span className={`live-dot ${connected ? '' : 'bad'}`} />
                {connected ? `Room ${code} is open` : 'Reconnecting…'}
              </span>
            </>
          )}
          {(inRound || soundBlocked) && (
            <nav className="top-actions" aria-label="Round controls">
              {!soundOn && (inRound || soundBlocked) && (
                <button className={`btn ${revealed || !inRound ? 'glass' : 'gold'}`} onClick={enableSound}>
                  Turn on sound
                </button>
              )}
              {inRound && game.phase !== 'verdict' && (
                <button className="btn glass" onClick={() => send('end_round')}>
                  End round
                </button>
              )}
              {/* After the reveal the corner holds what's next, keeping the faces clear. */}
              {revealed && (
                <>
                  <button className="btn gold" onClick={() => setEvidence(revealed.round)}>
                    See the evidence
                  </button>
                  <button className="btn glass" onClick={() => send('start_round')}>
                    Play again
                  </button>
                  <button className="btn glass" onClick={() => send('end_round')}>
                    Lobby
                  </button>
                </>
              )}
            </nav>
          )}
        </header>

        {!inRound && (
          <>
            <section className="lobby-panel" ref={panelRef} aria-label="Join this room">
              <p className="eyebrow">Join on your phone</p>
              <div className="qr-box">{qr && <img src={qr} alt={`QR code for ${joinUrl}`} />}</div>
              <p className="eyebrow code-label">Room code</p>
              <p className="room-code">{code}</p>
              <p className="join-url">
                <span>{location.host}</span>
                <wbr />
                <span>/play/{code}</span>
              </p>
              <span className="panel-rule" />
              <p className="suspect-count">
                {players.length === 0 ? 'Waiting for suspects…' : `${players.length} of ${MAX_PLAYERS} suspects in the room`}
              </p>
              <button className="btn gold" disabled={players.length === 0} onClick={() => send('start_round')}>
                Start round
              </button>
              {players.length === 1 && <p className="panel-note">Imposter needs 2 or more players. One works for testing.</p>}
              {LOCAL_HOSTS.has(location.hostname) && (
                <p className="stage-banner">Phones can't reach localhost. Open this page through the https tunnel link so the QR code works.</p>
              )}
            </section>
            <div className="lineup-head" ref={headRef} style={{ transform: `translate(${headX.toFixed(1)}px, ${headY.toFixed(1)}px) translateX(-50%)` }}>
              <h1 className="lineup-title">The lineup.</h1>
              <p className="lineup-sub">{players.length === 0 ? 'Scan the code to join.' : 'Start the round when everyone is in.'}</p>
            </div>
          </>
        )}

        {inRound && game && (
          <Interrogation
            game={game}
            verdict={verdict}
            line={line}
            transcript={transcript && transcript.turnId === game.turn?.id ? transcript.text : ''}
            serverNow={() => socketRef.current?.clock.now() ?? Date.now()}
            name={name}
            stageRef={stageRef}
            dockRef={dockRef}
          />
        )}
        {notice && <p className="stage-banner notice">{notice}</p>}
      </div>

      {evidence !== null && (
        <div className="board-backdrop" onClick={(e) => e.target === e.currentTarget && setEvidence(null)}>
          <EvidenceBoard room={code} round={evidence} onClose={() => setEvidence(null)} />
        </div>
      )}
    </main>
  );
}
