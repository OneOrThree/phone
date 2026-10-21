// 남의 고양이 외양 파서·병합(GROMO-2390)
import * as blocked from './blockedUsers';
import { lookOf, newerLook, parseAppearanceEvent, parseLook } from './memberAppearance';

const ev = (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  eventId: 'e1',
  schemaVersion: 1,
  type: 'member.appearance.updated',
  islandId: 'isl',
  aggregateVersion: 4,
  payload: {
    userId: 'u2',
    appearance: { head: 'h1', neck: null, shoes: null, clothes: 'c', version: 3 },
    version: 4,
    ...payload,
  },
  ...over,
});

test('parseLook — 키 없음·null 은 미착용, 객체가 아니면 모른다', () => {
  expect(parseLook({ head: 'h', version: 2 })).toEqual({
    head: 'h',
    neck: null,
    shoes: null,
    version: 2,
  });
  expect(parseLook(null)).toBeNull();
  expect(parseLook('x')).toBeNull();
});

test('newerLook — version 이 크면 교체, 같거나 작으면 유지, 없으면 새로 받은 쪽', () => {
  const v2 = parseLook({ head: 'a', version: 2 })!;
  const v3 = parseLook({ head: 'b', version: 3 })!;
  const none = parseLook({ head: 'c' })!;
  expect(newerLook(v2, v3)).toBe(v3);
  expect(newerLook(v3, v2)).toBe(v3);
  expect(newerLook(v3, parseLook({ head: 'x', version: 3 }))).toBe(v3);
  expect(newerLook(v3, none)).toBe(none);
  expect(newerLook(undefined, v2)).toBe(v2);
  expect(newerLook(v2, null)).toBe(v2);
});

test('parseAppearanceEvent — payload.version 을 쓰고 다른 섬·type·모양 불량은 버린다', () => {
  expect(parseAppearanceEvent(ev(), 'isl')).toEqual({
    userId: 'u2',
    look: { head: 'h1', neck: null, shoes: null, version: 4 },
  });
  expect(parseAppearanceEvent(ev(), 'other')).toBeNull();
  expect(parseAppearanceEvent(ev({ type: 'focus.emote' }), 'isl')).toBeNull();
  expect(parseAppearanceEvent(ev({}, { appearance: null }), 'isl')).toBeNull();
  expect(parseAppearanceEvent(ev({}, { userId: '' }), 'isl')).toBeNull();
});

test('lookOf — 스냅숏과 실시간 중 version 이 큰 쪽', () => {
  const snapshot = { catColor: 'black', appearance: { head: 'old', version: 2 } };
  expect(lookOf({ u: parseLook({ head: 'new', version: 3 })! }, 'u', snapshot)?.head).toBe('new');
  expect(lookOf({ u: parseLook({ head: 'stale', version: 1 })! }, 'u', snapshot)?.head).toBe('old');
  expect(lookOf({}, 'u', snapshot)?.head).toBe('old');
  expect(lookOf({}, 'u', undefined)).toBeUndefined();
});

test('lookOf — 가려진 주민(catColor null)·내가 차단한 사용자는 실시간 값을 무시한다', () => {
  const live = { u: parseLook({ head: 'leak', version: 9 })! };
  const masked = { catColor: null, appearance: { head: null, neck: null, version: 2 } };
  expect(lookOf(live, 'u', masked)?.head).toBeNull();
  const shown = { catColor: 'black', appearance: { head: 'old', version: 2 } };
  expect(lookOf(live, 'u', shown)?.head).toBe('leak');
  jest.spyOn(blocked, 'isUserBlocked').mockReturnValue(true);
  expect(lookOf(live, 'u', shown)?.head).toBe('old');
  jest.restoreAllMocks();
});
