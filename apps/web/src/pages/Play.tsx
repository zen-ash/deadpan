import { MAX_NAME_LENGTH, type GameState, type PlayerInfo, type Verdict } from '@deadpan/shared';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { diagnoseMediaError, micLevel, startPhoneMedia, trackOk, type MediaFailure, type PhoneMedia } from '../lib/media';
import { RoomSocket } from '../lib/socket';
import { DebugOverlay } from '../phone/DebugOverlay';
import { loadFaceLandmarker } from '../phone/face';
import { GamePanel } from '../phone/GamePanel';
import { MicBars } from '../phone/MicBars';
import { PhoneSignals } from '../phone/signals';
import { TurnController } from '../phone/turns';
import { CheckIcon, Emblems, LockIcon, MicIcon } from '../ui';

type Stage = 'setup' | 'starting' | 'live' | 'error';
interface Health {
  cam: boolean;
  mic: boolean;
}
/** loading: the face tracker is still downloading. lost: no face for a moment. */
type FaceState = 'loading' | 'found' | 'lost' | 'failed';

const NAME_KEY = 'deadpan:name';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode: fine, we just won't remember it.
  }
}

export function Play({ code }: { code: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const mediaRef = useRef<PhoneMedia | null>(null);
  // Set when the player first taps start; from then on every (re)connect sends a join.
  const joinNameRef = useRef<string | null>(null);
  const healthRef = useRef<Health>({ cam: false, mic: false });
  const signalsRef = useRef<PhoneSignals | null>(null);
  const turnsRef = useRef<TurnController | null>(null);

  const [name, setName] = useState(loadName);
  const [stage, setStage] = useState<Stage>('setup');
  const [mediaError, setMediaError] = useState<MediaFailure | null>(null);
  const [serverError, setServerError] = useState('');
  const [connected, setConnected] = useState(false);
  const [rtt, setRtt] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [health, setHealth] = useState<Health>(healthRef.current);
  // iOS can pause the AudioContext when capture starts; the mic track still looks fine.
  const [audioAsleep, setAudioAsleep] = useState(false);
  const [signals, setSignals] = useState<PhoneSignals | null>(null);
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(location.search).get('debug') === '1');
  /** During a round only the health dot shows; tapping it shows the details. */
  const [showHealth, setShowHealth] = useState(false);
  const [faceState, setFaceState] = useState<FaceState>('loading');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  /** Width over height of the camera image: portrait on phones, landscape on most laptops. */
  const [videoAspect, setVideoAspect] = useState(3 / 4);
  const [game, setGame] = useState<GameState | null>(null);
  /** undefined until dealt; null means this player is the imposter. */
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [scribeStatus, setScribeStatus] = useState('off');

  // Start downloading the face tracker (~15 MB) while the player types their name.
  useEffect(() => {
    loadFaceLandmarker().catch(() => {});
  }, []);

  useEffect(() => {
    const socket = new RoomSocket({
      onOpen: () => {
        const joinName = joinNameRef.current;
        if (!joinName) return;
        socket.send({ t: 'join', room: code, name: joinName });
        socket.send({ t: 'status', ...healthRef.current });
      },
      onConnectedChange: (isConnected) => {
        setConnected(isConnected);
        if (!isConnected) setRtt(null);
      },
      onMessage: (msg) => {
        switch (msg.t) {
          case 'welcome':
            setPlayerId(msg.playerId);
            setServerError('');
            break;
          case 'room':
            setPlayers(msg.players);
            break;
          case 'pong':
            setRtt(socket.clock.rtt);
            break;
          case 'error':
            setServerError(msg.message);
            break;
          case 'state':
            setGame(msg);
            if (msg.phase === 'lobby' || msg.phase === 'baseline') {
              setSecret(undefined);
              setVerdict(null);
            }
            break;
          case 'secret':
            setSecret(msg.word);
            break;
          case 'verdict':
            setVerdict(msg);
            break;
          case 'scribe':
            turnsRef.current?.onScribe(msg.turnId, msg.url);
            break;
          case 'your_turn':
            turnsRef.current?.onYourTurn(msg.turnId);
            break;
          case 'turn_over':
            void turnsRef.current?.onTurnOver(msg.turnId);
            break;
        }
      },
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [code]);

  useEffect(() => () => mediaRef.current?.stop(), []);

  // Warn when the face has been out of view for more than a moment.
  useEffect(() => {
    if (!signals) return;
    let lastSeen = Date.now();
    const id = setInterval(() => {
      const tracker = signals.face;
      if (!tracker) {
        lastSeen = Date.now();
        setFaceState(signals.faceError ? 'failed' : 'loading');
        return;
      }
      if (tracker.face.present) lastSeen = Date.now();
      setFaceState(Date.now() - lastSeen > 1500 ? 'lost' : tracker.face.present ? 'found' : 'loading');
    }, 300);
    return () => clearInterval(id);
  }, [signals]);

  // Once the camera is live: analyse face and voice and stream them at 10 Hz.
  useEffect(() => {
    const media = mediaRef.current;
    const video = videoRef.current;
    if (stage !== 'live' || !media || !video) return;
    const vad = new URLSearchParams(location.search).get('vad') === 'rms' ? 'rms' : 'silero';
    const next = new PhoneSignals(
      video,
      media.audioCtx,
      media.analyser,
      media.stream,
      loadFaceLandmarker(),
      {
        send: (msg) => socketRef.current?.send(msg),
        sendBinary: (data) => socketRef.current?.sendBinary(data),
        toServer: (local) => socketRef.current?.clock.toServer(local) ?? local,
      },
      { vad },
    );
    const turns = new TurnController({
      audioCtx: media.audioCtx,
      stream: media.stream,
      send: (msg) => socketRef.current?.send(msg),
      toServer: (local) => socketRef.current?.clock.toServer(local) ?? local,
      voice: () => signalsRef.current?.voice ?? null,
      onScribeStatus: setScribeStatus,
    });
    signalsRef.current = next;
    turnsRef.current = turns;
    setSignals(next);
    return () => {
      next.stop();
      turns.dispose();
      signalsRef.current = null;
      turnsRef.current = null;
      setSignals(null);
    };
  }, [stage]);

  // While live: watch the camera, mic and audio context, report changes, and note the mic's peak.
  useEffect(() => {
    const media = mediaRef.current;
    if (stage !== 'live' || !media) return;
    const { audioCtx, analyser } = media;
    const tracks = [media.stream.getVideoTracks()[0], media.stream.getAudioTracks()[0]];

    const update = () => {
      const audioRunning = audioCtx.state === 'running';
      setAudioAsleep(!audioRunning);
      // The mic only counts as working if the audio we analyse is actually flowing.
      const next = { cam: trackOk(tracks[0]), mic: trackOk(tracks[1]) && audioRunning };
      const prev = healthRef.current;
      if (next.cam === prev.cam && next.mic === prev.mic) return;
      healthRef.current = next;
      setHealth(next);
      socketRef.current?.send({ t: 'status', ...next });
    };
    update();
    for (const track of tracks) {
      for (const type of ['mute', 'unmute', 'ended']) track?.addEventListener(type, update);
    }
    audioCtx.addEventListener('statechange', update);
    const poll = setInterval(update, 1000);

    setAnalyser(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let peakDb = -Infinity;
    let frame = requestAnimationFrame(function measure() {
      peakDb = Math.max(peakDb, 20 * Math.log10(micLevel(analyser, buffer) + 1e-8));
      frame = requestAnimationFrame(measure);
    });

    // One line in the server log so mic problems can be read from the laptop.
    const report = setTimeout(() => {
      const micRate = tracks[1]?.getSettings().sampleRate;
      socketRef.current?.send({
        t: 'diag',
        msg: `audio: context ${audioCtx.state} at ${audioCtx.sampleRate} Hz, mic ${micRate ?? '?'} Hz, peak ${peakDb.toFixed(1)} dBFS in first 4 s`,
      });
    }, 4000);

    return () => {
      clearInterval(poll);
      clearTimeout(report);
      cancelAnimationFrame(frame);
      audioCtx.removeEventListener('statechange', update);
      for (const track of tracks) {
        for (const type of ['mute', 'unmute', 'ended']) track?.removeEventListener(type, update);
      }
    };
  }, [stage]);

  // Must run from a real tap (not a keyboard submit), so iOS lets the AudioContext start.
  function start() {
    const trimmed = name.trim();
    const video = videoRef.current;
    if (!trimmed || !video || stage === 'starting') return;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMediaError({
        message: 'The camera only works over https.',
        steps: ['Open the https link instead.'],
        details: `insecure context: ${location.origin}`,
      });
      setStage('error');
      return;
    }

    // First thing in the tap: its synchronous part creates and resumes the AudioContext.
    const pending = startPhoneMedia(video);
    setStage('starting');
    setMediaError(null);
    saveName(trimmed);

    const joinNow = () => {
      if (joinNameRef.current) return;
      joinNameRef.current = trimmed;
      socketRef.current?.send({ t: 'join', room: code, name: trimmed });
    };
    pending.then(
      (media) => {
        mediaRef.current = media;
        setStage('live');
        joinNow();
      },
      async (err: unknown) => {
        const failure = await diagnoseMediaError(err);
        setMediaError(failure);
        setStage('error');
        joinNow();
        // Shows up in the server log, so phone problems can be debugged from the laptop.
        socketRef.current?.send({ t: 'diag', msg: `media failed: ${failure.details}` });
      },
    );
  }

  const serverNow = useCallback(() => socketRef.current?.clock.now() ?? Date.now(), []);
  const me = players.find((p) => p.id === playerId);
  const allOk = connected && health.cam && health.mic;
  const inRound = !!game && game.phase !== 'lobby' && !!playerId && game.roundPlayers.includes(playerId);
  const live = stage === 'live';
  const faceLost = faceState === 'lost';
  const faceText = { loading: 'Finding your face…', found: 'Face found', lost: 'Face not in view', failed: 'Face tracking failed' }[faceState];
  // The camera stays big through the round; at the verdict it steps aside for the result.
  const camMode = !live ? 'hidden' : !inRound ? 'big' : game.phase === 'verdict' ? 'strip' : 'round';

  // While waiting the checks sit over the bottom of the video; in a round, a row under the strip.
  const checks = (where: 'over-video' | 'row') => (
    <ul className={where === 'over-video' ? 'cam-checks' : 'checks round-checks'} aria-label="Device checks">
      <li>
        <span className="check-label">
          <CheckIcon ok={health.cam} />
          Camera
        </span>
        <span className={`check-value ${health.cam ? '' : 'bad'}`}>{health.cam ? 'Ready' : 'Off'}</span>
      </li>
      <li>
        <span className="check-label">
          <CheckIcon ok={health.mic} />
          Mic
        </span>
        <span className="check-value">{health.mic ? <MicBars analyser={analyser} /> : <span className="bad">Off</span>}</span>
      </li>
      <li>
        <span className="check-label">
          <CheckIcon ok={connected} />
          Server
        </span>
        <span className={`check-value ${connected ? '' : 'bad'}`}>{connected ? (rtt !== null ? `${rtt} ms` : 'Connected') : 'Offline'}</span>
      </li>
    </ul>
  );

  const problems = (
    <>
      {audioAsleep && health.cam && <p className="banner warn">Tap anywhere on the screen to start the mic.</p>}
      {(!health.cam || (!health.mic && !audioAsleep)) && (
        <button className="btn black stuck" onClick={() => location.reload()}>
          Camera or mic stopped. Reload
        </button>
      )}
    </>
  );

  return (
    <main className="phone">
      <header className="phone-bar">
        <span className="wordmark">DEADPAN</span>
        <span className="phone-bar-right">
          {/* Everything the phone measures, live: face, heart, voice and connection. */}
          {live && (
            <button className={`signals-btn ${showDebug ? 'on' : ''}`} onClick={() => setShowDebug((v) => !v)} aria-pressed={showDebug}>
              Signals
            </button>
          )}
          {live ? (
            <button
              className="room-tag"
              onClick={() => setShowHealth((v) => !v)}
              aria-label={`Room ${code}. ${allOk ? 'Camera, mic and connection OK' : 'Something needs attention'}`}
            >
              <span className={`dot ${allOk ? '' : 'bad'}`} />
              Room {code}
            </button>
          ) : (
            <span className="room-tag">Room {code}</span>
          )}
        </span>
      </header>

      {/* One video element for the whole session, so face tracking never restarts: a large preview
          while waiting, a big card during the round, and a strip at the verdict. */}
      <div className={`cam ${camMode}`}>
        <div className="cam-view" style={{ '--video-aspect': String(videoAspect) } as CSSProperties}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={(e) => e.currentTarget.videoHeight && setVideoAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
            onResize={(e) => e.currentTarget.videoHeight && setVideoAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
          />
          <span className="cam-chip">
            <span className={`dot ${faceState === 'found' ? '' : 'warn'}`} />
            {faceText}
          </span>
          <span className={`cam-mic-chip ${health.mic ? '' : 'bad'}`} aria-label={health.mic ? 'Mic on' : 'Mic off'}>
            <MicIcon />
          </span>
          {live && checks('over-video')}
        </div>
        <span className="cam-text">
          <span className="cam-text-main">On camera</span>
          <span className={`cam-text-sub ${faceState === 'found' ? '' : 'warn'}`}>
            <span className={`dot ${faceState === 'found' ? '' : 'warn'}`} />
            {faceText}
          </span>
        </span>
        <span className={`cam-mic ${health.mic ? '' : 'bad'}`}>
          <MicIcon />
          {health.mic ? 'Mic on' : 'Mic off'}
        </span>
      </div>

      {(stage === 'setup' || stage === 'starting') && (
        <section className="phone-main join-main">
          <Emblems small />
          <p className="eyebrow join-eyebrow">You’re joining</p>
          <h1 className="join-title">Room {code}.</h1>
          <p className="join-tagline">One of you is lying. The detective is listening.</p>
          {serverError && <p className="banner bad">{serverError}</p>}
          <div className="join-form">
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="nickname"
                enterKeyHint="done"
                placeholder="Ash"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </div>
            {/* Must stay a direct tap: iOS only grants the camera, mic and audio from a user gesture. */}
            <button className="btn black" onClick={start} disabled={!name.trim() || stage === 'starting'}>
              {stage === 'starting' ? 'Starting…' : 'Start camera and join'}
            </button>
          </div>
          <p className="note">
            <LockIcon size={18} />
            <span>Uses your front camera and mic. Video never leaves your phone, only numbers do.</span>
          </p>
        </section>
      )}

      {stage === 'error' && (
        <section className="phone-main">
          <h1 className="phone-title">Camera trouble.</h1>
          {mediaError && (
            <div className="banner bad">
              <p className="error-title">{mediaError.message}</p>
              {mediaError.steps.length > 0 && (
                <ol className="error-steps">
                  {mediaError.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          )}
          <button className="btn black stuck" onClick={start}>
            Try again
          </button>
          <button className="btn outline stuck" onClick={() => location.reload()}>
            Reload page
          </button>
          {mediaError && <p className="muted details stuck">{mediaError.details}</p>}
        </section>
      )}

      {live && !inRound && (
        <section className="phone-main waiting">
          {serverError && <p className="banner bad">{serverError}</p>}
          {problems}
          {me ? (
            <>
              <h1 className="phone-title waiting-title">You’re in, {me.name}.</h1>
              <p className="waiting-count">
                {players.length} {players.length === 1 ? 'suspect' : 'suspects'} in the room.
              </p>
              <p className="waiting-lead">
                {game && game.phase !== 'lobby' ? 'A round is in progress. You’ll play in the next one.' : 'Keep your eyes on the big screen.'}
              </p>
            </>
          ) : (
            <h1 className="phone-title waiting-title">Joining…</h1>
          )}
        </section>
      )}

      {live && inRound && game && (
        <>
          {(showHealth || !allOk) && checks('row')}
          <GamePanel
            code={code}
            game={game}
            playerId={playerId}
            players={players}
            secret={secret}
            verdict={verdict}
            serverNow={serverNow}
            faceLost={faceLost}
            analyser={analyser}
            onDone={(turnId) => turnsRef.current?.done(turnId)}
          >
            {serverError && <p className="banner bad">{serverError}</p>}
            {problems}
          </GamePanel>
        </>
      )}

      {signals && showDebug && <DebugOverlay signals={signals} scribe={scribeStatus} />}
    </main>
  );
}
