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
    drainWatchCommands: jest.fn(() =>
      Promise.resolve([cmd(), cmd({ commandId: 'c2', type: 'end' })]),
    ),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['c1', 'c2']);
  expect(out[0]).toMatchObject({ type: 'start', protocolVersion: 1, subjectId: 's1' });
});

test('깨진 JSON·필수 필드 누락은 버리고 **ack로 확정 폐기**한다 — 나머지는 살린다', async () => {
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({
    drainWatchCommands: jest.fn(() =>
      Promise.resolve([
        '{not json',
        JSON.stringify({ type: 'start', protocolVersion: 1 }), // commandId 없음
        JSON.stringify({ commandId: 'c9', protocolVersion: 1 }), // type 없음
        JSON.stringify({ commandId: 'c8', type: 'end' }), // protocolVersion 없음(스키마 깨짐)
        cmd({ commandId: 'ok' }),
      ]),
    ),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
    ackWatchCommands: ackFn,
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['ok']);
  // 빼기만 하면 네이티브 claimed에 영원히 남아 매 드레인마다 되살아난다(codex 리뷰 2차).
  // id를 건질 수 있는 것만 ack — 깨진 JSON은 네이티브 ack가 정리한다.
  expect(ackFn).toHaveBeenCalledWith(['c9', 'c8']);
});

test('버전 불일치는 실행하지 않되 **ack하지 않고 보존**한다 — 호환 번들이 처리하게', async () => {
  // 파싱 실패와 달리 버전 불일치는 「이 번들이 못 읽을 뿐」이다. ack해 버리면 네이티브 v1이
  // claim한 뒤 OTA로 JS만 올라간 스큐에서, 워치가 이미 아웃박스를 비운 영속 end의 유일한
  // 종료 시각이 사라진다 — PRD가 「이 거절은 ack가 아니다」로 못박은 계약(codex 3차).
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({
    drainWatchCommands: jest.fn(() =>
      Promise.resolve([
        cmd({ commandId: 'other-ver', type: 'end', protocolVersion: 2 }),
        cmd({ commandId: 'v1' }),
      ]),
    ),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
    ackWatchCommands: ackFn,
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['v1']); // 실행 대상에선 빠진다
  expect(ackFn).not.toHaveBeenCalled(); // 폐기 대상이 아니다 — claimed에 보존된다
});

test('킬스위치 재평가(이중 평가): start만 걸러내고 end·pause·resume은 통과', async () => {
  const ackFn = jest.fn(() => Promise.resolve());
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
    ackWatchCommands: ackFn,
  });
  const out = await drainWatchCommands();
  // end까지 막으면 워치 아웃박스의 종료가 갇혀 폰 세션·실드를 못 닫는다(R16 3차 개정)
  expect(out.map((c) => c.commandId)).toEqual(['end1', 'pause1', 'resume1']);
  // 차단한 start는 **확정 폐기**한다 — 안 그러면 킬스위치가 꺼진 뒤 사고 대응 중 막았던
  // 세션이 뒤늦게 시작된다(codex 리뷰 2차).
  expect(ackFn).toHaveBeenCalledWith(['start1']);
});

test('드레인이 실패해도 던지지 않는다 — 부팅 복구를 막지 않는다', async () => {
  setNative({
    drainWatchCommands: jest.fn(() => Promise.reject(new Error('bridge dead'))),
  });
  await expect(drainWatchCommands()).resolves.toEqual([]);
});

test('킬스위치 조회 실패: start는 보류(보존)하고 나머지는 통과 — 「해제」로 추정하지 않는다', async () => {
  // 1라운드엔 fail-open(차단 없이 진행)으로 고정했지만, 사고 대응 중 새로 차단돼야 할
  // start가 라우터로 흘러갈 수 있다는 지적이 맞다(codex 5차). 보류해도 명령은 claimed에
  // 남아 다음 드레인에서 재평가되므로 잃지 않는다.
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({
    drainWatchCommands: jest.fn(() =>
      Promise.resolve([cmd({ commandId: 's1', type: 'start' }), cmd({ commandId: 'e1', type: 'end' })]),
    ),
    getWatchKillSwitch: jest.fn(() => Promise.reject(new Error('no group'))),
    ackWatchCommands: ackFn,
  });
  const out = await drainWatchCommands();
  expect(out.map((c) => c.commandId)).toEqual(['e1']); // start만 보류
  expect(ackFn).not.toHaveBeenCalled(); // 폐기가 아니다 — 보존된다
});

test('식별 불가 깨진 레코드가 있으면 id가 없어도 네이티브 청소를 태운다', async () => {
  // 지목할 id가 없다고 ack를 건너뛰면 claimed에 영구 잔존하며 매 기동마다 드레인된다
  // (codex 5차 — 혼합 입력 테스트가 다른 id 덕에 문제를 가리고 있었다).
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({
    drainWatchCommands: jest.fn(() => Promise.resolve(['{not json', '{"type":"end"}'])),
    getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
    ackWatchCommands: ackFn,
  });
  const out = await drainWatchCommands();
  expect(out).toEqual([]);
  expect(ackFn).toHaveBeenCalledWith([]); // 빈 배열이어도 호출 — 네이티브 필터가 잔재를 청소
});

test('ack: 처리 확인한 명령 id만 네이티브에 넘긴다 — 확인 전까지 재배달 대상으로 남는다', async () => {
  // 드레인이 네이티브에서 지우지 않고 claim만 하므로(브릿지 무효화·프로세스 종료 창의 유실
  // 방지), 실제로 소비한 것만 ack로 확정해야 한다(codex 리뷰 #695).
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({ ackWatchCommands: ackFn });
  await ackWatchCommands(['c1', 'c2']);
  expect(ackFn).toHaveBeenCalledWith(['c1', 'c2']);
});

test('ack: 빈 배열도 네이티브에 넘긴다(잔재 청소) — 구 바이너리만 no-op', async () => {
  // 빈 호출에서 조기 반환하면 commandId를 못 건지는 깨진 레코드가 claimed에 영구 잔존한다
  // (codex 5차). 네이티브 ack의 필터가 그 잔재를 함께 청소한다.
  const ackFn = jest.fn(() => Promise.resolve());
  setNative({ ackWatchCommands: ackFn });
  await ackWatchCommands([]);
  expect(ackFn).toHaveBeenCalledWith([]);

  setNative({}); // ack 메서드를 모르는 구 바이너리
  await expect(ackWatchCommands(['c1'])).resolves.toBeUndefined();
});

test('ack 실패는 던지지 않는다 — 부팅 복구를 막지 않는다', async () => {
  setNative({ ackWatchCommands: jest.fn(() => Promise.reject(new Error('bridge dead'))) });
  await expect(ackWatchCommands(['c1'])).resolves.toBeUndefined();
});

describe('만료 폐기(§4.3)', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  test('만료된 start·pause·resume은 실행 목록에서 빼고 확정 폐기한다', async () => {
    // 네이티브의 만료 축출은 대기열 포화 때만 돈다 — 정상 대기열에서 만료된 명령이 그대로
    // 배달되면 라우터가 이미 워치에서 포기한 start로 세션·실드를 켠다(codex 리뷰 4차).
    const ackFn = jest.fn(() => Promise.resolve());
    setNative({
      drainWatchCommands: jest.fn(() =>
        Promise.resolve([
          cmd({ commandId: 'old-start', type: 'start', expiresAt: past }),
          cmd({ commandId: 'old-pause', type: 'pause', expiresAt: past }),
          cmd({ commandId: 'live', type: 'start', expiresAt: future }),
        ]),
      ),
      getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
      ackWatchCommands: ackFn,
    });
    const out = await drainWatchCommands();
    expect(out.map((c) => c.commandId)).toEqual(['live']);
    expect(ackFn).toHaveBeenCalledWith(['old-start', 'old-pause']);
  });

  test('end는 만료로 폐기하지 않는다 — 늦은 종료도 issuedAt으로 정확히 정산된다', async () => {
    // 만료로 버리면 유일한 정확한 종료가 사라져 세션·실드가 계속 남고 적립이 이어진다(§4.3).
    const ackFn = jest.fn(() => Promise.resolve());
    setNative({
      drainWatchCommands: jest.fn(() =>
        Promise.resolve([cmd({ commandId: 'late-end', type: 'end', expiresAt: past })]),
      ),
      getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
      ackWatchCommands: ackFn,
    });
    const out = await drainWatchCommands();
    expect(out.map((c) => c.commandId)).toEqual(['late-end']);
    expect(ackFn).not.toHaveBeenCalled();
  });

  test('expiresAt이 파싱 불가면 만료로 보지 않는다 — 판정 불가로 명령을 잃지 않는다', async () => {
    setNative({
      drainWatchCommands: jest.fn(() =>
        Promise.resolve([cmd({ commandId: 'weird', type: 'pause', expiresAt: 'not-a-date' })]),
      ),
      getWatchKillSwitch: jest.fn(() => Promise.resolve(false)),
      ackWatchCommands: jest.fn(() => Promise.resolve()),
    });
    const out = await drainWatchCommands();
    expect(out.map((c) => c.commandId)).toEqual(['weird']);
  });
});
