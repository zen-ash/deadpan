// Camera, mic and screen wake lock for the phone, following the iOS rules in SPEC.md.

export interface PhoneMedia {
  stream: MediaStream;
  audioCtx: AudioContext;
  analyser: AnalyserNode;
  stop(): void;
}

/**
 * Call this directly from the "Tap to start" click handler, without awaiting anything first.
 * Everything before the first `await` runs synchronously inside the tap, which is what iOS
 * needs to let the AudioContext start.
 */
export async function startPhoneMedia(video: HTMLVideoElement): Promise<PhoneMedia> {
  // 1. Create and resume the AudioContext while we're still inside the user gesture.
  const audioCtx = new AudioContext();
  void audioCtx.resume();

  // 2. navigator.audioSession.type stays at its default. 'playback' is for media playback,
  //    and the phone records but never plays sound.

  // 3. One getUserMedia call for camera and mic together. A second call kills the first
  //    stream on iOS.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480, frameRate: 30 },
      audio: true,
    });
  } catch (err) {
    void audioCtx.close();
    throw err;
  }

  // iOS can suspend the context while it switches the audio session over to recording.
  const keepRunning = () => {
    if (audioCtx.state !== 'running' && audioCtx.state !== 'closed') void audioCtx.resume().catch(() => {});
  };
  keepRunning();
  audioCtx.addEventListener('statechange', keepRunning);
  document.addEventListener('pointerdown', keepRunning);

  // 4. Keep the screen awake.
  const wakeLock = new ScreenWakeLock();
  void wakeLock.acquire();

  // 5. Inline, muted, autoplaying preview. Set as properties and attributes, because iOS
  //    reads the attributes and React only sets the `muted` property.
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  video.srcObject = stream;
  await video.play().catch(() => {
    // Autoplay picks it up once the element is visible.
  });

  // Analysis only: nothing is connected to the speakers.
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  audioCtx.createMediaStreamSource(stream).connect(analyser);

  return {
    stream,
    audioCtx,
    analyser,
    stop() {
      audioCtx.removeEventListener('statechange', keepRunning);
      document.removeEventListener('pointerdown', keepRunning);
      wakeLock.release();
      for (const track of stream.getTracks()) track.stop();
      void audioCtx.close();
      video.srcObject = null;
    },
  };
}

/** A track counts as healthy while it's live, enabled and not muted by the OS. */
export function trackOk(track: MediaStreamTrack | undefined): boolean {
  return !!track && track.readyState === 'live' && track.enabled && !track.muted;
}

/** RMS level of the latest audio frame, from 0 to 1. */
export function micLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / buffer.length);
}

export interface MediaFailure {
  message: string;
  steps: string[];
  /** One line for bug reports, e.g. "NotAllowedError · Safari on iPhone · camera denied · mic prompt". */
  details: string;
}

/** Explains why getUserMedia failed, with fix-it steps for this phone's browser. */
export async function diagnoseMediaError(err: unknown): Promise<MediaFailure> {
  const name = err instanceof DOMException || err instanceof Error ? err.name : 'Error';
  const raw = err instanceof Error ? err.message : String(err);
  const browser = detectBrowser();
  const [camera, mic] = await Promise.all([permissionState('camera'), permissionState('microphone')]);
  const details = [`${name}: ${raw}`, browser.name, `camera ${camera}`, `mic ${mic}`].join(' · ');

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { message: 'The camera or mic was blocked.', steps: allowSteps(browser), details };
    case 'NotFoundError':
      return { message: 'No front camera or microphone was found.', steps: [], details };
    case 'NotReadableError':
    case 'AbortError':
      return {
        message: 'The camera or mic is busy.',
        steps: ['Close other apps or tabs using the camera (FaceTime, video calls), then tap Try again.'],
        details,
      };
    case 'OverconstrainedError':
      return { message: "This phone's camera doesn't support the requested settings.", steps: [], details };
    default:
      return { message: 'The camera or mic failed to start.', steps: [], details };
  }
}

interface BrowserInfo {
  name: string;
  ios: boolean;
  android: boolean;
  inApp: boolean;
  /** The app that owns the iOS camera permission, if it isn't Safari. */
  iosApp?: string;
}

function detectBrowser(ua = navigator.userAgent): BrowserInfo {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const inAppName = ua.match(/Instagram|FBAN|FBAV|FB_IAB|Snapchat|LinkedInApp|TikTok|musical_ly|Discord|Line\//)?.[0];
  if (inAppName) {
    const app = inAppName.startsWith('FB') ? 'Facebook' : inAppName.replace('/', '');
    return { name: `${app} in-app browser`, ios, android, inApp: true };
  }
  if (ios) {
    const app = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : /GSA\//.test(ua) ? 'Google' : undefined;
    return { name: `${app ?? 'Safari'} on iPhone`, ios, android, inApp: false, iosApp: app };
  }
  if (android) {
    const name = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox/.test(ua) ? 'Firefox' : 'Chrome';
    return { name: `${name} on Android`, ios, android, inApp: /; wv\)/.test(ua) };
  }
  return { name: 'Desktop browser', ios, android, inApp: false };
}

function allowSteps(browser: BrowserInfo): string[] {
  if (browser.inApp) {
    return [
      "This link opened inside another app's built-in browser, which can't use the camera.",
      browser.ios ? 'Copy the link and open it in Safari.' : 'Open the menu and choose "Open in browser" (Chrome).',
    ];
  }
  if (browser.ios && browser.iosApp) {
    return [
      `Open the iPhone Settings app → Apps → ${browser.iosApp} → turn on Camera and Microphone.`,
      'Come back here and reload the page.',
      'Or open the link in Safari instead.',
    ];
  }
  if (browser.ios) {
    return [
      'Tap the page menu in the address bar (aA or ⋯) → Website Settings → set Camera and Microphone to Allow, then reload.',
      'No prompt at all? Open the iPhone Settings app → Apps → Safari → Settings for Websites → set Camera and Microphone to Ask, then reload.',
    ];
  }
  if (browser.android) {
    return [
      'Tap the icon left of the address → Permissions → allow Camera and Microphone, then reload.',
      'Still blocked? Android Settings → Apps → your browser → Permissions → allow Camera and Microphone.',
    ];
  }
  return ['Allow camera and microphone for this site in your browser settings, then reload.'];
}

async function permissionState(name: 'camera' | 'microphone'): Promise<string> {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return 'unknown';
  }
}

/** Holds a screen wake lock, taking it back whenever the page becomes visible again. */
class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private pending = false;
  private released = false;

  private readonly onVisible = () => {
    if (document.visibilityState === 'visible' && !this.sentinel) void this.acquire();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVisible);
    // If the first request is refused for lack of a user gesture, the next tap retries.
    document.addEventListener('pointerdown', this.onVisible);
  }

  async acquire() {
    if (this.released || this.pending || !('wakeLock' in navigator)) return;
    this.pending = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (this.released) return void sentinel.release();
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      this.sentinel = null;
    } finally {
      this.pending = false;
    }
  }

  release() {
    this.released = true;
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('pointerdown', this.onVisible);
    void this.sentinel?.release();
    this.sentinel = null;
  }
}
