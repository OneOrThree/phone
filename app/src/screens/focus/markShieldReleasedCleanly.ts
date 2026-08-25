import { updateLiveSession } from './liveSessionStore';

/**
 * 라이브 레코드에 "실드를 우리가 정상적으로 내렸다"는 표식을 남긴다 (GROMO-1604 코드리뷰).
 *
 * ## 왜 필요한가
 *
 * 세션 화면을 시스템 Back 으로 빠져나가면 **레코드를 일부러 남긴다** — 그 시점까지의 집중
 * 시간은 다음 실행의 고아 정산이 적립한다. 그래서 "레코드가 남아 있다"는 사실만으로는
 * 강제 종료를 뜻하지 않는데, 고아 정산은 그걸 근거로 "앱이 종료되면서 다른 앱 차단도 함께
 * 풀렸어요"를 띄웠다. **정상적으로 나갔고 실드도 정상 해제됐는데** 나가는 알림이다.
 *
 * 이 표식이 있으면 알림을 건너뛴다. 프로세스가 실제로 죽었다면 이 코드가 돌 기회 자체가
 * 없으므로 표식도 없다 — 그게 판별 근거다.
 *
 * ## 실패를 삼키는 이유
 *
 * 표식을 못 남기면 다음 실행에서 알림이 한 번 더 뜨는 것뿐이다. 화면을 떠나는 경로를
 * 붙잡아 둘 이유가 없다.
 */
export async function markShieldReleasedCleanly(startedAt: string): Promise<void> {
  try {
    // ⚠️ 읽기·확인·쓰기를 **한 덩어리로** 돈다(liveSessionStore). 이 함수는 화면을 떠나며
    //    도는데, 그 사이 finish 가 레코드를 지우고 새 세션이 자기 레코드를 썼을 수 있다.
    //    읽고 나서 따로 쓰면 그 창에서 남의 레코드를 덮는다.
    await updateLiveSession((rec) => {
      if (!rec) return null; // 정상 완료(finish)라 이미 지워졌다 — 남길 곳이 없다.
      if (rec.startedAt !== startedAt) return null; // 새 세션의 레코드다 — 건드리지 않는다.
      return { ...rec, shieldReleasedCleanly: true };
    });
  } catch {
    // 위 주석 참고 — 최악이 '알림 1회 오발행'이라 조용히 넘어간다.
  }
}
