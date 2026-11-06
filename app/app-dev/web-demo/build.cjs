const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build/web-demo');
const site = new URL(process.env.WEB_DEMO_SITE_URL || 'https://try.oneorthree.world/');
if (
  site.protocol !== 'https:' ||
  site.pathname !== '/' ||
  site.search ||
  site.hash ||
  site.username ||
  site.password
) {
  throw new Error('WEB_DEMO_SITE_URL은 경로·인증정보 없는 HTTPS 주소여야 합니다.');
}
// 로컬 .env나 앞선 네이티브 빌드 값이 공개 체험판에 섞이지 않도록 입력을 고정한다.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('EXPO_PUBLIC_')),
);
Object.assign(env, {
  EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_WEB_DEMO: '1',
  EXPO_PUBLIC_WEB_SHARED_ISLAND: process.env.WEB_SHARED_ISLAND_ENABLED === '1' ? '1' : '0',
  EXPO_PUBLIC_DEMO: '0',
  EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
  // 앱과 동일한 공개 수집 토큰만 별도로 전달한다. 개인 API 키는 입력받지 않는다.
  EXPO_PUBLIC_WEB_DEMO_POSTHOG_TOKEN:
    fs
      .readFileSync(path.join(root, 'src/services/posthog.ts'), 'utf8')
      .match(/'(phc_[A-Za-z0-9]+)'/)?.[1] ?? '',
  EXPO_PUBLIC_IMAGE_ASSETS_ENABLED: 'false',
  EXPO_PUBLIC_IMAGE_ASSETS_URL: '',
  EXPO_PUBLIC_ENV: 'prod',
  EXPO_PUBLIC_TERMS_VERSION: '2026-09',
  EXPO_PUBLIC_FOCUS_SEAT_ENABLED: '0',
  EXPO_PUBLIC_WEB_GOOGLE_LOGIN_ENABLED: process.env.WEB_GOOGLE_LOGIN_ENABLED === '1' ? '1' : '0',
});
if (!env.EXPO_PUBLIC_WEB_DEMO_POSTHOG_TOKEN)
  throw new Error('공개 PostHog 프로젝트 토큰을 확인하세요.');
fs.rmSync(out, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', out],
  { cwd: root, env, stdio: 'inherit' },
);
// 이미지·동영상·글꼴을 웹용으로 줄이고 번들 참조를 새 파일로 옮긴다. index.html의 번들 이름도 여기서 바뀐다.
// 압축 결과는 build/.web-asset-cache에 남겨 다음 빌드에서 다시 쓰고, 파일별 전후 크기는 배포 폴더 밖에 기록한다.
execFileSync(
  process.execPath,
  [path.join(__dirname, 'optimize-assets.cjs'), out, path.join(root, 'build/web-demo-assets.json')],
  { cwd: root, stdio: 'inherit' },
);
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' wss://${site.host} https://us.i.posthog.com https://accounts.google.com/gsi/`,
  "frame-src 'self' https://accounts.google.com/gsi/",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const title = '집중할고양 — 고양이로 함께 집중하는 섬';
const summary = '고양이가 되어 섬에서 함께 집중하고 낚시해요. 설치 없이 웹에서 시작하세요.';
const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
let html = fs
  .readFileSync(path.join(out, 'index.html'), 'utf8')
  .replace('<html lang="en">', '<html lang="ko">')
  .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
  .replace(
    'You need to enable JavaScript to run this app.',
    '체험하려면 JavaScript를 켜주세요. 집중할고양은 고양이로 섬을 산책하고 낚시하며 집중하는 앱입니다.',
  )
  .replace(
    '</head>',
    `
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}" />
<style id="public-web-viewport">
html, body, #root { width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
html { height: 100dvh; }
</style>
<meta name="description" content="${summary}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${summary}" />
<meta property="og:url" content="${escape(site.href)}" />
<meta property="og:image" content="${escape(new URL('og.jpg', site).href)}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="canonical" href="${escape(site.href)}" />
</head>`,
  );
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(
  path.join(out, 'experience.html'),
  html.replace('</head>', '<meta name="robots" content="noindex" /></head>'),
);
fs.writeFileSync(
  path.join(out, 'google-login.html'),
  html.replace('</head>', '<meta name="robots" content="noindex" /></head>'),
);
fs.copyFileSync(
  path.join(root, 'src/assets/reference-v2/L-home-05-final-shop.jpg'),
  path.join(out, 'og.jpg'),
);
fs.writeFileSync(
  path.join(out, 'robots.txt'),
  'User-agent: *\nAllow: /\nDisallow: /experience.html\nDisallow: /google-login.html\n',
);
const headers = [
  { key: 'Content-Security-Policy', value: csp + "; frame-ancestors 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Cloudflare가 외부 방문 통계 스크립트를 HTML에 자동 삽입하지 않도록 한다.
  { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate, no-transform' },
];
fs.writeFileSync(
  path.join(out, 'vercel.json'),
  JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      headers: [{ source: '/(.*)', headers }],
    },
    null,
    2,
  ) + '\n',
);
// Pages로 옮겨도 같은 보안 정책을 적용할 수 있다.
fs.writeFileSync(
  path.join(out, '_headers'),
  '/*\n' + headers.map(({ key, value }) => `  ${key}: ${value}`).join('\n') + '\n',
);
console.log(`공개 체험판: ${out}\n대표 주소: ${site.href}\n메타모아에는 제출하지 않았습니다.`);
