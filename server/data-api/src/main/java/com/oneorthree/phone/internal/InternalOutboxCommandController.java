package com.oneorthree.phone.internal;

import com.oneorthree.phone.outbox.service.OutboxDeliveryAckPort;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 직접 전달 성공의 <b>완료 표시</b> (A22 ㊿ 의 「빠른 경로」).
 *
 * <h2>이 호출의 실패는 사용자 요청을 실패시키지 않는다</h2>
 * relay 가 한 번 더 보낼 뿐이고 위성의 멱등·version 규칙이 중복 적용을 흡수한다. 반대로 여기서
 * 실패를 올리면 <b>이미 반영된 변경이 사용자에게 오류로 보인다</b>. 그래서 호출자는 실패를 로그로만
 * 남기고, 우리는 <b>이미 완료된 행에 다시 와도 200</b> 으로 답한다.
 *
 * <h2>경로에 유저가 없다</h2>
 * 요청자는 {@code X-User-Id} 로 온다 — {@code InternalAuthFilter} 가 서비스 토큰과 허용목록을 이미
 * 통과시켰고, 「이 명령이 그 사람의 것인가」는 포트가 <b>질의 조건</b>으로 판정한다. 컨트롤러에서
 * 한 번 더 비교하면 같은 규칙이 두 곳에 생기고 그중 하나만 고쳐지는 날이 온다.
 */
@RestController
@RequestMapping("/internal/outbox-commands")
@RequiredArgsConstructor
public class InternalOutboxCommandController {

    private final OutboxDeliveryAckPort outboxDeliveryAckPort;

    /**
     * 알림 대상 전달 하나를 완료로 표시한다.
     *
     * <p>없는 명령·남의 명령·알림 대상이 없는 명령은 포트가 <b>한 코드</b>로 접는다 — 존재 여부가
     * 응답으로 갈리면 그 자체가 남의 명령 id 를 탐색하는 수단이 된다.
     *
     * @param commandId 명령 응답으로 받은 값. 요청형 명령의 {@code eventId} 와 같은 UUID 다
     * @param userId    {@code X-User-Id} — 필터가 검증한 요청자
     */
    @PostMapping("/{commandId}/delivered")
    public ResponseEntity<Void> markDelivered(
            @PathVariable UUID commandId, @RequestHeader("X-User-Id") UUID userId) {
        outboxDeliveryAckPort.acknowledgeNotificationDelivery(userId, commandId.toString());
        return ResponseEntity.ok().build();
    }
}
