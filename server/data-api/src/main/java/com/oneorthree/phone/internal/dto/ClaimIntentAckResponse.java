package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * claim 의도 <b>적재</b>의 응답 — {@link DurableCommandAckResponse} 에 {@code completed} 를 더한 것이다
 * (A22 ㊄ · ㉵).
 *
 * <h2>왜 공용 ack 를 쓰지 않는가</h2>
 * {@code completed} 는 <b>이 표면에서만</b> 뜻이 있다. 적재는 「같은 요청 키로 이미 끝난 명령인가」를
 * 물을 수 있는 유일한 경로이고, 나머지 내구 명령(설정·기기 토큰·claim 확정)에는 그 물음 자체가 없다.
 * 공용 ack 에 필드를 얹으면 항상 {@code false} 인 자리가 여러 표면에 생겨, 읽는 쪽이 그 {@code false}
 * 를 「아직 안 끝났다」는 <b>판정</b>으로 읽는다.
 *
 * <p>기존 세 필드는 이름·뜻·순서 그대로다 — 추가만 하는 변경이라 구 Business 도 그대로 읽는다.
 *
 * @param commandId 완료 표시 대상 — 이 의도의 id
 * @param eventId   불변 사건 식별자 — {@code link.claimIntent:<userId>:<SHA-256(멱등 키)>}
 * @param version   유저 축 aggregate 잠금 아래 발급된 단조 version(㊸)
 * @param completed 이 의도가 <b>이미 종결</b>됐는가. 같은 요청 키로 다시 온 종결된 의도가
 *                  {@code true} 고, 새로 적재된 의도와 아직 대기 중인 의도는 {@code false} 다.
 *                  <b>{@code true} 인 의도를 202 로 접으면 안 된다</b> — 재개 sweep 은
 *                  {@code PENDING} 만 보므로 그 202 는 아무도 이어받지 않는 거짓 약속이 된다
 */
public record ClaimIntentAckResponse(UUID commandId, String eventId, long version, boolean completed,
        String terminalCode) {
}
