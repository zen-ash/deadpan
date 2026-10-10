import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WS_PATH } from '@deadpan/shared';
import { VENDOR_CONTENT_TYPES } from '../../apps/web/vendorAssets';
import { prewarm, serveLine, serveSfx } from './audio';
import { allCannedLines } from './lines';
import { createSocketServer } from './rooms';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = resolve(repoRoot, 'apps/web');
const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});
// The detective's lines and sound effects, played by the big screen.
app.get('/api/line/:file', (req, res) => void serveLine(req, res));
app.get('/api/sfx/:file', serveSfx);

const server = createServer(app);
const sockets = createSocketServer();

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === WS_PATH) sockets.handleUpgrade(req, socket, head);
  // In dev, Vite's HMR socket listens on the same server and takes the other upgrades.
  else if (isProd) socket.destroy();
});

let closeVite: (() => Promise<void>) | undefined;

if (isProd) {
  const dist = resolve(webRoot, 'dist');
  if (!existsSync(resolve(dist, 'index.html'))) {
    console.error(`No web build at ${dist}. Run "pnpm build" first.`);
    process.exit(1);
  }
  // Hashed bundles never change, so browsers can keep them forever.
  // Missing ones 404 instead of falling through to index.html.
  app.use('/assets', express.static(resolve(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));

  // Wasm runtimes and models live under versioned paths, so they're cached forever too. The
  // build writes a .gz next to each one, which cuts the phone download by roughly two thirds.
  const vendor = resolve(dist, 'vendor');
  app.use('/vendor', (req, res, next) => {
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) return next();
    const file = resolve(vendor, `.${decodeURIComponent(req.path)}`);
    if (!file.startsWith(vendor + sep) || !existsSync(`${file}.gz`)) return next();
    res.setHeader('Content-Type', VENDOR_CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(`${file}.gz`);
  });
  app.use('/vendor', express.static(vendor, { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(dist, { index: false }));
  // Every other GET is a client-side route: /, /host/:room, /play/:room, /replay/:room/:round.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(dist, 'index.html'));
  });
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    // tsx already handles TypeScript, so import the config directly. The default loader writes
    // a temp file next to it, which tsx watch sees and restarts on, forever.
    configLoader: 'native',
    appType: 'spa',
    server: { middlewareMode: true, ws: { server } },
  });
  app.use(vite.middlewares);
  closeVite = () => vite.close();
}

server.listen(port, () => {
  console.log(`Deadpan ${isProd ? 'production' : 'dev'} server on http://localhost:${port}`);
  // Fill the audio cache in the background; rounds can start straight away.
  void prewarm(allCannedLines());
});

async function shutdown() {
  setTimeout(() => process.exit(0), 1000).unref();
  for (const ws of sockets.wss.clients) ws.terminate();
  sockets.wss.close();
  server.close();
  await closeVite?.();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
