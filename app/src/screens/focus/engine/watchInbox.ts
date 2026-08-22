// 워치 명령 인박스 — JS 드레인 계층 (GROMO-1600, policy D2-④).
//
// 네이티브(WatchCommandInbox)가 WCSession 수신 시점에 킬스위치를 평가하고 App Group에
// 영속화하면, 여기서 부팅·복귀마다 읽어 간다. **이 티켓의 범위는 스켈레톤**이라 드레인한
// 명령은 실행하지 않고 폐기한다 — 라우팅 테이블 자리만 만들어 두고, 실제 실행은 페이즈 1
// (워치 앱)에서 붙인다. 지금 반쪽짜리 실행을 넣으면 워치가 없는 상태에서 검증할 수 없다.
//
// 킬스위치는 **두 겹으로 평가한다**(policy D13 2차 개정): ① 네이티브가 수신 시점에
// (JS가 어떤 번들로 부팅하든, 부팅 전이라도 차단) ② JS 엔진이 처리 직전에 다시. 아래
// 재평가가 그 두 번째 겹이다.

import { NativeModules, Platform } from 'react-native';

interface WatchSessionNative {
  drainWatchCommands?: () => Promise<string[]>;
  ackWatchCommands?: (commandIds: string[]) => Promise<void>;
  getWatchKillSwitch?: () => Promise<boolean>;
}

/**
 * 능력 감지 — OTA로 갱신된 JS가 이 메서드를 모르는 **구 바이너리**와 만날 수 있다
 * (hot-updater 버전 스큐). Android·web은 모듈 자체가 없어 자연히 no-op이다.
 * ScreenTimeModule의 `updateFocusActivity?.` 와 같은 관행.
 */
function nativeModule(): WatchSessionNative | null {
  if (Platform.OS !== 'ios') return null;
  return (NativeModules as { WatchSessionModule?: WatchSessionNative }).WatchSessionModule ?? null;
}

/**
 * 이 JS 번들이 이해하는 wire 버전. 네이티브 상수(kWatchProtocolVersion)와 **같은 값**이어야
 * 한다 — 다르면 OTA JS × 구 바이너리 조합에서 서로 다른 스키마를 주고받게 된다.
 */
export const WATCH_PROTOCOL_VERSION = 1;

export interface DrainedWatchCommand {
  commandId: string;
  type: string;
  protocolVersion: number;
  issuedAt?: string;
  expiresAt?: string | null;
  focusSessionId?: string | null;
  subjectId?: string | null;
}

/**
 * 파싱 결과는 세 갈래다 — **버전 불일치를 파싱 실패와 같이 취급하면 안 된다**(§4.3):
 * - `ok`: 이 번들이 실행할 수 있다
 * - `malformed`: 스키마가 깨졌다. 어떤 번들도 실행할 수 없으니 확정 폐기(ack)한다
 * - `versionMismatch`: 이 번들이 못 읽을 뿐이다. **ack하지 않고 보존**해 호환되는 번들이
 *   처리하게 한다 — PRD가 「이 거절은 ack가 아니므로 워치 아웃박스의 영속 end는 보존된다」로
 *   못박은 계약이다. 네이티브 v1이 claim한 뒤 OTA로 JS만 올라간 스큐에서 이걸 ack해 버리면,
 *   워치는 이미 아웃박스를 비운 뒤라 유일한 정확한 종료 시각이 사라진다.
 */
/**
 * 만료 폐기 대상(§4.3) — `end`는 여기 없다. 늦은 종료는 issuedAt 보존 경로로 정확히
 * 정산되므로, 만료로 폐기하면 오히려 세션이 계속 적립된다.
 */
const EXPIRABLE_TYPES = new Set(['start', 'pause', 'resume']);

/**
 * 처리 시점 만료 검사. 네이티브의 만료 축출은 **대기열이 포화됐을 때만** 돌므로 이걸
 * 대신하지 못한다 — 정상 대기열에서 만료된 명령이 그대로 배달되면, 라우터가 이미 워치에서
 * 포기한 start로 세션·실드를 켜거나 오래된 정지/재개를 적용한다.
 */
function isExpired(cmd: DrainedWatchCommand, now: number): boolean {
  if (!EXPIRABLE_TYPES.has(cmd.type)) return false;
  if (typeof cmd.expiresAt !== 'string' || !cmd.expiresAt) return false;
  const deadline = Date.parse(cmd.expiresAt);
  return Number.isFinite(deadline) && deadline < now;
}

type ParseResult =
  | { kind: 'ok'; command: DrainedWatchCommand }
  | { kind: 'malformed'; commandId: string | null }
  | { kind: 'versionMismatch' };

function parse(json: string): ParseResult {
  try {
    const raw = JSON.parse(json) as Partial<DrainedWatchCommand>;
    const commandId = typeof raw.commandId === 'string' && raw.commandId ? raw.commandId : null;
    if (typeof raw.protocolVersion === 'number' && raw.protocolVersion !== WATCH_PROTOCOL_VERSION) {
      return { kind: 'versionMismatch' };
    }
    if (commandId == null) return { kind: 'malformed', commandId: null };
    if (typeof raw.type !== 'string' || !raw.type) return { kind: 'malformed', commandId };
    if (raw.protocolVersion !== WATCH_PROTOCOL_VERSION) return { kind: 'malformed', commandId };
    return { kind: 'ok', command: raw as DrainedWatchCommand };
  } catch {
    return { kind: 'malformed', commandId: null };
  }
}

/**
 * 네이티브가 claim한 명령을 처리 완료로 확정한다 — 이 호출 전까지 명령은 보관되고 다음
 * 드레인에 재배달된다. **페이즈 1에서는 라우팅이 성공한 뒤에** 부르도록 옮긴다(지금은
 * 「처리 = 폐기」라 드레인 직후에 부른다).
 */
export async function ackWatchCommands(commandIds: string[]): Promise<void> {
  const native = nativeModule();
  if (typeof native?.ackWatchCommands !== 'function') return;
  await native.ackWatchCommands(commandIds).catch(() => {});
}

/**
 * 인박스를 드레인한다(네이티브는 지우지 않고 claim만 한다 — ack로 확정된다).
 * 킬스위치가 켜져 있으면 `start`는 여기서 한 번 더 걸러낸다(이중 평가) — 네이티브 플래그가
 * 갱신된 직후에 이미 적재돼 있던 시작 명령까지 막는다.
 *
 * 반환값은 **아직 아무도 실행하지 않는다** — 호출부(recoverFocusEngine)가 개수만 세고
 * 버린다. 실행 라우팅은 페이즈 1.
 */
export async function drainWatchCommands(): Promise<DrainedWatchCommand[]> {
  const native = nativeModule();
  if (typeof native?.drainWatchCommands !== 'function') return [];
  const raw = await native.drainWatchCommands().catch(() => [] as string[]);
  if (raw.length === 0) return [];

  // 3-상태다: true(차단) / false(해제) / null(조회 실패). **실패를 「해제」로 추정하지
  // 않는다** — 사고 대응 중 새로 차단돼야 할 start가 라우터로 흘러갈 수 있다. 대신 start만
  // 보류(claimed 보존)해 다음 드레인에서 재평가한다. 명령을 잃지는 않는다.
  const killSwitched: boolean | null =
    typeof native.getWatchKillSwitch === 'function'
      ? await native.getWatchKillSwitch().catch(() => null)
      : false;

  const usable: DrainedWatchCommand[] = [];
  // **폐기하는 것만 ack로 확정한다.** 반환 목록에서 빼기만 하면 네이티브 claimed에 영원히
  // 남아 킬스위치가 꺼진 뒤 차단했던 start가 뒤늦게 배달된다. 반대로 **보존해야 하는 것을
  // ack하면 영구 유실**이라(버전 불일치), 두 부류를 엄격히 가른다.
  const discarded: string[] = [];
  // commandId를 못 건진 깨진 레코드가 있으면, 지목할 id가 없어도 네이티브 청소를 태워야
  // 한다 — 안 그러면 claimed에 영구 잔존하며 매 기동마다 드레인된다.
  let hasUnidentifiable = false;
  const now = Date.now();
  raw.forEach((json) => {
    const result = parse(json);
    if (result.kind === 'versionMismatch') return; // 보존 — ack하지 않는다
    if (result.kind === 'malformed') {
      if (result.commandId) discarded.push(result.commandId);
      else hasUnidentifiable = true;
      return;
    }
    const cmd = result.command;
    // 만료분은 실행 목록에서 빼고 **확정 폐기**한다 — 워치는 이미 포기한 명령이라 보존할
    // 이유가 없고, 남겨 두면 매 드레인마다 되살아난다.
    if (isExpired(cmd, now)) {
      discarded.push(cmd.commandId);
      return;
    }
    // 킬스위치는 **신규 시작만** 막는다(R16 3차 개정) — end/pause/resume까지 막으면
    // 워치 아웃박스의 종료가 갇혀 폰 세션·실드를 닫을 길이 사라진다.
    if (cmd.type === 'start') {
      if (killSwitched === true) {
        discarded.push(cmd.commandId); // 차단 확정 — 확정 폐기
        return;
      }
      if (killSwitched === null) return; // 판정 불가 — 보류(보존), 다음 드레인에서 재평가
    }
    usable.push(cmd);
  });
  if (discarded.length > 0 || hasUnidentifiable) await ackWatchCommands(discarded);
  return usable;
}
