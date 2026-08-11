package com.oneorthree.phone.focus.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 라이브 집중 세션 시작 응답(GROMO-610).
 *
 * <p>생성된 세션 id 를 반환해 이후 종료(PATCH /focus-session)에서 sessionId 로 참조하게 한다.
 *
 * <p><b>{@code sessionId} 는 nullable 이다(GROMO-1287)</b> — 서버가 이 요청에 대해 마커를
 * <b>만들지 않았다</b>는 뜻이다. 이미 열려 있는 마커가 이 요청보다 논리적으로 나중에 시작한
 * 경우(백그라운드 복귀 리플레이의 과거 블록·요청 도착 역전·재전송)에 그렇다 —
 * 자세한 판정은 {@code FocusService.startFocusSession} javadoc 참고.
 *
 * <p><b>클라이언트가 할 일</b>: 그 블록은 마커 없이 {@code POST /focus-session}(완료 통째 저장)으로
 * 올린다. 앱은 이미 그 경로를 갖고 있다 — {@code uploadFocusBlock(sessionId: null)} 이 PATCH 를
 * 건너뛰고 곧바로 POST 한다(오프라인 시작 블록과 같은 길). <b>기존에 열려 있는 다른 마커의 id 를
 * 대신 쓰면 안 된다</b>: 서로 다른 블록이 같은 마커를 PATCH 하면 첫 요청만 적립되고 나머지는
 * {@code SESSION_ALREADY_ENDED}(폴백 금지 코드)를 받아 그 블록의 시간·코인이 영구 유실된다.
 *
 * @param sessionId 생성된 진행 중 세션 id. <b>null 이면 이 요청으로 마커를 만들지 않았다</b>(위 설명)
 * @param startedAt 확정된 시작 시각(클램프 적용). sessionId 가 null 이면 서버가 <i>썼을</i> 시각일 뿐
 *                  가리키는 세션이 없다
 */
public record FocusSessionStartResponse(
        UUID sessionId,
        Instant startedAt
) {
}
