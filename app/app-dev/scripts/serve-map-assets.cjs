#!/usr/bin/env node
// 맵 에셋 로컬 정적 서버 (GROMO-2233). 호스트 Nginx `/static/`(MV-D09)의 URL·캐시 헤더 계약을 흉내 낸다.
//   GET /static/maps/home/manifest.json      → Cache-Control: public, max-age=60 + ETag(내용 해시), If-None-Match 304
//   GET /static/maps/home/v<n>/<file>        → Cache-Control: public, max-age=31536000, immutable
// 사용: node scripts/serve-map-assets.cjs [--port 4300] [--root src/assets/village-world/v1] [--map-version 1]
//        [--fail manifest,tileset,layout]
// --map-version <n>: manifest 의 mapVersion 과 파일 URL 의 v<n>/ 만 바꾼다. 파일은 항상 --root 에서 그대로 읽으므로 디렉터리 이름과 무관하고,
//   내용이 같으면 해시도 같아 앱은 「새 버전」이 아니라 같은 파일의 버전 번호만 오른 것으로 본다(내용 변경은 --root 를 바꾼 복사본으로).
// 주의: 파일명에 해시가 없는 것은 10/9 단순화다 — 「같은 URL 의 내용은 불변」 보증은 v<n>/ 디렉터리에만 의존한다.
// --fail 은 해당 단계 응답을 500 으로 바꾼다(앱 폴백 테스트용): manifest | tileset(tileset@2x.png·tileset-night@2x.png) | layout(JSON 4종).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const port = Number(arg('port', 4300));
const root = path.resolve(arg('root', 'src/assets/village-world/v1'));
const fail = new Set(String(arg('fail', '')).split(',').filter(Boolean));
const MAP_ID = 'home';
const MAP_VERSION = Number(arg('map-version', 1));
const VERSION_DIR = `v${MAP_VERSION}`;
const FILES = [
  'tileset@2x.png',
  'tileset-night@2x.png',
  'tileset.json',
  'tilemap.json',
  'nav.json',
  'home.map.json',
];
const TYPES = { '.png': 'image/png', '.json': 'application/json' };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const stageOf = (name) => (name.endsWith('.png') ? 'tileset' : 'layout');

// 시작 시 한 번 읽어 메모리에 둔다 — 서버가 도는 동안 파일이 바뀌면 재시작.
const bodies = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, f))]));
const manifest = Buffer.from(
  JSON.stringify({
    mapId: MAP_ID,
    mapVersion: MAP_VERSION,
    files: Object.fromEntries(
      FILES.map((f) => [
        f,
        { path: `${VERSION_DIR}/${f}`, sha256: sha256(bodies[f]), bytes: bodies[f].length },
      ]),
    ),
  }),
);
const etag = `"${sha256(manifest).slice(0, 16)}"`;

const base = `/static/maps/${MAP_ID}/`;
const server = http.createServer((req, res) => {
  const send = (status, headers, body) => {
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${status}`);
  };
  let url;
  try {
    url = decodeURIComponent((req.url || '').split('?')[0]);
  } catch {
    return send(400, {}, 'bad request');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, {}, '');
  if (url === `${base}manifest.json`) {
    if (fail.has('manifest')) return send(500, {}, 'forced failure');
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) return send(304, headers, '');
    return send(200, { ...headers, 'Content-Length': manifest.length }, manifest);
  }
  if (url.startsWith(`${base}${VERSION_DIR}/`)) {
    const name = url.slice(`${base}${VERSION_DIR}/`.length);
    if (!FILES.includes(name)) return send(404, {}, 'not found');
    if (fail.has(stageOf(name))) return send(500, {}, 'forced failure');
    return send(
      200,
      {
        'Content-Type': TYPES[path.extname(name)],
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': bodies[name].length,
      },
      bodies[name],
    );
  }
  return send(404, {}, 'not found');
});
server.listen(port, '0.0.0.0', () =>
  console.log(
    `map-assets: http://0.0.0.0:${port}${base}manifest.json (root=${root}, fail=[${[...fail]}])`,
  ),
);
