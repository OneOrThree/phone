import assert from 'node:assert/strict';
import { restoredRoute } from '@/services/restore';

test('서버 세션이 없고 로컬도 로그인 전이면 로그인 화면', () => {
  assert.equal(restoredRoute({ loggedIn: false, onboarded: false }, null), 'login');
});

test('서버 세션이 없으면 로컬 저장본대로 복구한다 (목업 흐름 유지)', () => {
  assert.equal(restoredRoute({ loggedIn: true, onboarded: false }, null), 'chooseIsland');
  assert.equal(restoredRoute({ loggedIn: true, onboarded: true }, null), 'home');
  assert.equal(
    restoredRoute({ loggedIn: true, onboarded: true, session: { status: 'running' } }, null),
    'focus',
  );
  assert.equal(
    restoredRoute({ loggedIn: true, onboarded: true, session: { status: 'paused' } }, null),
    'rest',
  );
});

test('서버가 세션을 거절하면 로컬이 로그인 상태여도 로그인 화면', () => {
  assert.equal(restoredRoute({ loggedIn: true, onboarded: true }, null, true), 'login');
  // 네트워크 오류로 «확인만» 못 한 경우는 거절이 아니다 — 오프라인 시작을 막지 않는다.
  assert.equal(restoredRoute({ loggedIn: true, onboarded: true }, null, false), 'home');
});

test('로컬 저장본이 없으면(iOS 재설치) 온보딩이 끝난 계정도 섬 선택부터다', () => {
  // 키체인 세션은 남고 AsyncStorage 만 사라진 상태. 앱 상태가 초기값이라 가입한 섬이 없어
  // 홈으로 보내면 홈이 막힌다.
  assert.equal(restoredRoute({}, { onboardingComplete: true }), 'chooseIsland');
  assert.equal(restoredRoute({}, { onboardingComplete: false }), 'character');
});

test('서버 세션이 있으면 온보딩 여부는 서버가 정본이다', () => {
  // 로컬은 온보딩을 마친 것처럼 보이지만 서버는 고양이·이름이 비었다고 한다.
  assert.equal(
    restoredRoute({ loggedIn: true, onboarded: true }, { onboardingComplete: false }),
    'character',
  );
  // 로컬 loggedIn 이 false 여도 서버 세션이 있으면 로그인 화면으로 되돌리지 않는다.
  assert.equal(
    restoredRoute({ loggedIn: false, onboarded: true }, { onboardingComplete: true }),
    'home',
  );
});
