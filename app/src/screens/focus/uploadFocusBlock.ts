// 집중 블록 1건의 서버 반영(GROMO-1214) — 세션 정산(FocusSessionScreen)과 고아 정산
// (OrphanFocusSettler)이 공유하는 단일 경로.
//
// 종전엔 시작 시 만든 라이브 마커를 종료 때 cancel로 버리고 별개의 POST /focus-session을 새로
// 만들어 시간·코인을 귀속시켰다. 증거(서버 발급 마커)를 만들어 스스로 폐기하는 구조라 변조 앱이
// 임의의 세션을 심으면 그대로 지급됐다. 이제 마커 id가 있으면 PATCH /focus-session으로 그 마커를
// '종료'해 **서버가 발급한 id를 거쳐야만** 지급되게 한다.
//
// POST 경로는 남긴다 — 오프라인으로 시작해 마커가 없는 세션이 있고, 마커가 이미 자동 마감된
// 세션도 POST로 올려야 그 시간이 통계에 들어간다.
import axios from 'axios';
import { saveFocusSession, endFocusSession } from '@/services/focusApi';
import { enqueuePendingFocusUpload } from './pendingFocusUploads';
import type { FocusSessionRequest, FocusSessionSaveResponse } from '@/types/dto/focus';

// 서버는 PATCH의 endedAt을 [now−5분, now] 창으로 클램프한다(FocusService.clampToServerNow).
// 창 밖 값은 서버 수신 시각으로 **올라가** 마커 시작~수신 시각 전체가 집중으로 계상된다 —
// 실드 복귀 리플레이(몇 시간 전 블록 경계)나 고아 정산(강제종료 후 재실행)이 과거 구간을
// PATCH로 보내면 그만큼 과다 적립이다. 그런 블록은 저장값을 클램프하지 않는 POST로 보낸다.
// 서버 창(5분)보다 1분 여유 — 요청이 나가는 사이 창을 넘겨 클램프에 걸리지 않게.
const PATCH_ENDED_AT_MAX_AGE_MS = 4 * 60 * 1000;

export function isPatchableEndedAt(endedAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(endedAt);
  return Number.isFinite(t) && now - t < PATCH_ENDED_AT_MAX_AGE_MS;
}

export type UploadFocusBlockResult =
  | { status: 'saved'; response: FocusSessionSaveResponse } // 서버 커밋 완료(PATCH 또는 POST)
  | { status: 'alreadyEnded' } // PATCH 409 — 이 마커는 서버에서 이미 마감됨. 더 할 일 없음(아래 주석)
  | { status: 'queued' } // 업로드 실패 → 대기열 인계(GROMO-614)
  | { status: 'failed' }; // 대기열 저장까지 실패 — 호출부가 레코드를 보존해 다음 실행에 재시도

// 블록 1건을 서버에 반영한다.
//
// sessionId: 이 블록의 라이브 마커 id(없으면 null → 바로 POST).
// body: POST 폴백 바디. startedAt/endedAt은 PATCH가 종료시킬 구간과 **같은 값**이어야 한다 —
//       서버가 (user, startedAt, endedAt, COMPLETED) 중복을 걸러 주므로, PATCH가 성공했는데
//       응답만 유실돼 POST로 폴백해도 이중 계상되지 않는다.
// onMarkerStillOpen: PATCH가 마커를 못 닫은 채 실패했을 때의 뒤처리(취소) 위임. 안 닫으면 친구
//       화면에 '집중 중'이 서버 고아 스윕(12h)까지 남는다. 409(이미 마감)면 부르지 않는다.
//
// POST 폴백을 쓰는 경우는 셋뿐이다: 마커 id가 애초에 없을 때(오프라인 시작), 404(마커 소실),
// 네트워크·서버 오류. **409는 폴백하지 않는다** — 아래 catch의 주석 참고.
export async function uploadFocusBlock(opts: {
  sessionId: string | null;
  body: FocusSessionRequest;
  userId: string | null;
  onMarkerStillOpen?: (sessionId: string) => void;
}): Promise<UploadFocusBlockResult> {
  const { sessionId, body, userId, onMarkerStillOpen } = opts;
  if (sessionId != null) {
    if (isPatchableEndedAt(body.endedAt)) {
      try {
        const response = await endFocusSession(
          {
            sessionId,
            endedAt: body.endedAt,
            totalDistractionSeconds: body.totalDistractionSeconds,
            focusTagId: body.focusTagId,
          },
          userId,
        );
        return { status: 'saved', response };
      } catch (e) {
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        // ⚠️ 409는 '실패'로 보이지만 **성공으로 처리한다. POST로 폴백하면 안 된다.**
        //
        // 409에는 앱이 구분할 수 없는 두 경우가 섞여 있다:
        //   (A) 이중 PATCH — 앞선 요청이 이미 통계·코인을 커밋했다(응답만 유실된 경우 포함).
        //   (B) 12h 초과 자동마감(AUTO_CLOSED) — 서버가 "종료 시각을 신뢰할 수 없다"고 보고
        //       DailyFocusStat·스트릭에 아예 반영하지 않는 상태(FocusService.sweepOrphanSessions).
        // 여기서 POST로 폴백하면 (A)일 때 새 세션 행이 생겨 지급 멱등키가 갈리고 코인·통계가
        // 두 번 들어간다. 서버가 마커의 startedAt/endedAt을 클램프하므로 POST의 중복 검사
        // (existsByUserAndStartedAtAndEndedAtAndStatus — 완전 일치 필요)도 이 케이스를 못 잡는다.
        // (B)에서 이 블록의 시간을 포기하게 되지만, 그건 서버가 이미 정책으로 확정한 손실이고
        // 이중 지급보다 낫다. 유저에게 에러도 띄우지 않는다 — 이미 끝난 세션이다.
        if (status === 409) return { status: 'alreadyEnded' };
        // 그 외 실패는 마커가 열린 채일 수 있어 취소를 위임하고, 아래 POST로 폴백한다.
        onMarkerStillOpen?.(sessionId);
      }
    } else {
      // 클램프 창 밖 — PATCH를 안 태우므로 마커는 종전대로 취소로 닫는다.
      onMarkerStillOpen?.(sessionId);
    }
  }
  try {
    const response = await saveFocusSession(body, userId);
    return { status: 'saved', response };
  } catch {
    // 대기열엔 **POST 바디만** 넣는다 — PATCH를 큐에 넣으면 재전송 시점의 endedAt이 클램프 창
    // 밖이라 서버가 now로 올려 구간을 부풀린다. POST는 저장값을 그대로 쓰고 서버 중복 검사도
    // 붙어 있어, 재전송이 이중 계상되지 않는 유일한 경로다.
    try {
      await enqueuePendingFocusUpload(body, userId);
      return { status: 'queued' };
    } catch {
      return { status: 'failed' };
    }
  }
}
