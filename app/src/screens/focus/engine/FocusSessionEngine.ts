// 집중 세션 엔진 (GROMO-1600 헤드리스화 — 2~4단계).
//
// 세션 상태(SessionState)·1초 틱·라이브 레코드·정산 코어(블록 장부·증분 정산·마커 회전·
// 그리드 기준점)의 소유권을 화면에서 가져온다. 화면은 구독하는 뷰가 된다. 이탈 감지·
// 리플레이·finish 명령은 아직 화면에 남아 엔진 API를 부른다(후속 단계 이관).
//
// ⚠️ 마운트당 인스턴스다(모듈 싱글턴 금지) — 이 저장소 jest 구성엔 resetModules가
//    없어 모듈 상태가 테스트 간 누수된다. 앱 싱글턴 전환은 페이즈 1(화면 없는 세션)
//    도입 때 재검토.
// ⚠️ 의존 모듈은 화면과 같은 경로를 import한다 — 특성화 스위트의 목 경계가 곧 이 엔진의
//    의존 경계다(uploadFocusBlock·pendingMarkerCancels·tagSync·focusApi·analyticsEvents…).

import { Platform, Vibration, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { STORAGE_KEYS } from '@/types/storage';
import type { FocusType } from '@/types/dto/focus';
import { startFocusSession } from '@/services/focusApi';
import { scheduleLeaveNotifications, cancelLeaveNotifications } from '../leaveNotifications';
import {
  logFocusDistractionDetected,
  logFocusMarkerStartFailed,
  logFocusSessionAbandoned,
  logFocusSessionCompleted,
  logFocusSessionPaused,
  logFocusSessionResumed,
} from '@/services/analyticsEvents';
import ScreenTimeModule, { type FocusActivityState } from '@/services/ScreenTimeModule';
import { todayStr, todayStrKst } from '@/utils/localDate';
import { uploadFocusBlock } from '../uploadFocusBlock';
import { cancelMarker, flushPendingMarkerCancels } from '../pendingMarkerCancels';
import { ensureFocusTagId } from '../tagSync';
import { isTodayVerdict, publishSessionSaveVerdict } from '../sessionSaveVerdict';
import {
  newBlockToday,
  creditTick,
  creditTicks,
  blockTodaySeconds,
  type BlockToday,
} from '../blockToday';
import { newBlockPause, pauseStart, pauseEnd, blockPauseSeconds, pauseCutAt } from '../blockPause';
import type { LiveFocusSession, FocusTimerMode } from '../types';
import {
  initialSessionState,
  nextTick,
  type SessionMachineConfig,
  type SessionState,
} from './machine';
import {
  writePersistedSessionV1,
  removePersistedSessionV1,
  type PersistedFocusSessionV1,
} from './persistence';
import {
  journalStartIntent,
  journalActivateSession,
  journalSetServerSessionId,
  journalClearSession,
  recordSettleIntent,
  resolveSettleIntent,
  type SettleIntent,
} from './journal';

// 무실드 세션의 이탈 자동 종료 경계(초) — 초과 복귀는 leave_timeout 종료
export const LEAVE_END_S = 15;
// 실드 세션 복귀 시 집중 인정 상한(세션 누적, GROMO-1253)
export const AWAY_CREDIT_CAP_S = 8 * 3600;
// 배열=진동 사이 간격([0,500]=2번), Android는 [대기,진동] 교대라 [0,500]이 1번 500ms가 된다.
export const DOUBLE_VIBRATE_PATTERN = Platform.OS === 'android' ? [0, 400, 200, 400] : [0, 500];

// 타이머 모드 → 서버 FocusType 매핑(GROMO-733)
const FOCUS_TYPE_BY_MODE: Record<FocusTimerMode, FocusType> = {
  countup: 'INFINITE',
  countdown: 'RANGE',
  pomodoro: 'POMODORO',
};

export interface FocusEngineDeps {
  /** 소유 표식 — 과목 변경(라우트 갱신)·계정 전환을 따라가는 렌더 미러 게터 */
  identity(): { subjectId: string; subjectName: string; userId: string | null };
  /**
   * 로컬 적립·코인 재조회 — 특성화 스위트가 훅 목으로 주입하는 함수들이라 화면이
   * 렌더 미러로 넘긴다(모듈 신호로 바꾸면 provider 없는 테스트에서 호출이 증발한다).
   */
  settleDelegates(): {
    addFocusSeconds(seconds: number): void;
    addFocusToSubject(subjectId: string, seconds: number): void;
    refreshCoins(): void;
  };
  /** 세션 전 오늘 누적(마운트 시점 todayFocusSeconds) — 그리드 로컬 폴백의 밑변 */
  preSessionTodaySeconds: number;
}

export interface GridBaseline {
  preSession: { day: string; base: number };
  settledToday: { day: string; seconds: number };
  settledFloorSeconds: number;
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

  // ── 종료·종결 계측 — 소유자는 엔진(5단계)
  isFinished(): boolean;
  /** 정상 완료 계측 1회 발행 — 완료 게이트와 finish가 공유(abandoned와 상호배타) */
  logCompletedOnce(): void;
  /** 포기 계측 1회 발행 — completed와 상호배타. reason: 'system_back' | 'leave_timeout' */
  logAbandonedOnce(reason: string): void;
  /**
   * 정지/완료 — 남은 집중 블록 정산(적립+서버 업로드) 후 결과 파라미터 반환. 한 번만 실행
   * (재진입은 null). 뷰 계측 flush·Live Activity 종료는 화면 몫이라 훅으로 끼운다 —
   * 호출 순서(계측 → 뷰 flush → 실드/LA 해제 → 레코드 제거 → 정산)는 화면 시절 그대로.
   */
  finish(
    completed?: boolean,
    hooks?: { flushViewInstrumentation?: () => void; endLiveActivity?: () => void },
  ): Promise<{ focusSeconds: number; completed: boolean } | null>;

  // ── 일시정지 — 정지 상태·토글 명령의 소유자는 엔진(5단계)
  isPausedState(): boolean;
  /** 상태만 바꾼다(계측·장부 없음) — 휴식 만료 복귀의 「일시정지 대기」 전용 */
  setPausedState(v: boolean): void;
  /** 일시정지/재개 토글 — 방해초·24h 컷·마커 유예·계측까지 한 명령 */
  togglePause(): void;

  /** 세션 최초 시작 시각(ISO) — 엔진 생성 시점 */
  sessionStartedAt(): string;
  /** 현재 미정산 블록의 시작 시각(ISO) */
  blockStartedAt(): string;
  /** 정산 블록의 시작점 이동 + 방해 카운터 리셋 — settleAt을 옮기는 모든 지점 = 새 블록 시작 */
  startBlockAt(at: string): void;

  // ── 방해초(blockPause) — 정지 명령이 화면 소유인 동안의 조작 창구(5단계에서 흡수)
  pauseStartBlock(): void;
  pauseEndBlock(): void;
  resetBlockPause(): void;
  pauseCutAtBlock(): number | null;

  // ── 오늘 몫 장부(blockToday) — 리플레이(6단계 이관 전)가 화면에서 조작한다
  creditFocusTick(at?: Date): void;
  creditFocusTicks(firstAt: Date, count: number): void;
  /** 이탈(background) 시점의 날짜 맵 스냅샷을 찍는다 — 복귀 리플레이의 되감기 기준 */
  markLeftBlockToday(): void;
  /** 리플레이 진입 시 스냅샷으로 되감는다(정산이 끼어 스냅샷이 버려졌으면 no-op) */
  rewindBlockTodayToLeft(): void;
  /** 미정산 블록의 날짜 맵(그리드 셀·드로어 표시용 읽기) */
  blockTodayView(): BlockToday;

  // ── 서버 라이브 마커(GROMO-873)
  startLiveSession(startedAt: string): Promise<string | null>;
  cancelLiveSession(): void;
  /**
   * finish를 거치지 않는 뷰 이탈(Android 시스템 뒤로가기 등) — 마커를 닫고 **미정산 블록을
   * 영속한다**(D2 수리). 종전엔 이 자리에 저장이 없어 첫 5초 주기 전 언마운트면 고아 정산
   * 근거가 통째로 없었고, 이후에도 마지막 주기 저장 뒤 최대 4초가 유실됐다. 정산 자체는
   * 여전히 다음 부팅의 고아 정산 몫이다(여기서 업로드하지 않는다).
   */
  detachViewExit(): void;
  setMarkerDeferred(v: boolean): void;
  isMarkerDeferred(): boolean;

  /**
   * 세션 시작(원자적, §4.3) — ⓪ 저널 write-ahead(starting) → ① 실드 적용(fire, 폰 발은
   * 실패해도 계속 — 15초 정책 폴백) → ② v1 커밋 흔적 + 저널 active 원자 갱신 → ③ 첫 마커.
   * 실드 성공 직후 크래시로 「실드만 남는」 창은 다음 부팅 recover가 저널로 회수한다.
   */
  start(subjectName: string): Promise<void>;

  // ── 실드 — 적용 성공 여부(shielded)로 이탈 정책이 갈린다: 실드 O=집중 인정 / X=15초 정책
  applyShield(subjectName: string): void;
  releaseShield(): void;

  /**
   * 뽀모도로 페이즈 경계 처리 — 집중→휴식 정산, 휴식→집중 새 블록·마커(정지 대기면 유예).
   * 화면 이펙트가 session.phase 변화마다 부른다. 리플레이가 지나간 경계는 내부 prevPhase
   * 동기화로 이중 처리되지 않는다.
   */
  handlePhaseTransition(): void;

  /**
   * 이탈 관측(D2 보강 — 관측 로직의 소유자는 엔진). AppState 구독 자체는 화면이 유지하고
   * 상태를 포워딩한다 — 구독 순서(체류 리스너 먼저)가 특성화로 고정된 동작이라 엔진이
   * 직접 구독하면 순서가 깨진다. 화면 없는 세션의 자체 구독은 페이즈 1에서.
   */
  onAppStateChange(state: AppStateStatus, hooks: { onLeaveTimeout(): void }): void;

  // ── Live Activity 상태(GROMO-1597) — revision 카운터의 소유자는 엔진.
  //    시간 필드는 「마지막 렌더 시점」 상태(base)를 받는다: 600ms 캡처 콜백처럼 렌더 밖
  //    문맥이 엔진 상태(즉시)를 읽으면 같은 프레임의 미표시 tick이 페이로드에 선반영돼
  //    화면 표시와 어긋난다(특성화가 잡은 차이 — 페이즈 1 워치 스냅샷도 이 카운터를 쓴다).
  buildActivityState(base: SessionState): FocusActivityState;

  // ── 정산·그리드 기준점
  settleFocusBlock(endedAtOverride?: string): void;
  setServerSnapshot(snap: { day: string; seconds: number } | null): void;
  resetFloorIfNewDay(kstDay: string): void;
  gridBaseline(): GridBaseline;

  persistLiveRecord(elapsed: number): void;
}

export function createFocusSessionEngine(
  config: SessionMachineConfig,
  deps: FocusEngineDeps,
): FocusSessionEngine {
  let session = initialSessionState(config);
  const listeners = new Set<() => void>();
  let interval: ReturnType<typeof setInterval> | null = null;
  const notify = () => listeners.forEach((l) => l());

  const startedAtIso = new Date().toISOString();
  // 로컬 세션 ID(§4.3 focusSessionId의 전신) — 부작용 전에 생성되는 비어 있지 않은 식별자
  const sessionKey = `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // 서버 업로드 정산 마커 — 이미 정산(로컬 적립·서버 업로드)된 집중초와 미정산 구간 시작 시각.
  // 뽀모도로는 집중 블록마다, 그 외 모드는 종료 시 한 번 정산한다.
  // 코인은 여기서 세지 않는다(GROMO-1049) — 지급도 잔액도 서버가 정본이라 앱이 미리 계산하지 않는다.
  let settledSeconds = 0;
  let settleAt = startedAtIso;
  // 이 블록의 수동 일시정지 누적(방해초, GROMO-1214 코드리뷰) — 규칙·근거는 blockPause.ts 주석 참고.
  let blockPause = newBlockPause();
  // 미정산 블록의 날짜별 집중초(GROMO-1252) — 정산 적립·그리드 셀·메뉴 드로어의 '오늘 몫'이자,
  // 업로드 페이로드의 focusSecondsByDate. 벽시계 겹침이 아니라 집중 tick의 날짜로 세는 이유는
  // blockToday.ts 주석 참고.
  let blockToday = newBlockToday();
  // 이탈(background) 시점의 날짜 맵 스냅샷 — 복귀 리플레이가 세션 상태를 되감는 만큼 날짜 맵도
  // 되감아야 한다(GROMO-1252 코드리뷰 ⑤). 정산이 끼면(settleFocusBlock) 스냅샷은 버린다.
  let leftBlockToday: BlockToday | null = null;
  // 내 그리드 셀 오늘 몫 집계(GROMO-932) — 규칙은 화면 시절 주석 그대로: 세션 전 오늘 몫 +
  // 이 세션이 오늘로 귀속시킨 정산 델타 + 미정산 경과의 오늘 몫(렌더 순서와 무관하게 직접 집계).
  const gridPreSession = { day: todayStr(), base: deps.preSessionTodaySeconds };
  let gridSettledToday = { day: todayStr(), seconds: 0 };
  // 내 그리드 셀의 **정산 기준점**(GROMO-1246 코덱스 리뷰 ③·④·⑧) — 마지막 정산 직후 확정한
  // KST 오늘 총합. 새 블록의 델타는 이 위에 쌓이고, 서버가 그 정산분을 반영하면 serverBase가
  // 같은 총합으로 수렴해 이중 계상이 없다. 기준일을 함께 들고 KST 자정을 넘기면 0으로 리셋한다.
  let gridSettledFloor = { day: todayStrKst(), seconds: 0 };
  // 정산 시점에 읽을 최신 서버 스냅샷 — **기준일을 함께** 들어야 한다(코덱스 리뷰 ⑩): 자정 전에
  // 스냅샷을 받고 자정을 넘겨 복귀하면 리플레이가 새 렌더보다 먼저 정산을 돌린다 — 날짜 확인
  // 없이 쓰면 전날 누적 위에 새 날 블록을 얹은 값이 오늘 기준점으로 굳는다.
  let gridServerSnapshot: { day: string; seconds: number } | null = null;
  // 서버 라이브 마커 세션(GROMO-873) — 표시용 마커일 뿐 시간 저장·통계는 완주 저장(POST,
  // settleFocusBlock)이 담당. liveId는 라이브 레코드 저장용 스냅샷, liveStartPromise는 시작
  // 응답 시퀀싱용 — 응답 전에 취소가 걸려도 순서대로 처리된다.
  let liveId: string | null = null;
  let liveStartPromise: Promise<string | null> = Promise.resolve(null);
  // 휴식 만료 복귀가 다음 블록을 일시정지 대기로 만든 경우 — 마커 오픈을 재개 시점까지 유예(코덱스 리뷰)
  let markerDeferred = false;
  let paused = false;
  let finished = false;
  // 세션 실드 적용 성공 여부 — 이탈 정책 분기(집중 인정 vs 15초 정책)의 입력
  let shielded = false;
  // 페이즈 경계 이펙트의 비교 기준 — 리플레이가 지나간 경계를 이중 처리하지 않게 동기화한다
  let prevPhase: 'focus' | 'break' = session.phase;
  // 이탈 감지 — background 진입 시각·페이즈·세션 스냅샷. 스냅샷에서 리플레이를 시작해
  // 서스펜드 전에 더 돈 tick과 경계 시각(leftAt + i초)이 어긋나지 않게 한다(코덱스 리뷰).
  let leftAt: number | null = null;
  let leftPhase: 'focus' | 'break' = 'focus';
  let leftSession: SessionState | null = null;
  // 이 세션에서 지금까지 인정한 이탈 크레딧 누적(GROMO-1253) — 상한이 '복귀 1회당'이면
  // 백그라운드 왕복마다 8시간씩 새로 붙어 하루 24시간을 넘긴다(34시간 신고 사례).
  let awayCredited = 0;
  // Live Activity revision — 단조 증가, 늦게 도착한 갱신이 최신 표시를 덮지 않게 네이티브가 비교
  let activityRevision = 0;
  // 이탈 타임아웃으로 abandoned를 발행한 세션 — completed 발행과 상호배타 보장(GROMO-1004)
  let abandoned = false;
  // completed를 이미 발행했는지 — 완료 게이트와 finish 두 경로의 이중 발행 방지(코덱스 리뷰)
  let completedLogged = false;

  const startBlockAt = (at: string) => {
    settleAt = at;
    blockPause = newBlockPause(blockPause);
  };

  const buildV1 = (unsettledSeconds: number, updatedAt: string): PersistedFocusSessionV1 => {
    const { subjectId, subjectName, userId } = deps.identity();
    return {
      version: 1,
      sessionKey,
      userId,
      subjectId,
      subjectName,
      mode: config.mode,
      goalSeconds: config.mode === 'countdown' ? config.goalSeconds : null,
      pomodoro: config.mode === 'pomodoro' ? config.pomodoro : null,
      phase: session.phase,
      setIndex: session.setIndex,
      isPaused: paused,
      done: session.done,
      displaySeconds: Math.floor(session.display),
      elapsedSeconds: Math.floor(session.elapsed),
      startedAt: startedAtIso,
      blockStartedAt: settleAt,
      unsettledSeconds,
      settledSeconds,
      blockPause,
      focusDays: blockToday,
      awayCreditedSeconds: awayCredited,
      shielded,
      serverSessionId: liveId,
      revision: activityRevision,
      updatedAt,
    };
  };

  // 라이브 세션 레코드 — 강제 종료돼도 다음 실행 때 OrphanFocusSettler가 정산할 수 있게 남긴다.
  // 저장값은 '미정산 구간'만: elapsed=아직 서버/로컬에 안 올린 집중초, startedAt=그 구간 시작 시각.
  // finish 후엔 저장 금지 — 종료 시 제거한 레코드가 되살아나면 다음 실행에서 이중 정산된다.
  const persistLiveRecord = (elapsed: number) => {
    if (finished) return;
    const remaining = Math.floor(elapsed) - settledSeconds;
    if (remaining <= 0) return;
    const { subjectId, subjectName, userId } = deps.identity();
    const record: LiveFocusSession = {
      subjectId,
      subjectName,
      elapsed: remaining,
      startedAt: settleAt,
      updatedAt: new Date().toISOString(),
      userId, // 소유 계정 — 고아 정산 시 다른 계정으로 적립/업로드되는 것을 막는다
      serverSessionId: liveId, // 열려 있는 라이브 마커 — 강제종료 시 서버 스윕이 마감
      // 날짜별 집중초 스냅샷(GROMO-1252) — 고아 정산이 여기와 같은 규칙으로 '오늘 몫'을 고르고,
      // 서버 업로드에도 그대로 실어 보낸다.
      focusDays: blockToday,
    };
    AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, JSON.stringify(record)).catch(() => {});
    // 영속 세션 v1 이중 기록(GROMO-1600) — legacy는 미정산 꼬리만, v1은 재구성 전체 상태.
    // 쓰기·제거 시점은 legacy와 대칭(같은 가드·같은 지점) — 두 표현이 어긋나지 않는다.
    writePersistedSessionV1(buildV1(remaining, record.updatedAt));
  };

  // 서버에 라이브 마커 시작을 등록 — 등록돼야 친구/리그 화면에 '집중 중'(과목명 포함)으로 보인다.
  // 태그를 해석해 실어 보내되, 실패(오프라인 등)해도 세션·시간 저장은 영향 없다(마커는 표시용).
  // sessionId는 promise로 전달 — 취소가 시작 응답보다 먼저 걸려도 순서대로 처리된다.
  const startLiveSession = (startedAt: string) => {
    const { subjectName, userId } = deps.identity();
    // 회전 시점 = 연결이 살아있을 가능성이 큰 시점 — 밀린 취소부터 재시도(코덱스 리뷰)
    flushPendingMarkerCancels(userId).catch(() => {});
    const promise = ensureFocusTagId(subjectName, userId)
      .catch(() => null)
      .then((focusTagId) =>
        startFocusSession({ focusTagId, startedAt, focusType: FOCUS_TYPE_BY_MODE[config.mode] }),
      )
      .then(
        (res) => {
          // 이 시작이 여전히 현재 마커일 때만 스냅샷 갱신 — 취소로 이미 닫힌 마커의 id를
          // 늦게 도착한 응답이 라이브 레코드에 되살리지 않게.
          if (liveStartPromise === promise) {
            liveId = res.sessionId;
            journalSetServerSessionId(sessionKey, res.sessionId);
          }
          return res.sessionId;
        },
        (e: unknown) => {
          // 마커 시작 실패는 종전까지 조용히 삼켜져 비율조차 몰랐다 — 계측만 남기고 세션은
          // 그대로 진행한다(GROMO-1214). 마커가 없으면 종료가 POST 폴백으로 간다.
          const status = axios.isAxiosError(e) ? e.response?.status : undefined;
          logFocusMarkerStartFailed({
            reason: axios.isAxiosError(e)
              ? status != null
                ? `http_${status}`
                : 'network'
              : 'unknown',
          });
          return null;
        },
      );
    liveStartPromise = promise;
    return promise;
  };

  // 라이브 마커 마감 — 취소(통계 미귀속)로 닫아 친구 화면의 '집중 중'을 끈다. 시간 저장은
  // settleFocusBlock의 업로드가 별도로 담당하므로 취소해도 기록은 잃지 않는다.
  // 실패해도 cancelMarker가 대기열에 남겨 다음 실행·포그라운드에 재시도하므로 fire-and-forget.
  const cancelLiveSession = () => {
    const { userId } = deps.identity();
    const livePromise = liveStartPromise;
    liveId = null;
    liveStartPromise = Promise.resolve(null);
    livePromise
      .then((sessionId) => (sessionId != null ? cancelMarker(sessionId, userId) : undefined))
      // 이 취소의 성패가 확정된 뒤 밀린 취소를 재시도 — finish의 flush가 진행 중이던 마지막
      // 취소보다 먼저 돌아 실패분을 놓치는 순서 경합 방지(코덱스 리뷰). 체인은 언마운트 후에도
      // 살아 있어 정지 직후 화면을 떠나도 재시도가 한 번은 돈다.
      .then(() => flushPendingMarkerCancels(deps.identity().userId))
      .catch(() => {});
  };

  // 집중 블록 증분 정산 — 마지막 정산 이후 쌓인 집중초(delta)를 로컬·과목·코인에 적립하고
  // 그 구간[settleAt, now]을 서버에 세션으로 업로드한다. 뽀모도로는 집중 블록 끝마다,
  // 그 외 모드는 finish에서 1회 호출된다. 정산 완료분은 라이브 레코드에서 제거(고아 이중정산 방지).
  // endedAtOverride: 빨리감기 리플레이가 '지난 경계의 실제 벽시계 시각'을 지정할 때 쓴다(생략 시 지금).
  const settleFocusBlock = (endedAtOverride?: string) => {
    const { subjectId, subjectName, userId } = deps.identity();
    const elapsed = Math.floor(session.elapsed);
    const delta = elapsed - settledSeconds;
    if (delta <= 0) return;
    // 24시간을 넘긴 일시정지는 방해값(서버 DTO 상한 24h)으로 실을 수 없다 — 그런 블록은
    // '지금'이 아니라 정지 시작 시점에서 끊는다(blockPause.ts pauseCutAt 주석).
    const cutAt = pauseCutAt(blockPause);
    const endedAt = endedAtOverride ?? new Date(cutAt ?? Date.now()).toISOString();
    const startedAt = settleAt;
    // 이 블록의 방해초 — 아직 안 닫힌 정지 구간까지 포함하되, 구간 끝(endedAt)까지만 센다.
    const totalDistractionSeconds = blockPauseSeconds(blockPause, Date.parse(endedAt));
    const distractionCount = blockPause.count;
    // 마커·레코드를 적립보다 먼저 갱신 — 적립 후 제거 전에 죽으면 고아 정산이 또 적립한다(원 finish와 동일 순서).
    settledSeconds = elapsed;
    startBlockAt(endedAt);
    AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession).catch(() => {});
    removePersistedSessionV1(); // v1도 대칭 제거 — 다음 5초 주기가 미정산 재개분으로 다시 쓴다
    // 로컬/과목 적립 — 이 블록의 집중초 중 오늘 몫만 반영(GROMO-1252). 몫은 벽시계 겹침이
    // 아니라 집중 tick의 날짜로 센다. 코인은 all-time이라 항상 반영.
    const settledBlockToday = blockToday;
    const focusSecondsByDate = settledBlockToday.server;
    const todaySeconds = Math.min(delta, blockTodaySeconds(settledBlockToday));
    // 다음 블록은 endedAt부터 — 카운터도 0에서 다시 시작한다. 이탈 스냅샷도 함께 버린다(⑤) —
    // 정산이 이미 이 tick들을 적립했으므로 복귀 리플레이가 스냅샷을 되돌리면 이중 적립이다.
    blockToday = newBlockToday();
    leftBlockToday = null;
    const delegates = deps.settleDelegates();
    if (todaySeconds > 0) {
      delegates.addFocusSeconds(todaySeconds);
      delegates.addFocusToSubject(subjectId, todaySeconds);
      // 내 그리드 셀 오늘 몫에도 같은 귀속 규칙으로 누적 — 리플레이가 렌더 전에 정산해도 안전
      if (gridSettledToday.day !== todayStr()) {
        gridSettledToday = { day: todayStr(), seconds: 0 };
      }
      gridSettledToday.seconds += todaySeconds;
    }
    // 그리드 표시 기준점 확정(코덱스 리뷰 ⑧) — '그 시점 서버가 아는 값'과 '직전 기준점' 중 큰
    // 쪽에 이번 블록의 KST 몫을 얹는다. 스냅샷·직전 기준점 모두 **오늘(KST) 것일 때만** 쓴다(⑩).
    const kstToday = todayStrKst();
    const kstSeconds = settledBlockToday.kst?.[kstToday] ?? 0;
    if (kstSeconds > 0) {
      const prevFloor = gridSettledFloor.day === kstToday ? gridSettledFloor.seconds : 0;
      const snapshotSeconds = gridServerSnapshot?.day === kstToday ? gridServerSnapshot.seconds : 0;
      gridSettledFloor = {
        day: kstToday,
        seconds: Math.max(snapshotSeconds, prevFloor) + kstSeconds,
      };
    }
    // 마커 회전(코덱스 리뷰) — 정산된 블록은 서버 누적(base)에 들어가는데 마커를 그대로 두면
    // 친구 화면 라이브 합산에 같은 구간이 두 번 잡힌다. 취소(cancel)하지 않는 이유: 이 마커는
    // 아래 업로드가 PATCH로 '종료'해 시간·코인을 귀속시킬 대상이다(GROMO-1214).
    const livePromise = liveStartPromise;
    liveId = null;
    liveStartPromise = Promise.resolve(null);
    // 서버 업로드 — 이번 집중 블록 구간만. 실패 시 대기열에 남겨 재시도(GROMO-614) —
    // 로컬 적립은 이미 반영돼 그냥 버리면 서버와 불일치.
    Promise.all([
      ensureFocusTagId(subjectName, userId).catch(() => null),
      livePromise.catch(() => null),
    ])
      .then(async ([focusTagId, sessionId]) => {
        const body = {
          focusTagId,
          subject: subjectName,
          startedAt,
          endedAt,
          // 이 블록의 수동 일시정지 — 서버가 지급(코인)·일별 통계에서 이만큼 뺀다.
          // 블록마다 그 블록 몫만 싣는다(세션 누적을 매 블록에 중복으로 실으면 과다 차감).
          distractionCount,
          totalDistractionSeconds,
          // 완주 저장에도 세션 유형을 전파 — 마커에만 실으면 RANGE/POMODORO가
          // 전부 INFINITE(서버 기본)로 저장돼 유형별 통계가 오염된다(코덱스 리뷰).
          focusType: FOCUS_TYPE_BY_MODE[config.mode],
          // 날짜별 집중초(GROMO-1252 ①) — 서버는 [startedAt, endedAt]만으로는 일시정지가
          // 자정을 걸친 블록의 날짜별 몫을 알 수 없다.
          focusSecondsByDate,
        };
        // 정산 의도 기록(D1) — 업로드 착수 **전에** 남긴다. 결과가 failed(대기열 저장까지
        // 실패)면 이 intent가 유일한 재시도 근거로 남아 다음 부팅 recover가 재업로드한다 —
        // 종전엔 레코드를 먼저 지워 이 경우 블록이 영구 유실됐다(특성화 :839 「알려진 유실 공백」).
        const intent: SettleIntent = {
          intentId: `${sessionKey}-${startedAt}`,
          sessionKey,
          serverSessionId: sessionId,
          body,
          userId,
          createdAt: new Date().toISOString(),
        };
        await recordSettleIntent(intent);
        // 업로드는 실패·대기열 인계까지 안에서 끝낸다 — 여기서 던지지 않으므로, 아래 발행
        // 콜백에서 예외가 나도 이미 서버에 저장된 세션이 대기열에 재적재되지 않는다(PR 250 리뷰).
        return uploadFocusBlock({
          sessionId,
          body,
          userId,
          onMarkerStillOpen: (id) => {
            cancelMarker(id, deps.identity().userId).catch(() => {});
          },
        }).then((result) => {
          // saved/alreadyEnded/queued = 서버 반영 또는 내구 큐 인계 완료 — intent 소멸.
          // failed만 보존한다(부팅 복구의 재업로드 근거).
          if (result.status !== 'failed') resolveSettleIntent(intent.intentId);
          // 저장 실패(대기열행)면 발행 없음 — 결과 화면은 기존 추정 판정으로 폴백.
          if (result.status !== 'saved') return;
          // 지급이 확정됐으니 서버 잔액을 다시 받는다(GROMO-1049).
          deps.settleDelegates().refreshCoins();
          // 서버 스트릭 판정을 결과 화면에 전달(GROMO-807). 어제 몫으로 귀속된 저장의 응답이면
          // 발행하지 않는다 — 판정 날짜는 서버가 실제로 쓴 분포 맵의 마지막 날짜다(GROMO-1252 4차 ④).
          if (isTodayVerdict(focusSecondsByDate, endedAt)) {
            publishSessionSaveVerdict(result.response);
          }
        });
      })
      .catch(() => {});
  };

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
        if (paused) return;
        const prev = session;
        if (prev.done) return;
        const next = nextTick(config, prev);
        // 집중 tick(elapsed가 오른 tick)만 오늘 몫에 적립 — 일시정지·뽀모도로 휴식은
        // 여기까지 오지 않거나 elapsed가 멈춰 자연히 빠진다(GROMO-1252 코드리뷰).
        if (next.elapsed > prev.elapsed) blockToday = creditTick(blockToday);
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

    isFinished: () => finished,
    // 정상 완료 계측(GROMO-1004) 1회 발행 — 유저 주도 종료는 모드 무관 완료로 세고,
    // 이탈 타임아웃(abandoned)과 상호배타 — 한 세션은 둘 중 하나만 발행된다.
    logCompletedOnce() {
      if (completedLogged || abandoned) return;
      completedLogged = true;
      logFocusSessionCompleted({
        mode: config.mode,
        focus_minutes: Math.round(session.elapsed / 60),
        has_tag: Boolean(deps.identity().subjectId),
      });
    },
    logAbandonedOnce(reason) {
      if (abandoned || completedLogged) return;
      abandoned = true;
      logFocusSessionAbandoned({
        elapsed_seconds: Math.floor(session.elapsed),
        reason,
      });
    },
    async finish(completed = session.done, hooks) {
      if (finished) return null;
      finished = true;
      // 완료 계측 — 완료 게이트가 이미 발행한 세션(카운트다운/뽀모도로 완주)은 가드로 스킵된다.
      this.logCompletedOnce();
      // 보고 있던 뷰의 마지막 체류 flush(GROMO-987) — 뷰 계측은 화면 몫.
      hooks?.flushViewInstrumentation?.();
      // 정상 종료 — 실드(엔진 소유)·Live Activity(화면 몫) 해제
      ScreenTimeModule.stopFocusShield().catch(() => {});
      hooks?.endLiveActivity?.();
      // 라이브 레코드 제거를 먼저 시도하되, 실패해도 정산은 계속한다(GROMO-615).
      // 제거 실패로 정산까지 건너뛰면 적립·서버 업로드가 통째로 빠진다(보상 유실).
      await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession).catch(() => {});
      removePersistedSessionV1();
      journalClearSession();
      try {
        settleFocusBlock();
        // 완료·중도 정지 공통 — 표시용 마커는 여기서 항상 취소로 닫는다(GROMO-873).
        cancelLiveSession();
        // 화면을 떠나기 전 마지막 재시도 — 회전 중 실패해 쌓인 취소가 있으면 지금 정리(코덱스 리뷰)
        flushPendingMarkerCancels(deps.identity().userId).catch(() => {});
      } catch {
        // 정산 예외에도 결과 반환은 계속한다(원 finish의 finally 의미 — 화면은 반드시 빠져나간다)
      }
      return { focusSeconds: Math.floor(session.elapsed), completed };
    },

    isPausedState: () => paused,
    setPausedState(v) {
      paused = v;
      notify();
    },
    // 일시정지/재개 토글 — 새 상태에 맞춰 계측. 상태 업데이터 안이 아니라 여기서 발행(중복 방지).
    togglePause() {
      const next = !paused;
      paused = next;
      notify();
      if (next) {
        // 방해초(GROMO-1214 코드리뷰) — 정지 시작 시각을 찍고 횟수를 센다. 여기(유저 조작)에서만
        // 연다: 휴식 만료 복귀가 만드는 '일시정지 대기'는 markerDeferred 분기가 정산 구간
        // 자체를 재개 시점으로 밀어 이미 제외되므로, 방해초로 또 빼면 이중 차감이다.
        blockPause = pauseStart(blockPause);
        logFocusSessionPaused({ elapsed_seconds: Math.floor(session.elapsed) });
      } else if (pauseCutAt(blockPause) != null) {
        // 24시간을 넘긴 정지에서 재개 — 방해값으로 실을 수 없는 구간이라 블록 자체를 끊는다
        // (blockPause.ts pauseCutAt 주석). 정산은 정지 시작 시점까지만 올리고, 재개 시점부터
        // 새 블록·새 마커를 연다. 정지 구간은 어느 블록에도 안 들어가 집중으로 계상되지 않는다.
        const resumedAt = new Date().toISOString();
        settleFocusBlock();
        // 정산할 델타가 0이면 위 정산이 마커를 회전하지 않는다 — 참조를 덮어쓰기 전에 닫는다(회전했으면 no-op).
        cancelLiveSession();
        startBlockAt(resumedAt);
        blockPause = newBlockPause(); // 열린 정지 구간은 새 블록으로 넘기지 않는다
        startLiveSession(settleAt);
        logFocusSessionResumed();
      } else {
        blockPause = pauseEnd(blockPause);
        // 일시정지 대기로 유예해둔 다음 블록 마커 — 실제 집중이 시작되는 재개 시점부터 연다.
        // 정산 기준(settleAt)도 재개 시점으로 — 대기 동안은 경과초가 멈춰 있어 안전(코덱스 리뷰).
        if (markerDeferred) {
          markerDeferred = false;
          startBlockAt(new Date().toISOString());
          startLiveSession(settleAt);
        }
        logFocusSessionResumed();
      }
    },

    sessionStartedAt: () => startedAtIso,
    blockStartedAt: () => settleAt,
    startBlockAt,

    pauseStartBlock() {
      blockPause = pauseStart(blockPause);
    },
    pauseEndBlock() {
      blockPause = pauseEnd(blockPause);
    },
    resetBlockPause() {
      // 열린 정지 구간은 새 블록으로 넘기지 않는다(24h 컷 재개 경로)
      blockPause = newBlockPause();
    },
    pauseCutAtBlock: () => pauseCutAt(blockPause),

    creditFocusTick(at) {
      blockToday = creditTick(blockToday, at);
    },
    creditFocusTicks(firstAt, count) {
      blockToday = creditTicks(blockToday, firstAt, count);
    },
    markLeftBlockToday() {
      leftBlockToday = blockToday;
    },
    rewindBlockTodayToLeft() {
      if (leftBlockToday != null) blockToday = leftBlockToday;
      leftBlockToday = null;
    },
    blockTodayView: () => blockToday,

    startLiveSession,
    cancelLiveSession,
    setMarkerDeferred(v) {
      markerDeferred = v;
    },
    isMarkerDeferred: () => markerDeferred,

    // 세션 시작(원자적, §4.3-ⓐ) — write-ahead와 커밋 흔적으로 「실드만 남는」 크래시 창을
    // 다음 부팅이 회수할 수 있게 한다. 폰 발 시작은 실드 실패에도 계속(15초 정책 폴백).
    async start(subjectName) {
      await journalStartIntent(sessionKey); // ⓪ 실드 적용 전에 의도를 기록
      this.applyShield(subjectName); // ① fire-and-forget — 성패는 shielded로 관찰
      // ② 커밋 흔적(v1, 미정산 0) + 같은 저널 레코드의 원자 갱신(starting→active)
      writePersistedSessionV1(buildV1(0, new Date().toISOString()));
      await journalActivateSession(sessionKey);
      // ③ 첫 마커 — 이후 블록 정산마다 회전(settleFocusBlock 참고)
      startLiveSession(startedAtIso);
    },

    // 세션 실드 — 시작 시 허용앱 외 전부 차단. 과목 변경 시엔 stop 없이 start만 다시
    // 호출한다(같은 스토어를 덮어씀) — 중간에 stop을 끼우면 무방비 구간이 생긴다.
    applyShield(subjectName) {
      ScreenTimeModule.startFocusShield(subjectName)
        .then((ok) => {
          shielded = ok;
        })
        .catch(() => {});
    },
    releaseShield() {
      shielded = false;
      ScreenTimeModule.stopFocusShield().catch(() => {});
    },

    // 뽀모도로 집중 블록 경계 — 집중→휴식 전환 시 완료된 블록을 정산·서버 업로드,
    // 휴식→집중 전환 시엔 다음 블록 시작으로 서버 구간 기준을 옮겨 휴식 시간을 제외한다.
    // 라이브 전환이면 진동 2번으로 경계를 알린다(GROMO-864).
    handlePhaseTransition() {
      const prev = prevPhase;
      const cur = session.phase;
      if (prev === cur) return;
      prevPhase = cur;
      Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
      if (prev === 'focus' && cur === 'break') {
        settleFocusBlock();
      } else if (prev === 'break' && cur === 'focus') {
        startBlockAt(new Date().toISOString());
        if (paused) {
          // 휴식 만료 복귀가 다음 블록을 일시정지 대기로 만든 경우 — 지금 열면 대기 내내
          // 친구 화면에 '집중 중'이 흐른다. 마커는 재개 시점에 연다(코덱스 리뷰).
          markerDeferred = true;
        } else {
          // 다음 집중 블록의 마커를 새로 연다(마커 회전) — 휴식 동안은 미집중으로 보인다.
          startLiveSession(settleAt);
        }
      }
    },

    // 이탈 감지·복귀 리플레이 — 화면 시절 AppState 핸들러의 verbatim 이식(GROMO-1600 6단계).
    onAppStateChange(state, hooks) {
      // 나감 — 타이머가 실제 돌고 있을 때만 이탈로 취급(일시정지·완료 중은 무시)
      if (state === 'background') {
        if (session.done || finished || paused) return;
        leftAt = Date.now();
        leftPhase = session.phase;
        leftSession = session; // 리플레이 기준 스냅샷(leftAt과 짝)
        leftBlockToday = blockToday; // 날짜 맵도 같은 시점으로 되감는다(코드리뷰 ⑤)
        persistLiveRecord(session.elapsed); // 여기서 꺼져도 이 시점까지는 정산되게
        // 실드 세션은 나가 있어도 집중 인정이라 이탈 알림 없음(폴백 세션만 경고)
        if (session.phase === 'focus' && !shielded) {
          scheduleLeaveNotifications(deps.identity().subjectName, LEAVE_END_S).catch(() => {});
        }
        // OS 예약 알림은 JS 프로세스가 종료된 뒤에도 남지만, 현재 고아 세션 레코드만으로는
        // 남은 타이머/뽀모도로 페이즈와 결과 화면을 복구할 수 없다 — 백그라운드 경계 알림은
        // 예약하지 않는다(코덱스 리뷰).
        return;
      }
      if (state !== 'active' || leftAt == null) return;

      // 복귀 — 자리 비운 시간 계산 (leftAtMs는 리플레이 경계 시각 복원용으로 보관)
      const leftAtMs = leftAt;
      // 하한 0 — 백그라운드 중 기기 시계가 뒤로 가면 음수가 된다. 그대로 두면 실드 크레딧
      // 잔량이 되레 늘고, 카운트다운은 `display - away`로 남은 시간이 늘어난다.
      const away = Math.max(0, Math.round((Date.now() - leftAtMs) / 1000));
      leftAt = null;
      cancelLeaveNotifications().catch(() => {});
      const distractionTimedOut = leftPhase === 'focus' && !shielded && away > LEAVE_END_S;
      // AppState만으로는 실드가 실제로 외부 앱을 차단했는지 알 수 없다 — 차단 결과를 관측할
      // 수 있는 일반 세션만 이탈 이벤트를 발행한다.
      if (leftPhase === 'focus' && !shielded && !distractionTimedOut) {
        logFocusDistractionDetected({
          reason: 'app_backgrounded',
          app_category: 'other',
          blocked: false,
          returned_to_focus: true,
        });
      }
      // 복귀 = 연결이 돌아왔을 가능성이 큰 시점 — 회전 중 실패한 마커 취소 재시도(코덱스 리뷰)
      flushPendingMarkerCancels(deps.identity().userId).catch(() => {});
      if (__DEV__) console.log(`[이탈감지] ${away}초 만에 복귀 (실드 ${shielded ? 'ON' : 'OFF'})`);
      if (session.done || finished) return;

      if (leftPhase === 'focus') {
        if (shielded) {
          // 실드 세션 — 딴짓이 차단된 상태였으므로 자리 비운 시간을 집중으로 인정(전진).
          // 상한은 세션 누적 기준 — 복귀 1회당이면 왕복 횟수만큼 곱해진다(GROMO-1253)
          const credit = Math.min(away, Math.max(0, AWAY_CREDIT_CAP_S - awayCredited));
          awayCredited += credit;
          // 리플레이는 이탈 시점 스냅샷에서 시작 — 서스펜드 전에 더 돈 tick으로 세션이
          // 앞서 있어도 경계 시각(leftAt + i초)과 어긋나지 않는다. 그 tick 전진분은 아래
          // setSession(cur)이 덮어써 이중 계상 없음(settledSeconds 단조 가드도 동일 방어).
          let cur = leftSession ?? session;
          leftSession = null;
          // 세션 상태를 되감는 만큼 날짜 맵도 이탈 시점으로 되돌린다 — 정산이 끼었으면
          // (스냅샷 null) 현재 값 유지(코드리뷰 ⑤).
          if (leftBlockToday != null) blockToday = leftBlockToday;
          leftBlockToday = null;
          let crossed = false;
          // 연속 집중 tick은 모아서 한 번에 적립한다(GROMO-1252 코드리뷰 6차 ④) — 8시간
          // 크레딧이면 28,800회라 tick마다 존 포맷·스프레드를 돌면 JS 스레드가 멈춘다.
          // 정산은 날짜 맵을 읽고 리셋하므로 그 직전에 반드시 flush 한다.
          let pendingFromMs = 0;
          let pendingTicks = 0;
          const flushTicks = () => {
            if (pendingTicks > 0)
              blockToday = creditTicks(blockToday, new Date(pendingFromMs), pendingTicks);
            pendingTicks = 0;
          };
          for (let i = 0; i < credit && !cur.done; i++) {
            const next = nextTick(config, cur);
            // 빨리감기가 지나치는 페이즈 경계도 실시간과 동일하게 정산·마커 회전 — 최종 페이즈만
            // 비교하면 집중→휴식→집중 한 바퀴가 경계 없음으로 보여 옛 마커가 계속 흐른다.
            // 경계 시각은 실제 지난 벽시계로 복원 — i번째 tick 종료 = leftAt + (i+1)초.
            const boundaryMs = leftAtMs + (i + 1) * 1000;
            // 리플레이 tick도 '실제로 지난 시각'의 날짜로 오늘 몫에 적립한다 — 자정을 넘겨
            // 복귀하면 자정 전 tick은 어제 몫이다. 1초 간격이 끊기면 묶음을 닫고 새로 연다.
            if (next.elapsed > cur.elapsed) {
              if (pendingTicks > 0 && boundaryMs !== pendingFromMs + pendingTicks * 1000)
                flushTicks();
              if (pendingTicks === 0) pendingFromMs = boundaryMs;
              pendingTicks++;
            }
            if (cur.phase === 'focus' && next.done) {
              // 마지막 블록 완료를 백그라운드에서 넘긴 경우 — 완료 경계 시각으로 정산해
              // 완료~복귀 공백이 집중으로 계상되지 않게 한다. done 이펙트의 정산은 delta 0 no-op.
              session = next;
              flushTicks();
              settleFocusBlock(new Date(boundaryMs).toISOString());
            } else if (cur.phase === 'focus' && next.phase === 'break') {
              crossed = true;
              session = next; // 정산이 경계 시점의 경과초를 읽도록 먼저 반영
              flushTicks();
              settleFocusBlock(new Date(boundaryMs).toISOString());
            } else if (cur.phase === 'break' && next.phase === 'focus') {
              crossed = true;
              // 새 집중 블록 시작 — 방해 카운터도 함께 리셋(GROMO-1214, startBlockAt).
              const boundaryAt = new Date(boundaryMs).toISOString();
              startBlockAt(boundaryAt);
              startLiveSession(boundaryAt);
            }
            cur = next;
          }
          flushTicks(); // 루프 종료분 — 아래 상한 부분정산·setSession 전에 반영
          // 크레딧 상한(8h)에 걸려 전진이 멈춘 경우 — 상한 시각으로 부분 정산하고 복귀
          // 시점에서 다시 연다. 휴식 중 상한은 정산 구간에 안 들어가므로 집중 페이즈만.
          if (!cur.done && away > credit && cur.phase === 'focus') {
            session = cur;
            settleFocusBlock(new Date(leftAtMs + credit * 1000).toISOString());
            // 상한이 정확히 블록 경계에 떨어지면 정산할 델타가 0이라 settle이 마커를 안
            // 닫는다 — 참조 덮어쓰기로 유실되지 않게 명시적으로 닫는다(회전했으면 no-op).
            cancelLiveSession();
            startBlockAt(new Date().toISOString());
            startLiveSession(settleAt);
          }
          if (crossed) {
            // 페이즈 이펙트가 같은 경계를 또 처리(마커 이중 오픈)하지 않게 기준을 동기화하고,
            // 지나온 경계는 진동 한 번으로만 알린다(기존 '복귀 시 한 번 알림' 동작 유지).
            prevPhase = cur.phase;
            Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
          }
          session = cur;
          notify();
          persistLiveRecord(cur.elapsed);
        } else if (away > LEAVE_END_S) {
          // 폴백(실드 없음) — 15초 초과 시 자동 종료(나가기 직전까지만 저장).
          // 정상 완료가 아닌 중도 이탈 종료이므로 abandoned 계측(reason: leave_timeout).
          logFocusDistractionDetected({
            reason: 'leave_timeout',
            app_category: 'other',
            blocked: false,
            returned_to_focus: false,
          });
          this.logAbandonedOnce('leave_timeout');
          // finish는 뷰 훅(체류 flush·LA 종료·결과 이동)이 필요해 화면 래퍼를 부른다
          hooks.onLeaveTimeout();
        }
      } else {
        // 휴식 중 이탈 — 벽시계만큼 휴식만 소진. 휴식이 끝나 있으면 다음 집중을 일시정지로 대기.
        const cur = session;
        if (cur.phase !== 'break') return;
        if (away < cur.display) {
          session = { ...cur, display: cur.display - away };
          notify();
        } else {
          paused = true;
          session = {
            ...cur,
            display: config.pomodoro.focusMin * 60,
            phase: 'focus',
            setIndex: cur.setIndex + 1,
          };
          notify();
        }
      }
    },

    buildActivityState(base) {
      activityRevision += 1;
      return {
        mode: config.mode,
        phase: base.phase,
        isPaused: paused,
        elapsedSeconds: Math.floor(base.elapsed),
        remainingSeconds: config.mode === 'countup' ? null : Math.max(0, Math.floor(base.display)),
        revision: activityRevision,
      };
    },

    detachViewExit() {
      if (finished) return;
      // 마커 먼저 마감 — 참조(liveId)는 동기적으로 비워지므로 아래 레코드는 닫힌 마커를
      // 가리키지 않는다(고아 정산이 헛된 PATCH를 태우지 않고 곧장 POST로 올린다).
      cancelLiveSession();
      persistLiveRecord(session.elapsed);
    },

    settleFocusBlock,
    setServerSnapshot(snap) {
      gridServerSnapshot = snap;
    },
    resetFloorIfNewDay(kstDay) {
      // 기준점은 KST 날짜가 바뀌면 0으로 — 자정 이후 새 날의 값이 전날 총합에 묶이면 안 된다.
      if (gridSettledFloor.day !== kstDay) gridSettledFloor = { day: kstDay, seconds: 0 };
    },
    gridBaseline: () => ({
      preSession: gridPreSession,
      settledToday: gridSettledToday,
      settledFloorSeconds: gridSettledFloor.seconds,
    }),

    persistLiveRecord,
  };
}
