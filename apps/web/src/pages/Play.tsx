import { MAX_NAME_LENGTH, type PlayerInfo } from '@deadpan/shared';
import { useEffect, useRef, useState } from 'react';
import { diagnoseMediaError, micLevel, startPhoneMedia, trackOk, type MediaFailure, type PhoneMedia } from '../lib/media';
import { RoomSocket } from '../lib/socket';

type Stage = 'setup' | 'starting' | 'live' | 'error';
interface Health {
  cam: boolean;
  mic: boolean;
}

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
  const meterRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<RoomSocket | null>(null);
  const mediaRef = useRef<PhoneMedia | null>(null);
  // Set when the player first taps start; from then on every (re)connect sends a join.
  const joinNameRef = useRef<string | null>(null);
  const healthRef = useRef<Health>({ cam: false, mic: false });

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
            setRtt(Date.now() - msg.c);
            break;
          case 'error':
            setServerError(msg.message);
            break;
        }
      },
    });
    socketRef.current = socket;
    const ping = setInterval(() => socket.send({ t: 'ping', c: Date.now() }), 2000);
    return () => {
      clearInterval(ping);
      socket.close();
      socketRef.current = null;
    };
  }, [code]);

  useEffect(() => () => mediaRef.current?.stop(), []);

  // While live: watch the camera, mic and audio context, report changes, and draw the mic meter.
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

    const buffer = new Float32Array(analyser.fftSize);
    let peakDb = -Infinity;
    let frame = requestAnimationFrame(function draw() {
      const db = 20 * Math.log10(micLevel(analyser, buffer) + 1e-8);
      peakDb = Math.max(peakDb, db);
      const fill = Math.min(1, Math.max(0, (db + 60) / 50)); // -60 dB empty, -10 dB full
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${fill})`;
      frame = requestAnimationFrame(draw);
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

  const me = players.find((p) => p.id === playerId);
  const allOk = connected && health.cam && health.mic;

  return (
    <main className="phone">
      <header className="phone-bar">
        <span className="wordmark small">DEADPAN</span>
        <span className="room-tag">Room {code}</span>
        {stage === 'live' && <span className={`dot ${allOk ? 'ok' : 'bad'}`} aria-label={allOk ? 'All good' : 'Problem'} />}
      </header>

      {serverError && <p className="banner bad">{serverError}</p>}

      <div className={`preview ${stage === 'live' ? '' : 'hidden'}`}>
        <video ref={videoRef} playsInline muted autoPlay />
      </div>

      {(stage === 'setup' || stage === 'starting') && (
        <section className="setup">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            enterKeyHint="done"
            placeholder="e.g. Sam"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <button className="button primary huge" onClick={start} disabled={!name.trim() || stage === 'starting'}>
            {stage === 'starting' ? 'Starting…' : 'Tap to start'}
          </button>
          <p className="muted small">
            Uses your front camera and mic. Video never leaves your phone, only numbers do.
          </p>
        </section>
      )}

      {stage === 'error' && (
        <section className="setup">
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
          <button className="button primary" onClick={start}>
            Try again
          </button>
          <button className="button" onClick={() => location.reload()}>
            Reload page
          </button>
          {mediaError && <p className="muted small details">{mediaError.details}</p>}
        </section>
      )}

      {stage === 'live' && (
        <section className="live">
          <ul className="checks">
            <li className={health.cam ? 'ok' : 'bad'}>Camera</li>
            <li className={health.mic ? 'ok' : 'bad'}>Mic</li>
            <li className={connected ? 'ok' : 'bad'}>
              Server{rtt !== null && <span className="muted"> {rtt} ms</span>}
            </li>
          </ul>
          <div className="meter" aria-label="Mic level">
            <div ref={meterRef} className="meter-fill" />
          </div>
          <p>
            {me ? (
              <>
                You're in as <b>{me.name}</b>. {players.length} {players.length === 1 ? 'player' : 'players'} in the room.
              </>
            ) : (
              'Joining…'
            )}
          </p>
          {audioAsleep && health.cam && <p className="banner warn">Tap anywhere on the screen to start the mic.</p>}
          <p className="muted">Look at the big screen.</p>
          {(!health.cam || (!health.mic && !audioAsleep)) && (
            <button className="button" onClick={() => location.reload()}>
              Camera or mic stopped. Reload
            </button>
          )}
        </section>
      )}
    </main>
  );
}
