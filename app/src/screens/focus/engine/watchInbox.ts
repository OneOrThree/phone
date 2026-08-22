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

export interface DrainedWatchCommand {
  commandId: string;
  type: string;
  protocolVersion: number;
  issuedAt?: string;
  expiresAt?: string | null;
  focusSessionId?: string | null;
  subjectId?: string | null;
}

function parse(json: string): DrainedWatchCommand | null {
  try {
    const raw = JSON.parse(json) as Partial<DrainedWatchCommand>;
    if (typeof raw.commandId !== 'string' || !raw.commandId) return null;
    if (typeof raw.type !== 'string' || !raw.type) return null;
    if (typeof raw.protocolVersion !== 'number') return null;
    return raw as DrainedWatchCommand;
  } catch {
    return null;
  }
}

/**
 * 네이티브가 claim한 명령을 처리 완료로 확정한다 — 이 호출 전까지 명령은 보관되고 다음
 * 드레인에 재배달된다. **페이즈 1에서는 라우팅이 성공한 뒤에** 부르도록 옮긴다(지금은
 * 「처리 = 폐기」라 드레인 직후에 부른다).
 */
export async function ackWatchCommands(commandIds: string[]): Promise<void> {
  const native = nativeModule();
  if (typeof native?.ackWatchCommands !== 'function' || commandIds.length === 0) return;
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

  const killSwitched =
    typeof native.getWatchKillSwitch === 'function'
      ? await native.getWatchKillSwitch().catch(() => false)
      : false;

  return raw
    .map(parse)
    .filter((cmd): cmd is DrainedWatchCommand => cmd != null)
    // 킬스위치는 **신규 시작만** 막는다(R16 3차 개정) — end/pause/resume까지 막으면
    // 워치 아웃박스의 종료가 갇혀 폰 세션·실드를 닫을 길이 사라진다.
    .filter((cmd) => !(killSwitched && cmd.type === 'start'));
}
