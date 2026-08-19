// 엔진 영속 세션 v1 (GROMO-1600 — PRD §4.1-①의 「버전 붙은 영속 상태 머신」).
//
// legacy `focusLiveSession`은 미정산 꼬리만 담아 프로세스가 죽으면 세션을 **재구성할 수
// 없었다**(모드·페이즈·정지·방해 장부 부재 — OrphanFocusSettler는 종료 정산만 한다).
// v1은 재구성에 필요한 전체 상태를 담고, legacy와 **이중 기록**한다: 특성화·구버전
// Settler·OTA 롤백이 legacy를 계속 읽으므로 legacy는 비트 동일하게 남긴다. 이중 기록
// 은퇴는 바이너리 soak 후 후속 티켓.
//
// 이 티켓에서 콜드 스타트 「재개」는 하지 않는다 — 부팅 정책은 현행(고아 정산) 유지.
// 재구성 함수는 엔진 단위 테스트가 왕복을 증명하는 용도이고, 실사용 재개는 페이즈 1.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { blockPauseSeconds, type BlockPause } from '../blockPause';
import type { BlockToday } from '../blockToday';
import type { FocusTimerMode, PomodoroConfig } from '../types';
import type { SessionMachineConfig, SessionState } from './machine';

export interface PersistedFocusSessionV1 {
  version: 1;
  /** 폰 엔진이 부작용 전에 생성하는 로컬 세션 ID(§4.3 focusSessionId의 전신) */
  sessionKey: string;
  userId: string | null;
  subjectId: string;
  subjectName: string;
  mode: FocusTimerMode;
  goalSeconds: number | null;
  pomodoro: PomodoroConfig | null;
  // ── 상태 머신 — 죽었다 살아나도 재구성 가능(§4.1-①)
  phase: 'focus' | 'break';
  setIndex: number;
  isPaused: boolean;
  done: boolean;
  displaySeconds: number; // updatedAt 앵커 기준 표시값
  elapsedSeconds: number; // 세션 누적 집중초(정산 여부 무관 — display·완료 판정의 짝)
  startedAt: string; // 세션 최초 시작(ISO)
  // ── 미정산 블록 — legacy 레코드와 같은 의미(정산 완료분은 빠진다)
  blockStartedAt: string;
  unsettledSeconds: number;
  settledSeconds: number;
  /** 방해초 실측 영속 — Settler의 (span − elapsed) 역산을 대체한다 */
  blockPause: BlockPause;
  focusDays: BlockToday;
  awayCreditedSeconds: number;
  shielded: boolean;
  serverSessionId: string | null;
  settledLocally?: boolean; // 고아 정산의 로컬 적립 1회 마킹(legacy와 같은 규칙)
  revision: number; // 단조 — LA revision과 같은 카운터(§4.2)
  updatedAt: string;
}

export function writePersistedSessionV1(rec: PersistedFocusSessionV1): void {
  AsyncStorage.setItem(STORAGE_KEYS.focusSessionV1, JSON.stringify(rec)).catch(() => {});
}

export async function readPersistedSessionV1(): Promise<PersistedFocusSessionV1 | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusSessionV1);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as PersistedFocusSessionV1;
    // 버전 봉투 — 모르는 버전(미래 스키마의 롤백 수신 등)은 없는 것으로 취급해 폐기 대상.
    if (rec.version !== 1) return null;
    return rec;
  } catch {
    return null;
  }
}

export function removePersistedSessionV1(): void {
  AsyncStorage.removeItem(STORAGE_KEYS.focusSessionV1).catch(() => {});
}

/** 콜드 스타트 재구성 — v1 레코드에서 상태 머신 입력(config·SessionState)을 복원한다. */
export function reconstructSessionFromV1(rec: PersistedFocusSessionV1): {
  config: SessionMachineConfig;
  session: SessionState;
  isPaused: boolean;
  awayCreditedSeconds: number;
  shielded: boolean;
} {
  return {
    config: {
      mode: rec.mode,
      goalSeconds: rec.goalSeconds ?? 25 * 60,
      pomodoro: rec.pomodoro ?? { focusMin: 25, breakMin: 5, sets: 4 },
    },
    session: {
      elapsed: rec.elapsedSeconds,
      display: rec.displaySeconds,
      phase: rec.phase,
      setIndex: rec.setIndex,
      done: rec.done,
    },
    isPaused: rec.isPaused,
    awayCreditedSeconds: rec.awayCreditedSeconds,
    shielded: rec.shielded,
  };
}

/**
 * 고아 정산 입력 변환 — Settler가 v1 레코드에서 업로드 바디 재료를 얻는다.
 * legacy 폴백과 결정적 차이: 방해초를 (span − elapsed) **역산이 아니라 실측**(blockPause)
 * 으로 계산한다 — 역산은 실드 이탈 크레딧·리플레이 공백까지 방해로 오분류할 수 있다.
 */
export function orphanSettlementFromV1(rec: PersistedFocusSessionV1): {
  focused: number;
  startedAt: string;
  endedAt: string;
  distractionCount: number;
  totalDistractionSeconds: number;
  focusSecondsByDate: BlockToday['server'];
  localTodayShare: (todayKey: string) => number;
} {
  const focused = Math.floor(rec.unsettledSeconds);
  return {
    focused,
    startedAt: rec.blockStartedAt,
    endedAt: rec.updatedAt,
    distractionCount: rec.blockPause.count,
    // 서버 DTO 상한(24h) 클램프는 legacy 경로와 동일 — blockPauseSeconds가 내부 클램프한다.
    totalDistractionSeconds: blockPauseSeconds(rec.blockPause, Date.parse(rec.updatedAt)),
    focusSecondsByDate: rec.focusDays.server,
    localTodayShare: (todayKey) => Math.min(focused, rec.focusDays.local?.[todayKey] ?? 0),
  };
}
