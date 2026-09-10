package com.oneorthree.phone.common.port;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 프레즌스 NoOp — 공유 Redis 가 없는 환경(local·ci·loadtest, 그리고 채팅을 아직 안 띄운 환경)용.
 *
 * <p>선례: 같은 패키지의 {@code NoOpPushNotification}. 다만 게이팅은 프로파일이 아니라
 * <b>{@code focus.presence.enabled} 속성</b>이다 — 「Redis 가 붙어 있는가」는 프로파일이 아니라 배포
 * 구성의 문제라, dev·prod 안에서도 채팅 롤아웃 전후로 갈릴 수 있어야 한다.
 *
 * <p>{@link RedisFocusPresence} 와 조건이 정확히 배타적이라 <b>언제나 정확히 하나만</b> 만들어진다
 * ({@code havingValue="true"} ↔ {@code matchIfMissing=true, havingValue="false"}).
 * {@code @ConditionalOnMissingBean} 을 쓰지 않은 것은 그게 컴포넌트 스캔에서 평가 순서에 의존해
 * 「둘 다 없음」이나 「둘 다 있음」이 될 수 있기 때문이다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "focus.presence.enabled", havingValue = "false", matchIfMissing = true)
public class NoOpFocusPresence implements FocusPresencePort {

    @Override
    public void focusStarted(UUID userId, UUID sessionId) {
        log.debug("NoOp 프레즌스 — 집중 시작 무시, userId={} sessionId={}", userId, sessionId);
    }

    @Override
    public void restoreLeaseIfMissing(UUID userId, UUID sessionId) {
        log.debug("NoOp 프레즌스 — 재구축 무시, userId={} sessionId={}", userId, sessionId);
    }

    @Override
    public void focusEnded(UUID userId, UUID sessionId) {
        log.debug("NoOp 프레즌스 — 집중 종료 무시, userId={} sessionId={}", userId, sessionId);
    }
}
