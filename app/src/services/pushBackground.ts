// 사일런트(data-only) 푸시 → 업로드 큐 flush (GROMO-1286 · FR-22 · LLD §6.2).
//
// **왜 별도 모듈인가(codex 리뷰 ① P1)**: 백그라운드 핸들러는 index.ts **최상위**에서 등록해야
// 한다. 종료(killed) 상태에서 사일런트 푸시로 headless 기동되면 RNFB는 그 시점 등록된 핸들러를
// 부르는데, PushGate 이펙트(React 트리)는 아직 돌기 전이다 — 이펙트 등록에만 의존하면 index.ts의
// 선등록 no-op이 메시지를 소비해 flush가 영영 안 돈다. 그래서 React 트리가 필요 없는 이 모듈을
// index.ts가 직접 등록한다(계정은 저장 토큰에서 판별). 포그라운드 data-only 수신(push.ts
// onMessage)도 같은 flush 본체를 공유한다.
import messaging from '@react-native-firebase/messaging';
import { getFreshAccessToken, getUserIdFromToken } from '@/services/api';
import {
  flushPendingFocusUploads,
  markBackgroundFocusCommit,
} from '@/screens/focus/pendingFocusUploads';
import { syncWindowUsage } from '@/services/screentimeSync';

// 이 메시지가 flush 트리거인가 — 계약 키는 data.silent === 'flush'(LLD §6.2 배선 스케치).
export function isSilentFlush(data?: Record<string, unknown>): boolean {
  return data?.silent === 'flush';
}

// flush 본체 — 창 사용분 보고(1420과 같은 탐색축: GET /me/bet-sessions) + 집중 세션 재시도 큐.
// **창 사용분이 먼저다(codex 리뷰 ④ P1)** — 사일런트 푸시는 창형 정산 그레이스(settle_after
// −15분)에 마지막 창 보고를 받으려고 온다(FR-22). iOS 백그라운드 실행 시간 제한 안에서 집중
// 큐(최대 50건 순차 재시도·요청 타임아웃 누적)가 먼저 돌면 정작 이 푸시의 존재 이유에 도달하지
// 못한다. 순차 유지 — 병렬은 API 경합·중복 위험.
// 각 단계 실패는 삼킨다(둘 다 멱등 — 다음 포그라운드 sync가 최신값으로 재시도한다).
// **이중 실행도 멱등**: 창 보고는 서버 upsert + measuredAt 역전 무시(N34), 집중 큐는 flushing
// 플래그 + 성공 항목 제거라, index.ts 등록과 이펙트 재등록(교체)이 겹쳐도 부작용이 없다.
export async function runSilentFlush(): Promise<void> {
  try {
    const token = await getFreshAccessToken();
    const userId = token ? getUserIdFromToken(token) : null;
    if (!userId) return; // 게스트·로그아웃 — flush할 계정 큐가 없다
    await syncWindowUsage(userId).catch(() => {});
    // 반환값(committed)을 버리지 않는다(codex 리뷰 P2) — 백그라운드에서 커밋된 저장은 서버
    // 잔액을 바꾸고 큐를 비우므로, 포그라운드 복귀 시 PendingFocusUploader가 flush 결과만
    // 보면 '커밋 없음(빈 큐)'으로 읽어 잔액을 영영 다시 받지 않는다. 여기선 refreshCoins
    // (useCoins 훅)를 부를 수 없으니 커밋 사실만 마커로 남겨 복귀 시점에 이어받게 한다.
    const committed = await flushPendingFocusUploads(userId).catch(() => false);
    if (committed) await markBackgroundFocusCommit();
  } catch {
    // 토큰 조회 실패 포함 — 백그라운드라 알릴 곳이 없다. 포그라운드 sync가 흡수한다.
  }
}

// index.ts 최상위에서 1회 호출 — 백그라운드/종료 상태 data-only 수신을 flush로 잇는다.
// setBackgroundMessageHandler는 해제 API가 없는 단일 핸들러(재호출 = 교체)라 teardown이 없다.
// ⚠️ iOS는 사용자가 앱을 강제 종료(스와이프 킬)했거나 저전력 정책에 걸리면 사일런트 푸시로
// 깨우지 않을 수 있다 — 그 유실분은 다음 포그라운드 sync가 흡수한다(서버 upsert 멱등).
export function registerBackgroundFlushHandler(): void {
  messaging().setBackgroundMessageHandler(async (msg) => {
    if (isSilentFlush(msg?.data)) await runSilentFlush();
  });
}
