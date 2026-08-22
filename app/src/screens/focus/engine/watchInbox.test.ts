// 워치 인박스 JS 드레인 테스트 (GROMO-1600).
// 네이티브 목 + 시드 데이터로 능력 감지·파싱·킬스위치 재평가를 잠근다. 실 WCSession 수신은
// 워치 앱이 생기는 페이즈 1에서 실기기로 검증한다(여기서 덮을 수 없는 표면 — 명시 이연).

import { NativeModules, Platform } from 'react-native';
import { drainWatchCommands, ackWatchCommands } from './watchInbox';

const cmd = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    commandId: 'c1',
    type: 'start',
    protocolVersion: 1,
    issuedAt: '2026-08-22T10:00:00.000Z',
    subjectId: 's1',
    ...over,
  });

const setNative = (impl: Record<string, unknown> | undefined) => {
  (NativeModules as Record<string, unknown>).WatchSessionModule = impl;
};

beforeEach(() => {
  Platform.OS = 'ios';
  setNative(undefined);
});

test('네이티브 모듈이 없으면 빈 배열 — 구 바이너리·Android에서 조용히 no-op', async () => {
  setNative(undefined);
  await expect(drainWatchCommands()).resolves.toEqual([]);
});

test('drainWatchCommands 메서드가 없는 구 바이너리도 no-op — 능력 감지', async () => {
  // OTA로 갱신된 JS가 이 메서드를 모르는 바이너리와 만나는 조합(hot-updater 버전 스큐).
  setNative({ getPairingStatus: jest.fn() });
  await expect(drainWatchCommands()).resolves.toEqual([]);
});

test('적재된 명령을 파싱해 돌려준다', async () => {
  setNative({
    drainWatchCommands: jest.fn(() => Promise.resolve([cmd(), cmd({ commandId: 'c2', type: 'end' })])),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['c1', 'c2']);
  expect(out[0]).toMatchObject({ type: 'start', protocolVersion: 1, subjectId: 's1' });
});

test('깨진 JSON·필수 필드 누락은 버린다 — 나머지는 살린다', async () => {
  setNative({
    drainWatchCommands: jest.fn(() =>
      Promise.resolve([
        '{not json',
        JSON.stringify({ type: 'start', protocolVersion: 1 }), // commandId 없음
        JSON.stringify({ commandId: 'c9', protocolVersion: 1 }), // type 없음
        JSON.stringify({ commandId: 'c8', type: 'end' }), // protocolVersion 없음
        cmd({ commandId: 'ok' }),
      ]),
    ),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['ok']);
});

test('킬스위치 재평가(이중 평가): start만 걸러내고 end·pause·resume은 통과', async () => {
  // 네이티브가 수신 시점에 이미 평가하지만, 플래그가 갱신된 직후 이미 적재돼 있던 시작
  // 명령까지 막으려면 처리 직전 재평가가 필요하다(policy D13 2차 개정).
  setNative({
    drainWatchCommands: jest.fn(() =>
      Promise.resolve([
        cmd({ commandId: 'start1', type: 'start' }),
        cmd({ commandId: 'end1', type: 'end' }),
        cmd({ commandId: 'pause1', type: 'pause' }),
        cmd({ commandId: 'resume1', type: 'resume' }),
      ]),
    ),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(true)),
  });
  const out = await drainWatchCommands();
  // end까지 막으면 워치 아웃박스의 종료가 갇혀 폰 세션·실드를 못 닫는다(R16 3차 개정)
  expect(out.map((c) => c.commandId)).toEqual(['end1', 'pause1', 'resume1']);
});

test('드레인이 실패해도 던지지 않는다 — 부팅 복구를 막지 않는다', async () => {
  setNative({
    drainWatchCommands: jest.fn(() => Promise.reject(new Error('bridge dead'))),
  });
  await expect(drainWatchCommands()).resolves.toEqual([]);
});

test('킬스위치 조회가 실패하면 차단 없이 진행한다 — 조회 실패로 명령을 잃지 않는다', async () => {
  setNative({
    drainWatchCommands: jest.fn(() => Promise.resolve([cmd()])),
    getWatchKillSwitch: jest.fn(() => Promise.reject(new Error('no group'))),
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['c1']);
});

test('ack: 처리 확인한 명령 id만 네이티브에 넘긴다 — 확인 전까지 재배달 대상으로 남는다', async () => {
  // 드레인이 네이티브에서 지우지 않고 claim만 하므로(브릿지 무효화·프로세스 종료 창의 유실
  // 방지), 실제로 소비한 것만 ack로 확정해야 한다(codex 리뷰 #695).
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({ ackWatchCommands: ackFn });
  await ackWatchCommands(['c1', 'c2']);
  expect(ackFn).toHaveBeenCalledWith(['c1', 'c2']);
});

test('ack: 빈 배열·구 바이너리는 호출하지 않는다', async () => {
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({ ackWatchCommands: ackFn });
  await ackWatchCommands([]);
  expect(ackFn).not.toHaveBeenCalled();

  setNative({}); // ack 메서드를 모르는 구 바이너리
  await expect(ackWatchCommands(['c1'])).resolves.toBeUndefined();
});

test('ack 실패는 던지지 않는다 — 부팅 복구를 막지 않는다', async () => {
  setNative({ ackWatchCommands: jest.fn(() => Promise.reject(new Error('bridge dead'))) });
  await expect(ackWatchCommands(['c1'])).resolves.toBeUndefined();
});
