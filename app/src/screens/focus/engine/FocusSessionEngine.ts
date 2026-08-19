// 집중 세션 엔진 (GROMO-1600 헤드리스화 2단계 — 골격).
//
// 세션 상태(SessionState)와 1초 틱의 소유권을 화면에서 가져온다. 화면은
// useSyncExternalStore로 구독하는 뷰가 된다. 이 단계에서 엔진은 아직 정산·이탈·
// 명령을 모른다 — 그 로직은 화면에 남아 setSession/replaceSession으로 상태를
// 갱신한다(후속 단계에서 순차 이관).
//
// ⚠️ 마운트당 인스턴스다(모듈 싱글턴 금지) — 이 저장소 jest 구성엔 resetModules가
//    없어 모듈 상태가 테스트 간 누수된다. 앱 싱글턴 전환은 페이즈 1(화면 없는 세션)
//    도입 때 재검토.

import { initialSessionState, nextTick, type SessionMachineConfig, type SessionState } from './machine';

export interface FocusEngineTickDeps {
  /** 일시정지 여부 — 정지 상태의 소유는 아직 화면(5단계에서 명령화) */
  isPaused(): boolean;
  /** 집중 tick(elapsed가 오른 tick)마다 호출 — 오늘 몫 적립(화면의 blockToday 소유, 4단계 이관) */
  onFocusTick(): void;
}

export interface FocusSessionEngine {
  subscribe(listener: () => void): () => void;
  getSession(): SessionState;
  /** 상태 교체 + 구독자 통지 — 기존 화면 setSession 대응 */
  setSession(next: SessionState): void;
  /**
   * 통지 없는 교체 — 기존 `sessionRef.current = next` 직접 대입 대응.
   * 리플레이 루프가 정산이 읽을 경계 시점 상태를 렌더 없이 선반영하는 자리다.
   */
  replaceSession(next: SessionState): void;
  startTicking(): void;
  stopTicking(): void;
}

export function createFocusSessionEngine(
  config: SessionMachineConfig,
  deps: FocusEngineTickDeps,
): FocusSessionEngine {
  let session = initialSessionState(config);
  const listeners = new Set<() => void>();
  let interval: ReturnType<typeof setInterval> | null = null;
  const notify = () => listeners.forEach((l) => l());

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession: () => session,
    setSession(next) {
      session = next;
      notify();
    },
    replaceSession(next) {
      session = next;
    },
    // 1초 tick — 세션 생명주기 동안 유지, 일시정지·완료 시엔 진행만 멈춤(화면 원본 :491-503).
    startTicking() {
      if (interval != null) return;
      interval = setInterval(() => {
        if (deps.isPaused()) return;
        const prev = session;
        if (prev.done) return;
        const next = nextTick(config, prev);
        // 집중 tick(elapsed가 오른 tick)만 오늘 몫에 적립 — 일시정지·뽀모도로 휴식은
        // 여기까지 오지 않거나 elapsed가 멈춰 자연히 빠진다(GROMO-1252 코드리뷰).
        if (next.elapsed > prev.elapsed) deps.onFocusTick();
        session = next;
        notify();
      }, 1000);
    },
    stopTicking() {
      if (interval != null) clearInterval(interval);
      interval = null;
    },
  };
}
