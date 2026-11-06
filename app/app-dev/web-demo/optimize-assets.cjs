// 공개 웹 빌드(expo export 결과)의 이미지·동영상·글꼴을 웹용으로 다시 압축하고, 번들의 에셋 주소를 새 파일로 옮긴다.
// 네이티브 앱의 원본 에셋(src/assets)은 건드리지 않는다. 해상도를 유지해 번들에 박힌 width·height와 배치가 그대로다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

// 사진·삽화·스프라이트 시트는 손실 WebP로 줄인다. 투명도는 cwebp 기본값(alpha_q 100)으로 무손실이다.
// 스프라이트 시트는 프레임마다 투명 여백이 있어 잘라 쓸 때 옆 프레임 색이 번지지 않는다.
const LOSSY_WEBP = ['-q', '85', '-m', '6', '-sharp_yuv', '-mt'];
// 맞붙여 그리는 타일 지형은 이음매가 생기지 않도록 픽셀이 같은 무손실 WebP로만 바꾼다.
const LOSSLESS_WEBP = ['-lossless', '-z', '9', '-mt'];
const EXACT_PIXELS = /tileset/i;
// 1080×1920·30fps 컷신의 해상도를 유지하고 화질 계수만 낮춘다(원본 대비 SSIM 0.98 이상 실측).
const VIDEO = [
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '26',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
];
// 글꼴은 글리프를 그대로 두고 WOFF2로만 감싼다. expo-font 웹 로더가 format() 없이 @font-face를 만들어 주소만 바꾸면 된다.
const FONT = ['woff2'];
// 10% 넘게 줄지 않으면 원본을 그대로 쓴다.
const MIN_SAVING = 0.1;
const TARGET = /\.(png|jpe?g|mp4|ttf|otf)$/i;
const ASSET_URI = /"(\/assets\/[^"]+)"/g;
const HASHED_ASSET = /\.[0-9a-f]{32}\.[a-z0-9]+$/i;

const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');
// 캐시 키는 원본 내용·실제 인코더 인자·인코더 버전이다. 설정이나 도구 버전을 바꾸면 다시 인코딩한다.
const cacheKey = (data, args, version) =>
  crypto
    .createHash('sha256')
    .update(data)
    .update(JSON.stringify([args, version]))
    .digest('hex');

/** 도구가 없으면 설치 명령을 알리고 멈춘다. 있으면 버전 출력의 첫 줄을 돌려준다. */
function requireTool(name, args, hint) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  if (result.error)
    throw new Error(`${name}이(가) 필요합니다. ${hint}로 설치한 뒤 다시 빌드하세요.`);
  return `${result.stdout}`.split('\n')[0].trim();
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 실패(${code}): ${stderr.slice(-400)}`)),
    );
  });
}

/**
 * items를 limit개씩 동시에 처리한다. 하나가 실패하면 새 작업을 시작하지 않고,
 * 이미 돌고 있는 작업(인코더 자식 프로세스와 임시 파일 정리)이 끝난 뒤 첫 오류를 던진다.
 */
async function pool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index]);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw failure;
  return results;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function plan(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp4') return { mode: 'h264', tool: 'ffmpeg', outExt: '.mp4', args: VIDEO };
  if (ext === '.ttf' || ext === '.otf')
    return { mode: 'woff2', tool: 'woff2_compress', outExt: '.woff2', args: FONT };
  return EXACT_PIXELS.test(path.basename(file))
    ? { mode: 'webp-lossless', tool: 'cwebp', outExt: '.webp', args: LOSSLESS_WEBP }
    : { mode: 'webp', tool: 'cwebp', outExt: '.webp', args: LOSSY_WEBP };
}

// 인코딩 결과를 임시 파일에 쓴 뒤 캐시 이름으로 옮긴다. 실패하면 임시 파일을 지워 캐시에 남기지 않는다.
async function produce(file, { mode, outExt, args }, cached, cacheDir) {
  const temp = path.join(cacheDir, `${crypto.randomUUID()}.tmp`);
  const fontInput = temp + path.extname(file);
  try {
    if (mode === 'h264')
      await run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        file,
        ...args,
        temp + outExt,
      ]);
    else if (mode === 'woff2') {
      // woff2_compress는 입력 옆에 같은 이름의 .woff2를 쓴다.
      fs.copyFileSync(file, fontInput);
      await run('woff2_compress', [fontInput]);
    } else await run('cwebp', ['-quiet', ...args, file, '-o', temp + outExt]);
    fs.renameSync(temp + outExt, cached);
  } finally {
    fs.rmSync(temp + outExt, { force: true });
    fs.rmSync(fontInput, { force: true });
  }
}

async function encode(file, { cacheDir, versions, inflight }) {
  const input = fs.readFileSync(file);
  const job = plan(file);
  const cached = path.join(cacheDir, cacheKey(input, job.args, versions[job.tool]) + job.outExt);
  // 내용이 같은 원본(예: 같은 그림을 두 경로에서 require)은 한 번만 인코딩한다.
  // 빈 캐시 파일은 쓰다 만 것으로 보고 다시 인코딩한다.
  const reusable = fs.existsSync(cached) && fs.statSync(cached).size > 0;
  if (!inflight.has(cached))
    inflight.set(cached, reusable ? Promise.resolve() : produce(file, job, cached, cacheDir));
  await inflight.get(cached);
  const { mode, outExt } = job;
  return { file, mode, outExt, before: input.length, output: fs.readFileSync(cached) };
}

/**
 * 번들의 `"/assets/…/이름.<해시>.png"` 문자열 중 replacements에 있는 것만 새 주소로 바꾼다.
 * 내용이 바뀐 번들은 이름의 해시도 새 내용으로 바꾸고, 그 이름을 가리키는 다른 번들과 루트 HTML도 고친다.
 */
function rewriteReferences(outDir, replacements) {
  const jsDir = path.join(outDir, '_expo/static/js/web');
  const renames = new Map();
  const rewriteNames = (text) => {
    for (const [from, to] of renames) text = text.split(from).join(to);
    return text;
  };
  // 소스맵은 옛 번들 이름을 담고 있어 이름을 바꾸면 어긋난다. 지금 export는 소스맵을 내지 않는다.
  if (fs.readdirSync(jsDir).some((file) => file.endsWith('.map')))
    throw new Error('소스맵이 있는 웹 번들은 에셋 주소를 바꿀 수 없습니다.');
  const found = new Set();
  for (let round = 0, changed = true; changed; round++) {
    if (round > 10) throw new Error('JS 번들 이름 바꾸기가 끝나지 않습니다(순환 참조).');
    changed = false;
    // 이름순으로 처리해 실행마다 결과가 같게 한다.
    const bundles = fs
      .readdirSync(jsDir)
      .filter((file) => file.endsWith('.js'))
      .sort();
    for (const name of bundles) {
      const file = path.join(jsDir, name);
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('sourceMappingURL='))
        throw new Error(`소스맵을 가리키는 번들은 이름을 바꿀 수 없습니다: ${name}`);
      const next = rewriteNames(
        text.replace(ASSET_URI, (match, uri) => {
          const to = replacements.get(uri);
          if (!to) return match;
          found.add(uri);
          return `"${to}"`;
        }),
      );
      if (next === text) continue;
      const renamed = name.replace(/-[0-9a-f]{32}\.js$/, `-${md5(next)}.js`);
      if (renamed === name) throw new Error(`해시가 없는 번들 이름입니다: ${name}`);
      fs.writeFileSync(path.join(jsDir, renamed), next);
      fs.rmSync(file);
      renames.set(name, renamed);
      changed = true;
    }
  }
  // 새 파일마다 번들에서 원래 주소를 적어도 한 번 찾아 바꿨어야 한다. 못 찾으면 원본을 계속 받게 된다.
  const unused = [...replacements.keys()].filter((uri) => !found.has(uri));
  if (unused.length)
    throw new Error(
      `번들에서 찾지 못한 에셋 참조 ${unused.length}개: ${unused.slice(0, 5).join(', ')}`,
    );
  const htmlFiles = fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith('.html'))
    .map((file) => path.join(outDir, file));
  for (const file of htmlFiles) fs.writeFileSync(file, rewriteNames(fs.readFileSync(file, 'utf8')));
  // 바꾼 옛 주소가 다른 형태(작은따옴표·템플릿 문자열·`\/` 이스케이프)로 남아 있으면 그 화면은 원본을 계속 받는다.
  const leftovers = new Set();
  const texts = [
    ...fs
      .readdirSync(jsDir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => path.join(jsDir, file)),
    ...htmlFiles,
  ];
  for (const file of texts) {
    const text = fs.readFileSync(file, 'utf8').replaceAll('\\/', '/');
    for (const [uri] of text.matchAll(/\/assets\/[^"'`\s)]+/g))
      if (replacements.has(uri)) leftovers.add(uri);
  }
  if (leftovers.size)
    throw new Error(
      `바꾸지 못한 옛 에셋 주소 ${leftovers.size}개가 남았습니다: ${[...leftovers].slice(0, 5).join(', ')}`,
    );
  // 한 번들이 여러 라운드에 걸쳐 이름이 바뀔 수 있다(원래 → 중간 → 최종). 원래 이름 → 최종 이름으로 돌려준다.
  const intermediate = new Set(renames.values());
  const final = (name) => (renames.has(name) ? final(renames.get(name)) : name);
  return new Map(
    [...renames.keys()]
      .filter((name) => !intermediate.has(name))
      .map((name) => [name, final(name)]),
  );
}

/** 번들과 루트 HTML이 가리키는 에셋·번들이 모두 실제 파일인지 확인하고, 없는 것의 목록을 돌려준다. */
function findMissingReferences(outDir) {
  const jsDir = path.join(outDir, '_expo/static/js/web');
  const missing = [];
  const exists = (ref) => fs.existsSync(path.join(outDir, ref));
  for (const name of fs.readdirSync(jsDir).filter((file) => file.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(jsDir, name), 'utf8');
    for (const [, uri] of text.matchAll(ASSET_URI))
      if (HASHED_ASSET.test(uri) && !exists(uri)) missing.push(uri);
    for (const [ref] of text.matchAll(/_expo\/static\/js\/web\/[\w.-]+\.js/g))
      if (!exists(ref)) missing.push(ref);
  }
  for (const html of fs.readdirSync(outDir).filter((file) => file.endsWith('.html')))
    for (const [, ref] of fs
      .readFileSync(path.join(outDir, html), 'utf8')
      .matchAll(/src="\/([^"]+)"/g))
      if (!exists(ref)) missing.push(ref);
  return missing;
}

/**
 * outDir/assets 아래 PNG·JPEG·MP4·TTF를 줄인 사본으로 바꾸고 참조를 옮긴다.
 * 원본 파일은 지우지 않는다. 배포 직전에 열려 있던 탭이 옛 번들로 원본을 요청할 수 있다.
 */
async function optimizeWebAssets(outDir, { cacheDir, reportPath } = {}) {
  const versions = {
    cwebp: requireTool('cwebp', ['-version'], '`brew install webp`'),
    ffmpeg: requireTool('ffmpeg', ['-version'], '`brew install ffmpeg`'),
    // woff2_compress에는 버전 옵션이 없다. 글리프를 바꾸지 않는 무손실 변환이라 버전 차이의 영향이 없다.
    woff2_compress: requireTool('woff2_compress', [], '`brew install woff2`'),
  };
  cacheDir ??= path.join(outDir, '..', '.web-asset-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  // 앞선 빌드가 중단(Ctrl-C)돼 남긴 임시 파일을 지운다. 캐시 이름은 `.tmp`를 포함하지 않는다.
  for (const name of fs.readdirSync(cacheDir).filter((file) => file.includes('.tmp')))
    fs.rmSync(path.join(cacheDir, name), { force: true });

  const started = Date.now();
  const targets = walk(path.join(outDir, 'assets')).filter((file) => TARGET.test(file));
  const context = { cacheDir, versions, inflight: new Map() };
  const encoded = await pool(targets, Math.max(1, os.availableParallelism() - 1), (file) =>
    encode(file, context),
  );

  const replacements = new Map();
  const files = encoded.map((item) => {
    const oldUri = '/' + path.relative(outDir, item.file).split(path.sep).join('/');
    const smaller = item.output.length < item.before * (1 - MIN_SAVING);
    if (!smaller)
      return { uri: oldUri, to: null, mode: item.mode, before: item.before, after: item.before };
    // 이름의 해시를 새 내용으로 바꿔, 브라우저·CDN의 1년 캐시가 옛 내용과 섞이지 않게 한다.
    const stem = path.basename(item.file).replace(/\.[0-9a-f]{32}\.[^.]+$/i, '');
    const name = `${stem}.${md5(item.output)}${item.outExt}`;
    fs.writeFileSync(path.join(path.dirname(item.file), name), item.output);
    const newUri = path.posix.join(path.posix.dirname(oldUri), name);
    replacements.set(oldUri, newUri);
    return {
      uri: oldUri,
      to: newUri,
      mode: item.mode,
      before: item.before,
      after: item.output.length,
    };
  });

  rewriteReferences(outDir, replacements);
  const missing = findMissingReferences(outDir);
  if (missing.length) throw new Error(`없는 파일을 가리킵니다: ${missing.slice(0, 5).join(', ')}`);

  const sum = (key) => files.reduce((total, row) => total + row[key], 0);
  const summary = {
    files: files.length,
    replaced: replacements.size,
    before: sum('before'),
    after: sum('after'),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ summary, files }, null, 2) + '\n');
  return summary;
}

const formatSummary = (summary) => {
  const mb = (bytes) => (bytes / 1048576).toFixed(1) + 'MB';
  return `웹 에셋 ${summary.files}개 중 ${summary.replaced}개 교체: ${mb(summary.before)} → ${mb(summary.after)} (${summary.seconds}초)`;
};

module.exports = {
  optimizeWebAssets,
  rewriteReferences,
  findMissingReferences,
  pool,
  formatSummary,
};

if (require.main === module) {
  const [outDir, reportPath] = process.argv.slice(2);
  if (!outDir) {
    console.error('사용법: node web-demo/optimize-assets.cjs <expo export 폴더> [보고서.json]');
    process.exit(1);
  }
  optimizeWebAssets(path.resolve(outDir), { reportPath }).then(
    (summary) => console.log(formatSummary(summary)),
    (error) => {
      // process.exit 대신 종료 코드만 정해, 돌던 인코더가 끝나고 임시 파일이 정리된 뒤 끝나게 한다.
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
