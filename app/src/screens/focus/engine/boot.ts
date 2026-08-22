// 엔진 부팅 복구 (GROMO-1600 — PRD §4.1-③ 「헤드리스 엔진」의 부팅 지점).
//
// **UI 없이 도는 코드다.** React 트리·provider·화면 마운트를 전혀 요구하지 않는다 —
// AsyncStorage와 목 가능한 모듈만 쓴다. 그래서 index.ts 최상위(콜드 스타트)와 FCM 사일런트
// 푸시(headless 기동) 양쪽에서 같은 함수를 부를 수 있다.
//
// 하는 일은 둘:
//  ① **원자적 시작의 복구**(§4.3-ⓑ) — 저널에 미완 `starting`이 남아 있으면, 실드는 걸렸는데
//     롤백 코드가 못 돈 크래시다. **v1 커밋 흔적을 먼저 확인**해 커밋돼 있으면 실드를 풀지
//     않고 저널만 소급 완결하고, 흔적이 없으면 실드를 해제하고 저널을 소거한다.
//  ② **워치 명령 인박스 드레인**(D2-④) — 네이티브가 적재해 둔 명령을 비운다. 시간에
//     민감해서 네트워크 작업보다 **먼저** 돈다. 이 티켓에선 실행하지 않고 폐기한다(스켈레톤).
//  ③ **failed 정산 intent의 재업로드**(D1) — 대기열 저장까지 실패해 저널에만 남은 블록을
//     같은 바디로 다시 올린다. 성공·큐 인계면 intent를 지운다.
//
// 세션 **재개**는 하지 않는다 — 부팅 정책은 현행(OrphanFocusSettler의 종료 정산) 그대로다.
// 재개는 페이즈 1(워치 발 세션)의 몫이고, 그때 Settler와의 조정이 필요하다.

import ScreenTimeModule from '@/services/ScreenTimeModule';
import { uploadFocusBlock } from '../uploadFocusBlock';
import { markBackgroundFocusCommit } from '../pendingFocusUploads';
import { requestCoinRefresh } from '@/store/coinRefreshSignal';
import { cancelMarker } from '../pendingMarkerCancels';
import { readPersistedSessionV1 } from './persistence';
import { drainWatchCommands, ackWatchCommands } from './watchInbox';
import {
  readJournal,
  journalActivateSession,
  journalClearSession,
  resolveSettleIntent,
  type SettleIntent,
} from './journal';

/**
 * 갓 기록된 intent는 건너뛰는 나이 기준. 앱이 포그라운드에서 세션을 돌리는 중에 사일런트
 * 푸시가 오면 이 복구가 **업로드 진행 중인 intent**와 겹칠 수 있다 — 서버가 중복을 걸러내긴
 * 하지만(uploadFocusBlock 헤더 계약) 무의미한 재전송을 피한다.
 */
const STALE_INTENT_MS = 60_000;

/**
 * `starting`을 「크래시」로 단정하기 전에 두는 유예. **이게 없으면 막 시작한 정상 세션의
 * 실드를 푼다** — 시작은 write-ahead라 저널(`starting`)이 v1 커밋 흔적보다 **먼저** 커밋되고
 * (§4.3-ⓐ가 요구하는 순서다), 그 사이에 복구가 돌면 흔적이 없어 크래시로 보인다.
 * 사일런트 푸시·포그라운드 복귀가 하필 그 순간에 겹치면 실제로 일어난다.
 *
 * 진짜 크래시는 프로세스가 죽었다 살아난 뒤라 언제나 이 유예보다 오래된 기록이다.
 */
const STARTING_GRACE_MS = 30_000;

let running: Promise<void> | null = null;

async function replayIntent(intent: SettleIntent): Promise<void> {
  const result = await uploadFocusBlock({
    sessionId: intent.serverSessionId,
    body: intent.body,
    // 계정 스코프는 **기록 당시 소유자**다 — focusApi가 전송 직전에 현재 계정을 재검증해
    // 불일치면 던지므로(FocusSaveAccountChangedError), 남의 계정으로 올라갈 길은 없다.
    // 그 경우 intent는 남고 로그아웃 시 저널 키가 통째로 지워진다.
    userId: intent.userId,
    onMarkerStillOpen: (id) => {
      cancelMarker(id, intent.userId).catch(() => {});
    },
  });
  // 'failed'만 보존 — 나머지는 서버 반영 또는 내구 큐 인계 완료다.
  if (result.status !== 'failed') await resolveSettleIntent(intent.intentId);
  // 재생이 **서버에 커밋됐으면** 잔액이 바뀐다 — 큐 flush와 같은 두 갈래로 알린다.
  // ① 메모리 신호: JS가 살아 있는 동안의 정규 경로 ② 영속 마커: headless 기동 후 프로세스가
  // 죽는 경우의 보험. 이게 없으면 사일런트 flush에선 뒤따르는 큐 flush가 빈 큐를 보고
  // committed=false를 돌려줘 갱신 신호가 아예 생기지 않는다(pendingFocusUploads 주석 참고).
  if (result.status === 'saved') {
    requestCoinRefresh();
    await markBackgroundFocusCommit().catch(() => {});
  }
}

/**
 * 시각을 못 읽으면 「오래됨」으로 본다 — 우리가 쓰는 값은 항상 유효한 ISO라, 깨진 값은
 * 경합 창이 아니라 낡은·외부 레코드다. 여기서 건너뛰면 그 기록이 영영 안 지워져 원자적
 * 시작 계약이 계속 막힌다.
 */
function isStartingStale(createdAt: string): boolean {
  const age = Date.now() - Date.parse(createdAt);
  return !Number.isFinite(age) || age >= STARTING_GRACE_MS;
}

async function recover(): Promise<void> {
  const journal = await readJournal();

  // ① 원자적 시작 복구
  const session = journal.session;
  if (session?.state === 'starting' && isStartingStale(session.createdAt)) {
    const v1 = await readPersistedSessionV1();
    if (v1?.sessionKey === session.sessionKey) {
      // 커밋 흔적이 있다 — 시작은 성공했고 저널 완결만 못 한 크래시다. 실드는 그대로 둔다
      // (여기서 풀면 살아 있는 세션의 차단이 사라진다).
      await journalActivateSession(session.sessionKey);
    } else if (session.shieldRequested) {
      // 흔적이 없다 — 실드만 남은 크래시. 사용자가 이유 없이 차단된 채로 남지 않게 회수한다.
      await ScreenTimeModule.stopFocusShield().catch(() => {});
      await journalClearSession();
    } else {
      await journalClearSession();
    }
  }

  // ② 워치 명령 인박스 드레인 — **네트워크 작업보다 먼저** 돈다. 뒤에 두면 저널이 찬 경우
  // intent마다 업로드 타임아웃을 소비하다가, 종료 상태 기동의 제한된 백그라운드 실행 시간이
  // 먼저 끝나 시간 민감한 명령(start·pause·resume은 expiresAt도 지난다)이 이번 기동에서
  // 처리되지 못한다.
  //
  // 이 티켓의 범위는 **비우기까지**다 — 실행 라우팅 없이 쌓아 두면 페이즈 1 첫 부팅에 낡은
  // 명령이 한꺼번에 실행되므로, 지금은 드레인하고 즉시 ack(=처리 완료로 확정)한다.
  // 페이즈 1에서는 이 ack를 **라우팅 성공 뒤로** 옮긴다.
  const commands = await drainWatchCommands().catch(() => []);
  if (commands.length > 0) {
    if (__DEV__) {
      console.log(`[워치인박스] ${commands.length}건 드레인 — 실행 라우팅은 페이즈 1`);
    }
    await ackWatchCommands(commands.map((c) => c.commandId));
  }

  // ③ failed intent 재업로드
  const now = Date.now();
  for (const intent of journal.settles) {
    const age = now - Date.parse(intent.createdAt);
    if (!Number.isFinite(age) || age < STALE_INTENT_MS) continue;
    await replayIntent(intent).catch(() => {});
  }
}

/**
 * 멱등 — 부팅 경로가 둘(index.ts 콜드 스타트, runSilentFlush headless)이라 겹쳐 불려도
 * 한 번만 돈다. 완료 후에는 캐시를 비워 다음 headless 기동이 다시 복구할 수 있게 한다.
 */
export function recoverFocusEngine(): Promise<void> {
  if (running) return running;
  running = recover()
    .catch(() => {})
    .finally(() => {
      running = null;
    });
  return running;
}
