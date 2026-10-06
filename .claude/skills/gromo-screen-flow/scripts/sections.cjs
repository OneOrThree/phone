// 흐름도 묶음(섹션) 정의 — 캡처 대상 분배와 피그마 배치가 함께 쓴다.
const fs = require('fs');
const path = require('path');
const os = require('os');

// 앱 폴더(app/app-dev): 환경변수 GROMO_APP → 스킬이 레포 안(.claude/skills/…)에 있으면 거기서 계산 → 오스카 기본 경로
const inRepo = __dirname.includes(path.join('.claude', 'skills'));
const APP = path.resolve(
  process.env.GROMO_APP || (inRepo ? path.join(__dirname, '../../../..', 'app/app-dev') : path.join(os.homedir(), 'soma/phone/app/app-dev')),
);
// 엉뚱한 폴더로 조용히 가지 않게: 앱 폴더가 아니면 바로 멈춘다
if (!fs.existsSync(path.join(APP, 'package.json'))) {
  console.error(`앱 폴더가 아닙니다: ${APP}\nGROMO_APP=<레포>/app/app-dev 로 알려 주세요.`);
  process.exit(1);
}
// 작업 폴더: 캡처·이동 지도·그림이 놓이는 곳. 스킬 폴더가 아니라 여기에 읽고 쓴다.
//   환경변수 WF_DIR → 오스카의 보관 폴더(~/soma/capture-catus, 있을 때만) → 레포의 gitignore 된 app/app-dev/.docs/screen-flow
const oscarArchive = path.join(os.homedir(), 'soma/capture-catus');
const ROOT = path.resolve(process.env.WF_DIR || (fs.existsSync(oscarArchive) ? oscarArchive : path.join(APP, '.docs/screen-flow')));
if (!process.env.WF_QUIET) console.error(`[작업 폴더] ${ROOT}`);

const SECTIONS = [
  { key: 'onboarding', title: '온보딩 — 앱 시작부터 첫 섬까지', routes: ['login', 'character', 'chooseIsland', 'createIsland', 'joinIsland', 'approval', 'arrival'] },
  { key: 'tutorial', title: '몽돌 튜토리얼 — 첫 만남부터 첫 집중 결과까지', routes: [] },
  { key: 'home', title: '홈 (섬)', routes: ['home'] },
  { key: 'focus', title: '집중 — 낚시섬 · 휴식 · 결과 · 축음기', routes: ['focusTravel', 'fishingArrival', 'focusSetup', 'focus', 'rest', 'focusResult', 'returnTravel', 'sound'] },
  { key: 'permission', title: '스크린타임 권한 · 측정 앱', routes: ['permission', 'screenTimeApps'] },
  { key: 'hall', title: '마을회관 — 섬 정보 · 가계부 · 건설', routes: ['hall', 'manage', 'ledger', 'construction'] },
  { key: 'board', title: '게시판 — 공지 · 퀘스트', routes: ['board', 'notice', 'noticeEdit', 'quest', 'questEdit'] },
  { key: 'library', title: '도서관 — 일기장', routes: ['library', 'diary'] },
  { key: 'tower', title: '전망대 · 다른 섬 구경', routes: ['tower', 'explore', 'visit', 'travel', 'visitIsland', 'focusVisit', 'visitIslandFocus'] },
  { key: 'mail', title: '우체통 · 친구 · 채팅', routes: ['mail', 'friendMail', 'friends', 'chat'] },
  { key: 'shop', title: '상점 — 상품 · 구매 내역', routes: ['shop', 'product', 'orders'] },
  { key: 'boat', title: '내 뗏목 — 옷장 · 프로필 · 설정', routes: ['boat', 'wardrobe', 'mainIsland', 'profile', 'settings', 'blockedUsers'] },
  { key: 'common', title: '공용 팝업', routes: ['guard'] },
];

// 묶음을 route 가 아니라 id 로 정하는 예외
const TUTORIAL_IDS = new Set([
  'guide', 'guide.line2', 'guide.line3', 'guide.line4', 'home.tutorialFocusStart',
  'fishingArrival.tutorial', 'focusSetup.tutorial', 'focus.tutorialIntro', 'focus.tutorialFirstFish',
  'focus.tutorialPause', 'rest.tutorial', 'focus.tutorialEnd', 'focus.tutorialEndConfirm',
  'focusResult.tutorial', 'home.hallGuide',
]);
const COMMON_IDS = new Set(['product.memberConversion', 'product.accountSwitchConfirm']);

const routeToSection = new Map();
for (const s of SECTIONS) for (const r of s.routes) routeToSection.set(r, s.key);

function sectionOf(node) {
  if (TUTORIAL_IDS.has(node.id) || node.id.startsWith('tutorial.')) return 'tutorial';
  if (COMMON_IDS.has(node.id)) return 'common';
  return routeToSection.get(node.route) || 'common';
}

function loadMerged() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'merged.json'), 'utf8'));
}

module.exports = { ROOT, APP, SECTIONS, TUTORIAL_IDS, sectionOf, loadMerged };
