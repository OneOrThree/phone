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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import type { BlockToday } from '../blockToday';
import type { LiveFocusSession } from '../types';
import { initialSessionState, nextTick, type SessionMachineConfig, type SessionState } from './machine';

export interface FocusEngineTickDeps {
  /** 일시정지 여부 — 정지 상태의 소유는 아직 화면(5단계에서 명령화) */
  isPaused(): boolean;
  /** 집중 tick(elapsed가 오른 tick)마다 호출 — 오늘 몫 적립(화면의 blockToday 소유, 4단계 이관) */
  onFocusTick(): void;
  // ── 라이브 레코드 재료(3단계) — 정산 장부는 아직 화면 소유라 게터로 주입한다.
  //    4단계에서 장부가 엔진으로 오면 이 주입은 엔진 내부 상태로 걷힌다.
  isFinished(): boolean;
  settledSeconds(): number;
  blockStartedAt(): string;
  liveMarkerId(): string | null;
  blockToday(): BlockToday;
  identity(): { subjectId: string; subjectName: string; userId: string | null };
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
  /**
   * 라이브 레코드 즉시 저장 — 강제 종료돼도 다음 실행 때 OrphanFocusSettler가 정산할 수
   * 있게 남긴다. 백그라운드 진입·실드 복귀 전진처럼 5초 주기를 기다릴 수 없는 순간용.
   */
  persistLiveRecord(elapsed: number): void;
}

export function createFocusSessionEngine(
  config: SessionMachineConfig,
  deps: FocusEngineTickDeps,
): FocusSessionEngine {
  let session = initialSessionState(config);
  const listeners = new Set<() => void>();
  let interval: ReturnType<typeof setInterval> | null = null;
  const notify = () => listeners.forEach((l) => l());

  // 라이브 세션 레코드 — 강제 종료돼도 다음 실행 때 OrphanFocusSettler가 정산할 수 있게 남긴다.
  // 저장값은 '미정산 구간'만: elapsed=아직 서버/로컬에 안 올린 집중초, startedAt=그 구간 시작 시각.
  // (집중 블록을 증분 정산하므로 이미 올린 블록은 레코드에서 빠져 고아 정산이 이중 적립하지 않는다.)
  // finish 후엔 저장 금지 — 종료 시 제거한 레코드가 되살아나면 다음 실행에서 이중 정산된다.
  const persistLiveRecord = (elapsed: number) => {
    if (deps.isFinished()) return;
    const remaining = Math.floor(elapsed) - deps.settledSeconds();
    if (remaining <= 0) return;
    const { subjectId, subjectName, userId } = deps.identity();
    const record: LiveFocusSession = {
      subjectId,
      subjectName,
      elapsed: remaining,
      startedAt: deps.blockStartedAt(),
      updatedAt: new Date().toISOString(),
      userId, // 소유 계정 — 고아 정산 시 다른 계정으로 적립/업로드되는 것을 막는다
      serverSessionId: deps.liveMarkerId(), // 열려 있는 라이브 마커 — 강제종료 시 서버 스윕이 마감
      // 날짜별 집중초 스냅샷(GROMO-1252) — 고아 정산이 여기와 같은 규칙으로 '오늘 몫'을 고르고,
      // 서버 업로드에도 그대로 실어 보낸다. 구간 겹침만으로는 일시정지가 자정을 걸친 블록을
      // 과다 계상한다.
      focusDays: deps.blockToday(),
    };
    AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, JSON.stringify(record)).catch(() => {});
  };

  return {
    persistLiveRecord,
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
        // 매초 쓰기는 과해서 5초마다 갱신 — 즉시 저장이 필요한 순간은 persistLiveRecord 직접 호출
        if (next.elapsed > 0 && next.elapsed % 5 === 0) persistLiveRecord(next.elapsed);
        notify();
      }, 1000);
    },
    stopTicking() {
      if (interval != null) clearInterval(interval);
      interval = null;
    },
  };
}
