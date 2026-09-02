// occupationCatalog 유닛 테스트(GROMO-1624) — 표시명 소스가 서버 하나임을 잠근다.
// 잠그는 규칙: ① 성공 응답은 로컬에 캐시된다 ② 조회 실패 시 그 캐시로 폴백한다
// ③ 서버가 내리지 않는 code는 숨긴다 ④ 아무 소스도 없으면 정적 폴백(한국어)이 최후를 막는다
// ⑤ 실패한 채 마운트된 훅도 나중 재시도 성공을 구독으로 받는다.
// 표시명은 i18n 키(shared.focusCategories.name.<CODE>)가 있으면 그쪽이 이기지만, 그 키는
// GROMO-1704 몫이라 아직 없다 — 지금은 서버 displayName·정적 폴백 경로만 잠근다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { getOccupations } from '@/services/userApi';
import { act, renderHook } from '@testing-library/react-native';
import {
  displayNameOf,
  loadOccupations,
  resetOccupationCache,
  useOccupations,
} from './occupationCatalog';

jest.mock('@/services/userApi', () => ({ getOccupations: jest.fn() }));
const mockGet = getOccupations as jest.Mock;

const CATALOG = [
  { code: 'CSAT' as const, displayName: '수능·N수', sortOrder: 1 },
  { code: 'CODING' as const, displayName: '코딩', sortOrder: 2 },
];

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  resetOccupationCache();
});

test('성공 응답을 로컬에 캐시한다', async () => {
  mockGet.mockResolvedValue(CATALOG);

  expect(await loadOccupations()).toEqual(CATALOG);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.occupations)).toBe(JSON.stringify(CATALOG));
});

test('조회 실패 시 마지막 성공 응답으로 폴백하고, 그 폴백을 메모리에 캐시한다', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.occupations, JSON.stringify(CATALOG));
  mockGet.mockRejectedValue(new Error('offline'));

  expect(await loadOccupations()).toEqual(CATALOG);
  // 캐시 안 하면 화면 마운트마다 실패할 요청을 다시 쏘고 타임아웃 동안 시험명이 깜빡인다
  // (PR 713 코덱스 리뷰). 두 번째 호출은 네트워크를 다시 치지 않는다.
  expect(await loadOccupations()).toEqual(CATALOG);
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test('조회도 캐시도 없으면 목록은 null', async () => {
  mockGet.mockRejectedValue(new Error('offline'));

  expect(await loadOccupations()).toBeNull();
});

test('표시명은 서버 displayName에서 온다 — i18n 키가 붙기 전까지(GROMO-1704)', () => {
  expect(displayNameOf(CATALOG, 'CSAT')).toBe('수능·N수');
});

test('카탈로그가 없어도 정적 폴백으로 표시명이 나온다 — 업데이트 직후 오프라인 첫 실행', () => {
  expect(displayNameOf(null, 'CSAT')).toBe('수능·N수');
});

test('실패한 채 마운트된 훅도 나중 재시도 성공을 구독으로 받는다', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline'));
  const { result } = await renderHook(() => useOccupations());
  await act(async () => {}); // 첫 조회 실패 소화 — list는 null 유지

  expect(result.current).toBeNull();

  mockGet.mockResolvedValue(CATALOG);
  await act(async () => {
    await loadOccupations(); // 다른 화면의 재시도 성공 재현
  });

  expect(result.current).toEqual(CATALOG); // 언마운트 없이 갱신(PR 713 코덱스 3R)
});

test('카탈로그를 받았는데 목록에 없는 code면 null — 서버가 안 내리는 시험은 안 그린다', () => {
  expect(displayNameOf(CATALOG, 'ETC')).toBeNull(); // CATALOG에 없는 code
});

test('code가 없으면 null', () => {
  expect(displayNameOf(CATALOG, null)).toBeNull();
});
