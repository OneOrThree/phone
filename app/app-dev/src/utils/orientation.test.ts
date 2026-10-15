import assert from 'node:assert/strict';
import { PORTRAIT_ROUTES, isPortraitRoute } from '@/utils/orientation';
import { Route } from '@/services/model';

// GROMO-1839 가로·세로 목록은 planning-document/policy-2026-09-14.md 「화면 방향」과 같아야 한다
const LANDSCAPE: Route[] = [
  'home',
  'visit',
  'explore',
  'guide',
  'focusSetup',
  'focusTravel',
  'fishingArrival',
  'focus',
  'rest',
  'focusResult',
  'returnTravel',
  'travel',
  'arrival',
  'hall',
  'manage',
  'members',
  'ledger',
  'construction',
  'board',
  'notice',
  'noticeEdit',
  'quest',
  'questEdit',
  'mail',
  'chat',
  'friendMail',
  'friends',
  'friendSearch',
  'shop',
  'product',
  'orders',
  'wardrobe',
  'boat',
  'profile',
  'settings',
  'permission',
  'sound',
  'library',
  'diary',
  'stats',
  'tower',
  // 다른 섬·낚시섬 구경도 같은 구경 계열이라 가로다
  'visitIsland',
  'visitIslandFocus',
  'focusVisit',
];

test('시작·가입 6개만 세로로 고정한다', () => {
  assert.deepEqual(
    [...PORTRAIT_ROUTES],
    ['login', 'character', 'chooseIsland', 'createIsland', 'joinIsland', 'approval'],
  );
  for (const route of PORTRAIT_ROUTES) assert.equal(isPortraitRoute(route), true, route);
});

test('가로 44개는 기기 방향을 따른다', () => {
  assert.equal(LANDSCAPE.length, 44);
  for (const route of LANDSCAPE) assert.equal(isPortraitRoute(route), false, route);
});

test('개발용 demo 는 세로 고정 대상이 아니다', () => {
  assert.equal(isPortraitRoute('demo'), false);
});
