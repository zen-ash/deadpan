import { MAX_PLAYERS, type AnswerResult, type GameState, type PlayerInfo, type SpokenLine, type Verdict } from '@deadpan/shared';
import QRCode from 'qrcode';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { HostAudio } from '../host/audio';
import { CameraView } from '../host/CameraView';
import { DemoSocket } from '../host/demo';
import { EvidenceBoard } from '../host/EvidenceBoard';
import { PastRounds } from '../host/PastRounds';
import { Interrogation } from '../host/Interrogation';
import { layoutSuspects, NARROW_W, stageArea, type Reserved } from '../host/layout';
import { live } from '../host/live';
import { Room, type SuspectView } from '../host/Room';
import type { CardMoment } from '../host/SuspectCard';
import { SuspectCards } from '../host/SuspectCards';
import { RoomSocket, type Link, type SocketHandlers } from '../lib/socket';

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

interface HostProps {
  code: string;
  /** Plays back that recorded round of the room instead of joining it live. */
  demo?: number;
  /** In demo mode, the way back out of the replay (none when a phone opened it in a new tab). */
  back?: { href: string; label: string } | null;
}

export function Host({ code, demo, back }: HostProps) {
  const socketRef = useRef<Link | null>(null);
  const roundRef = useRef(0);
  /** Every name seen in this room, so players who leave keep theirs on the verdict. */
  const knownNames = useRef(new Map<string, string>());
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
  const [evidence, setEvidence] = useState<{ room: string; round: number } | null>(null);
  /** The list of saved rounds to replay, in the lobby. */
  const [pastRounds, setPastRounds] = useState(false);
  /** The camera view for the computer vision judges; phones send full landmark frames while it's open. */
  const [cameraView, setCameraView] = useState(false);
  const cameraViewRef = useRef(false);
  const viewport = useViewport();
  // The suspects fit around these: the lobby's join panel and headline, the round's text block
  // at the top and the evidence chips at the bottom.
  const [panelRef, panelBox] = useBox<HTMLElement>();
  const [headRef, headBox] = useBox<HTMLDivElement>();
  const [stageRef, stageBox] = useBox<HTMLDivElement>();
  const [dockRef, dockBox] = useBox<HTMLUListElement>();
  const [barRef, barBox] = useBox<HTMLElement>();
  const joinUrl = `${location.origin}/play/${code}`;
  /** A phone-sized window (a replay opened from a phone): faces in a grid with name tags. */
  const narrow = viewport.w < NARROW_W;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''));
  }, [joinUrl]);

  useEffect(() => {
    const handlers: SocketHandlers = {
      onOpen: () => {
        socket.send({ t: 'host_join', room: code });
        if (cameraViewRef.current) socket.send({ t: 'camera_view', on: true });
      },
      onConnectedChange: setConnected,
      onMessage: (msg) => {
        switch (msg.t) {
          case 'room':
            live.setRoster(msg.players);
            for (const p of msg.players) knownNames.current.set(p.id, p.name);
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
    };
    const socket: Link = demo ? new DemoSocket(code, demo, handlers) : new RoomSocket(handlers);
    socketRef.current = socket;
    audio.onBlocked = () => setSoundBlocked(true);
    return () => {
      socket.close();
      socketRef.current = null;
      audio.stopLines();
      audio.setRoomTone(false);
    };
  }, [code, demo, audio]);

  // Escape closes the evidence board, then the past rounds, like any pop-up.
  useEffect(() => {
    if (evidence === null && !pastRounds) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (evidence !== null) setEvidence(null);
      else setPastRounds(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [evidence, pastRounds]);

  const showCameraView = useCallback((on: boolean) => {
    cameraViewRef.current = on;
    setCameraView(on);
    socketRef.current?.send({ t: 'camera_view', on });
  }, []);
  useEffect(() => {
    if (!cameraView || evidence !== null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && showCameraView(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cameraView, evidence, showCameraView]);

  const enableSound = () => {
    audio.unlock();
    setSoundOn(true);
    setSoundBlocked(false);
  };
  const send = (t: 'start_round' | 'end_round') => {
    // Starting a round is a click, which is what browsers need before they play sound.
    if (t === 'start_round') enableSound();
    setEvidence(null);
    setPastRounds(false);
    socketRef.current?.send({ t });
  };
  const inRound = !!game && game.phase !== 'lobby';
  // Someone who left still has a name on the verdict.
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? knownNames.current.get(id) ?? 'Someone';
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
    // Only players who were in the round get a role; anyone who joined since sits it out.
    role:
      revealed && revealed.scores.some((s) => s.playerId === p.id) ? (p.id === revealed.imposterId ? 'imposter' : 'innocent') : undefined,
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

  // In the lobby, the empty seats take one more slot in the lineup (a replay has no seats to fill).
  const openSeats = inRound || demo ? 0 : MAX_PLAYERS - players.length;
  const headH = headBox?.height ?? 150;
  const gap = narrow ? 16 : TEXT_GAP;
  const reserved: Reserved = inRound
    ? {
        left: 0,
        top: (stageBox?.bottom ?? viewport.h * 0.32) + gap,
        bottom: dockBox ? viewport.h - dockBox.top + 16 : 24,
      }
    : narrow
      ? // The join panel stacks at the top on a phone, so the faces go under it.
        { left: 0, top: (panelBox?.bottom ?? viewport.h * 0.5) + gap, bottom: 24 }
      : { left: (panelBox?.right ?? 0) + 40, top: TOP_BAR_H + headH + TEXT_GAP, bottom: 24 };
  const area = stageArea(viewport, reserved);
  const slots = layoutSuspects(suspects.length + (openSeats > 0 ? 1 : 0), area, inRound, viewport.h, narrow);
  // On a phone the top bar can wrap, so the round's text starts under wherever it ends.
  const overlayStyle = narrow && barBox ? ({ '--stage-top': `${Math.round(barBox.bottom + 12)}px` } as CSSProperties) : undefined;
  /** One line for the camera view on where the game is. */
  const cameraStatus = () => {
    if (!inRound) return players.length === 0 ? 'Lobby' : `Lobby · ${players.length} ${players.length === 1 ? 'phone' : 'phones'}`;
    if (turn) return `${name(turn.playerId)} ${turn.stage === 'asking' ? 'is being asked' : 'is answering'}`;
    if (game.phase === 'deal') return 'The deal';
    if (game.phase === 'verdict')
      return verdictShown ? `The detective accuses ${name(verdict.accusedId)}` : 'The detective is deliberating';
    return 'Round in progress';
  };

  // "The lineup." sits just above the faces, centred over them.
  const facesTop = slots.length > 0 ? Math.min(...slots.map((s) => s.faceY - s.faceH / 2)) : area.y;
  const headX = area.x + area.w / 2;
  const headY = Math.max(TOP_BAR_H - 8, facesTop - headH - TEXT_GAP);

  return (
    <main className="host-stage">
      <Room
        suspects={suspects}
        slots={slots}
        focus={focus}
        activeId={activeId}
        calibrating={game?.phase === 'baseline'}
        paused={cameraView}
      />
      <SuspectCards suspects={suspects} slots={slots} openSeats={openSeats} activeId={activeId} moment={moment} />

      <div className="overlay" style={overlayStyle}>
        <header className={`top-bar ${inRound ? 'round' : ''}`} ref={barRef}>
          {inRound && demo ? (
            // A replay has nobody to join, so the chip says what's playing instead.
            <aside className="join-chip replay" aria-label="Recorded round">
              <span className="join-chip-text">
                <span className="wordmark">DEADPAN</span>
                <span className="join-chip-code">Replay.</span>
                <span className="join-chip-status">
                  Room {code} · round {demo}
                </span>
              </span>
            </aside>
          ) : inRound ? (
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
            <span className="wordmark">DEADPAN</span>
          )}
          <nav className="top-actions" aria-label="Round controls">
            {!inRound && (
              <span className="open-tag">
                <span className={`live-dot ${connected ? '' : 'bad'}`} />
                {demo ? `Recorded round · room ${code}` : connected ? `Room ${code} is open` : 'Reconnecting…'}
              </span>
            )}
            {/* Blocked playback needs a click even after sound was turned on once. */}
            {((!soundOn && inRound) || soundBlocked) && (
              <button className={`btn ${revealed || !inRound ? 'glass' : 'gold'}`} onClick={enableSound}>
                Turn on sound
              </button>
            )}
            {!inRound && !demo && !narrow && (
              <button className="btn glass" onClick={() => setPastRounds(true)}>
                Past rounds
              </button>
            )}
            {/* Too small to read on a phone. */}
            {!narrow && (
              <button className="btn glass" onClick={() => showCameraView(true)}>
                Camera view
              </button>
            )}
            {!inRound && demo && back && (
              <a className="btn glass" href={back.href}>
                {back.label}
              </a>
            )}
            {inRound && game.phase !== 'verdict' && (
              <button className="btn glass" onClick={() => send('end_round')}>
                {demo ? 'Stop replay' : 'End round'}
              </button>
            )}
            {/* After the reveal the corner holds what's next, keeping the faces clear. */}
            {revealed && (
              <>
                <button className="btn gold" onClick={() => setEvidence({ room: code, round: revealed.round })}>
                  See the evidence
                </button>
                {/* In demo mode "Play again" already replays it. */}
                {!demo && (
                  <a className="btn glass" href={`/host/${code}?demo=${revealed.round}&from=${code}`}>
                    Replay round
                  </a>
                )}
                <button className="btn glass" onClick={() => send('start_round')}>
                  Play again
                </button>
                {!narrow && (
                  <button className="btn glass" onClick={() => send('end_round')}>
                    Lobby
                  </button>
                )}
              </>
            )}
          </nav>
        </header>

        {!inRound && demo && (
          <section className="lobby-panel demo" ref={panelRef} aria-label="Demo mode">
            <p className="eyebrow">Demo mode</p>
            <p className="demo-title">A recorded round.</p>
            <p className="demo-text">
              Room {code}, round {demo}, played back from its saved file: the faces, the signals and the detective's voice, exactly as they
              happened.
            </p>
            <span className="panel-rule" />
            <p className="suspect-count">{players.length === 0 ? 'Loading the recording…' : `${players.length} suspects`}</p>
            <button className="btn gold" disabled={players.length === 0} onClick={() => send('start_round')}>
              Play the round
            </button>
          </section>
        )}

        {!inRound && (
          <>
            {!demo && (
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
                  <p className="stage-banner">
                    Phones can't reach localhost. Open this page through the https tunnel link so the QR code works.
                  </p>
                )}
              </section>
            )}
            <div
              className="lineup-head"
              ref={headRef}
              style={{ transform: `translate(${headX.toFixed(1)}px, ${headY.toFixed(1)}px) translateX(-50%)` }}
            >
              <h1 className="lineup-title">The lineup.</h1>
              <p className="lineup-sub">
                {demo
                  ? 'Press play to watch the round.'
                  : players.length === 0
                    ? 'Scan the code to join.'
                    : 'Start the round when everyone is in.'}
              </p>
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

      {cameraView && (
        <CameraView players={players} activeId={activeId} status={cameraStatus()} replay={!!demo} onClose={() => showCameraView(false)} />
      )}

      {pastRounds && (
        <PastRounds room={code} onEvidence={(room, round) => setEvidence({ room, round })} onClose={() => setPastRounds(false)} />
      )}

      {evidence !== null && (
        <div className="board-backdrop" onClick={(e) => e.target === e.currentTarget && setEvidence(null)}>
          <EvidenceBoard room={evidence.room} round={evidence.round} onClose={() => setEvidence(null)} />
        </div>
      )}
    </main>
  );
}
