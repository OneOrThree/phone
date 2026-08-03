// 스크린타임 권한 상태의 콜드런치 quirk 보정 검증.
//
// 배경: iOS AuthorizationCenter.authorizationStatus 는 앱이 막 뜬 직후, 실제로는 승인된 상태인데도
// 'notDetermined' 를 돌려줄 때가 있다. 그대로 믿으면 홈 '핸드폰 사용' 칸이 권한 켜기 안내로 바뀐다.
//
// 여기서 잠그는 것:
//  1) 확정 답('approved'/'denied')은 그대로 신뢰하고 승인 이력 캐시를 갱신한다.
//  2) 'notDetermined' 인데 승인 이력이 있으면 quirk 로 보고 'approved' 로 보정한다.
//  3) 승인 이력이 없으면 'notDetermined' 그대로 — 진짜 최초 유저에게 권한 안내가 정상 노출된다.
//  4) 권한 요청에서 거부되면 캐시를 지워, 보정이 옛 승인에 눌러앉지 않는다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

import { STORAGE_KEYS } from '@/types/storage';

import type ScreenTimeModuleType from './ScreenTimeModule';

// 안드로이드 Expo 모듈이 잡히면 iOS 경로를 안 타므로 없는 것으로 둔다(이 테스트는 iOS 경로 전용).
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

const native = {
  getAuthorizationStatus: jest.fn(),
  requestAuthorization: jest.fn(),
};

// 대상 모듈은 import 시점에 NativeModules.ScreenTimeModule 핸들을 캡처한다 —
// 스텁을 먼저 꽂은 뒤에 require 해야 한다(정적 import 로는 늦는다).
let ScreenTimeModule: typeof ScreenTimeModuleType;

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  (NativeModules as unknown as Record<string, unknown>).ScreenTimeModule = native;
  ScreenTimeModule = require('./ScreenTimeModule').default;
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// markAuthGranted 는 지연을 줄이려 await 하지 않는다 — 마이크로태스크 한 바퀴를 흘려 기록을 확정시킨다.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const grantedHistory = () => AsyncStorage.getItem(STORAGE_KEYS.screentimeAuthGranted);

describe('getAuthorizationStatus', () => {
  it('approved 는 그대로 통과하고 승인 이력을 남긴다', async () => {
    native.getAuthorizationStatus.mockResolvedValue('approved');

    await expect(ScreenTimeModule.getAuthorizationStatus()).resolves.toBe('approved');

    await flush();
    await expect(grantedHistory()).resolves.toBe('1');
  });

  it('승인 이력이 있는데 notDetermined 가 오면 콜드런치 quirk 로 보고 approved 로 보정한다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeAuthGranted, '1');
    native.getAuthorizationStatus.mockResolvedValue('notDetermined');

    await expect(ScreenTimeModule.getAuthorizationStatus()).resolves.toBe('approved');
  });

  it('승인 이력이 없으면 notDetermined 를 그대로 돌려준다(진짜 최초 유저)', async () => {
    native.getAuthorizationStatus.mockResolvedValue('notDetermined');

    await expect(ScreenTimeModule.getAuthorizationStatus()).resolves.toBe('notDetermined');
  });

  it('denied 가 오면 승인 이력을 지운다 — 설정에서 끈 경우 보정이 눌러앉지 않게', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeAuthGranted, '1');
    native.getAuthorizationStatus.mockResolvedValue('denied');

    await expect(ScreenTimeModule.getAuthorizationStatus()).resolves.toBe('denied');

    await flush();
    await expect(grantedHistory()).resolves.toBeNull();
  });
});

describe('requestAuthorization', () => {
  // 온보딩 권한 스텝은 승인되면 곧장 측정 대상 picker 로 넘어가 getAuthorizationStatus 를 부르지
  // 않는다 — 여기서 기록해두지 않으면 그 유저의 다음 콜드런치에서 보정이 못 걸린다(코드리뷰 반영).
  it('승인되면 승인 이력을 남긴다', async () => {
    native.requestAuthorization.mockResolvedValue(true);

    await expect(ScreenTimeModule.requestAuthorization()).resolves.toBe(true);

    await flush();
    await expect(grantedHistory()).resolves.toBe('1');
  });

  it('거부되면 승인 이력을 지운다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.screentimeAuthGranted, '1');
    native.requestAuthorization.mockResolvedValue(false);

    await expect(ScreenTimeModule.requestAuthorization()).resolves.toBe(false);

    await flush();
    await expect(grantedHistory()).resolves.toBeNull();
  });
});
