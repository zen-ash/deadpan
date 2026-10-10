// Test-only stand-in for the camera and mic (?fake=1), for checking the pipeline in a browser
// without camera access: a gently swaying portrait and a gated, gliding tone.

export async function createFakeStream(audioCtx: AudioContext): Promise<MediaStream> {
  const image = new Image();
  image.src = '/test/portrait.jpg';
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 640;
  const g = canvas.getContext('2d')!;
  const started = performance.now();
  const draw = () => {
    const t = (performance.now() - started) / 1000;
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width / 2 + Math.sin(t * 0.7) * 20, canvas.height / 2);
    g.rotate(Math.sin(t * 0.5) * 0.12);
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    g.drawImage(image, (-image.width * scale) / 2, (-image.height * scale) / 2, image.width * scale, image.height * scale);
    g.restore();
    requestAnimationFrame(draw);
  };
  draw();

  // 1.2 s of tone gliding 140→220 Hz, then 1.3 s of silence.
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const out = audioCtx.createMediaStreamDestination();
  osc.type = 'sawtooth';
  osc.connect(gain).connect(out);
  gain.gain.value = 0;
  osc.start();
  const pulse = () => {
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(220, now + 1.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.setValueAtTime(0, now + 1.2);
  };
  pulse();
  setInterval(pulse, 2500);

  return new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
}
