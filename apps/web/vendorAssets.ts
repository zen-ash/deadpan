// Self-hosts the wasm runtimes and models the phone needs (MediaPipe, onnxruntime, Silero VAD).
// They're served byte-for-byte from versioned /vendor/ paths: MediaPipe loads its wasm loader
// as a classic <script>, so it must not go through Vite's module pipeline. The build also
// writes a gzipped copy of each file, which the server sends to browsers that accept gzip.
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';
import type { VendorPaths } from './src/vendorPaths';

export const VENDOR_CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.task': 'application/octet-stream',
};

/** Works out the versioned URLs and the files behind them. */
export function vendorFiles(webRoot: string): { paths: VendorPaths; files: Map<string, string> } {
  const modules = resolve(webRoot, 'node_modules');
  const version = (pkg: string) =>
    (JSON.parse(readFileSync(resolve(modules, pkg, 'package.json'), 'utf8')) as { version: string }).version;

  const paths: VendorPaths = {
    mediapipe: `/vendor/mediapipe-${version('@mediapipe/tasks-vision')}/`,
    faceModel: '/vendor/models/face_landmarker-float16-v1.task',
    vad: `/vendor/vad-web-${version('@ricky0123/vad-web')}/`,
    ort: `/vendor/ort-${version('onnxruntime-web')}/`,
  };

  const files = new Map<string, string>([
    [paths.faceModel, resolve(webRoot, 'assets/face_landmarker.task')],
  ]);
  for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
    files.set(paths.mediapipe + name, resolve(modules, '@mediapipe/tasks-vision/wasm', name));
  }
  for (const name of ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx']) {
    files.set(paths.vad + name, resolve(modules, '@ricky0123/vad-web/dist', name));
  }
  for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    files.set(paths.ort + name, resolve(modules, 'onnxruntime-web/dist', name));
  }
  return { paths, files };
}

export function vendorAssets(files: Map<string, string>): Plugin {
  const gzipped = new Map<string, Buffer>();

  return {
    name: 'deadpan-vendor-assets',

    configureServer(server) {
      // Registered directly (not returned), so it runs before Vite's own middleware.
      server.middlewares.use((req, res, next) => {
        const file = files.get((req.url ?? '').split('?')[0]!);
        if (!file) return next();
        res.setHeader('Content-Type', VENDOR_CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Vary', 'Accept-Encoding');
        if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
          let body = gzipped.get(file);
          if (!body) {
            body = gzipSync(readFileSync(file), { level: 6 });
            gzipped.set(file, body);
          }
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Length', body.length);
          res.end(body);
          return;
        }
        res.setHeader('Content-Length', statSync(file).size);
        createReadStream(file).pipe(res);
      });
    },

    generateBundle() {
      for (const [url, file] of files) {
        const source = readFileSync(file);
        const fileName = url.slice(1);
        this.emitFile({ type: 'asset', fileName, source });
        this.emitFile({ type: 'asset', fileName: `${fileName}.gz`, source: gzipSync(source, { level: 9 }) });
      }
    },
  };
}
