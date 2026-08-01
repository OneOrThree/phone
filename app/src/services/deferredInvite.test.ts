// deferredInvite.ts 유닛 테스트 — 계약 정본은 초대 링크 스펙 §4-2 ③·§7-5.
//
// 이 서비스가 틀리면 조용히 두 가지가 깨진다:
//  1) 완료 플래그를 너무 일찍 세우면(네트워크 실패에도) 설치 직후 단 한 번뿐인 매치 기회를 날린다.
//  2) 직접 링크(Universal Link)로 이미 들어온 유저에게 서버 매치 결과를 덮어씌우면
//     방금 누른 초대장이 엉뚱한 그룹으로 바뀐다 — 레이스는 **직접 링크가 항상 이긴다**.
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  claimStoredInviteAttribution,
  getStoredInviteAttribution,
  markInviteAttributionClaimed,
  runDeferredInviteMatchOnce,
} from './deferredInvite';
import { notifyGroupInvite, peekPendingInvite } from '@/navigation/navigationRef';
import { claimInviteLink } from '@/services/inviteLinkApi';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('@/services/api', () => ({ API_URL: 'https://api.test' }));

jest.mock('@/services/inviteLinkApi', () => ({ claimInviteLink: jest.fn(async () => {}) }));

jest.mock('@/services/analytics', () => ({
  getDeviceId: jest.fn(async () => 'device-1'),
  getAppInstanceId: jest.fn(async () => 'inst-1'),
}));

jest.mock('@/navigation/navigationRef', () => ({
  notifyGroupInvite: jest.fn(),
  peekPendingInvite: jest.fn(() => null),
}));

const mockPost = jest.spyOn(axios, 'post');
const mockPeek = peekPendingInvite as jest.MockedFunction<typeof peekPendingInvite>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const SLUG = 'ab23cd45';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockPeek.mockReturnValue(null);
});

describe('runDeferredInviteMatchOnce', () => {
  test('완료 플래그가 있으면 네트워크를 호출하지 않는다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.deferredInviteChecked, '1');

    await runDeferredInviteMatchOnce();

    expect(mockPost).not.toHaveBeenCalled();
  });

  // 직접 링크가 이미 이겼다 — 서버 매치는 확률적(IP+OS)이라 여기서 덮으면 확실한 정보를
  // 불확실한 정보로 바꾸는 셈이다. 플래그만 세워 다음 실행에서 또 묻지 않게 한다.
  test('직접 링크가 이미 버퍼에 있으면 match 없이 플래그만 세운다', async () => {
    mockPeek.mockReturnValue({ groupId: GROUP_ID, slug: SLUG, entry: 'link' });

    await runDeferredInviteMatchOnce();

    expect(mockPost).not.toHaveBeenCalled();
    expect(notifyGroupInvite).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.deferredInviteChecked)).toBe('1');
  });

  test('matched=true면 attribution 저장 + deferred 초대를 버퍼에 넣는다', async () => {
    mockPost.mockResolvedValue({ data: { matched: true, slug: SLUG, groupId: GROUP_ID } });

    await runDeferredInviteMatchOnce();

    expect(mockPost).toHaveBeenCalledWith(
      'https://api.test/l/match',
      { os: 'ios', deviceId: 'device-1', appInstanceId: 'inst-1' },
      expect.anything(),
    );
    expect(notifyGroupInvite).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      slug: SLUG,
      entry: 'deferred',
    });
    expect(await getStoredInviteAttribution()).toEqual({
      slug: SLUG,
      groupId: GROUP_ID,
      claimed: false,
    });
    expect(await AsyncStorage.getItem(STORAGE_KEYS.deferredInviteChecked)).toBe('1');
  });

  test('matched=false여도 완료 플래그는 세운다(재조회 금지)', async () => {
    mockPost.mockResolvedValue({ data: { matched: false } });

    await runDeferredInviteMatchOnce();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.deferredInviteChecked)).toBe('1');
    expect(notifyGroupInvite).not.toHaveBeenCalled();
    expect(await getStoredInviteAttribution()).toBeNull();
  });

  // 설치 직후 셀룰러 전환·서버 순단이면 첫 호출이 실패한다. 여기서 플래그를 세우면
  // 3시간 창 안에 남은 유일한 기회를 영영 잃는다 — 다음 실행에서 반드시 다시 시도해야 한다.
  test('네트워크 실패면 플래그를 남기지 않는다(다음 실행 재시도)', async () => {
    mockPost.mockRejectedValue(new Error('network'));

    await runDeferredInviteMatchOnce();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.deferredInviteChecked)).toBeNull();
    expect(notifyGroupInvite).not.toHaveBeenCalled();
  });

  // 서버가 matched=true인데 필수 필드를 빠뜨린 경우 — 시트를 열 수 없으므로 초대로 취급하지 않는다.
  // (플래그는 세운다: 서버 응답은 정상 수신됐고, 같은 클릭은 이미 소진돼 재조회해도 결과가 같다.)
  test('matched=true라도 slug·groupId가 없으면 초대로 취급하지 않는다', async () => {
    mockPost.mockResolvedValue({ data: { matched: true } });

    await runDeferredInviteMatchOnce();

    expect(notifyGroupInvite).not.toHaveBeenCalled();
    expect(await getStoredInviteAttribution()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.deferredInviteChecked)).toBe('1');
  });

  // 앱 시작 경로가 두 번 도는 경우(재마운트·핫리로드)에도 요청은 한 번만 나가야 한다.
  test('같은 실행에서 동시에 두 번 불려도 요청은 한 번만 나간다', async () => {
    mockPost.mockResolvedValue({ data: { matched: false } });

    await Promise.all([runDeferredInviteMatchOnce(), runDeferredInviteMatchOnce()]);

    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('attribution 보관', () => {
  test('claim 마킹은 저장된 attribution의 claimed만 뒤집는다', async () => {
    mockPost.mockResolvedValue({ data: { matched: true, slug: SLUG, groupId: GROUP_ID } });
    await runDeferredInviteMatchOnce();

    await markInviteAttributionClaimed();

    expect(await getStoredInviteAttribution()).toEqual({
      slug: SLUG,
      groupId: GROUP_ID,
      claimed: true,
    });
  });

  test('저장된 값이 없으면 claim 마킹은 아무 것도 만들지 않는다', async () => {
    await markInviteAttributionClaimed();
    expect(await getStoredInviteAttribution()).toBeNull();
  });

  // 구 버전 잔재·부분 기록으로 깨진 JSON이 남아도 읽기가 던지면 앱 시작이 막힌다.
  test('저장값이 깨져 있으면 null로 흘린다', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.inviteAttribution, '{oops');
    expect(await getStoredInviteAttribution()).toBeNull();
  });
});

// 로그인/가입 직후 1회 — auth.ts(postAuthSave)가 부르는 지점의 계약(스펙 §2-3 ③·§4-2 ④).
describe('claimStoredInviteAttribution', () => {
  const mockClaim = claimInviteLink as jest.MockedFunction<typeof claimInviteLink>;

  async function storeAttribution(claimed: boolean): Promise<void> {
    await AsyncStorage.setItem(
      STORAGE_KEYS.inviteAttribution,
      JSON.stringify({ slug: SLUG, groupId: GROUP_ID, claimed }),
    );
  }

  test('미claim 초대가 있으면 slug로 1회 호출하고 claimed를 세운다', async () => {
    await storeAttribution(false);

    await claimStoredInviteAttribution();

    expect(mockClaim).toHaveBeenCalledWith(SLUG);
    expect(await getStoredInviteAttribution()).toEqual({
      slug: SLUG,
      groupId: GROUP_ID,
      claimed: true,
    });
  });

  test('이미 claim된 초대는 다시 호출하지 않는다(재로그인마다 반복 금지)', async () => {
    await storeAttribution(true);

    await claimStoredInviteAttribution();

    expect(mockClaim).not.toHaveBeenCalled();
  });

  test('복원한 초대가 없으면 아무 것도 하지 않는다(대다수 유저의 경로)', async () => {
    await claimStoredInviteAttribution();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  // 어트리뷰션 때문에 로그인이 막히면 안 된다 — 실패는 삼키고 claimed도 세우지 않는다(재시도 여지).
  test('claim 실패는 던지지 않고 claimed도 세우지 않는다', async () => {
    await storeAttribution(false);
    mockClaim.mockRejectedValueOnce(new Error('network'));

    await expect(claimStoredInviteAttribution()).resolves.toBeUndefined();
    expect((await getStoredInviteAttribution())?.claimed).toBe(false);
  });
});
