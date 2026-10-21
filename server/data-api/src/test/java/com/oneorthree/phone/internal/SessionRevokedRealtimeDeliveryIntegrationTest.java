package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.repository.AuthSessionRepository;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * GROMO-2350 — 스위치 {@code auth.session-revoked.realtime-events-enabled} ON 이면 세션 폐기 사건이 NOTI 에 더해
 * REALTIME 으로도 남는다. 기본 OFF 에서 NOTI 1행뿐인 것은 {@code SatelliteCoreContractIntegrationTest} 가 잡는다.
 */
@SpringBootTest
class SessionRevokedRealtimeDeliveryIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("auth.session-revoked.realtime-events-enabled", () -> true);
    }

    @Autowired
    AuthService authService;
    @Autowired
    JwtProvider jwtProvider;
    @Autowired
    AuthSessionRepository authSessionRepository;
    @Autowired
    EventOutboxRepository eventOutboxRepository;
    @Autowired
    EventOutboxDeliveryRepository eventOutboxDeliveryRepository;

    @Test
    @DisplayName("스위치 ON — 로그아웃의 auth.session.revoked 는 NOTI(noti.sessionRevoked)와 REALTIME(auth.session.revoked) 2행이다")
    void logoutAddsRealtimeDelivery() {
        GuestLoginResponse login = authService.guestLogin();
        UUID userId = jwtProvider.extractUserId(login.accessToken());

        authService.logout(new LogoutRequest(login.refreshToken()));

        List<EventOutbox> revoked = eventOutboxRepository.findAll().stream()
                .filter(row -> row.getUserId().equals(userId) && row.getType().equals("auth.session.revoked"))
                .toList();
        assertThat(revoked).hasSize(1);
        // GROMO-2386 — realtime 펜스 TTL 의 근거: 폐기 시각 + AT 수명(ci 3600 s)
        Instant revokedAt = authSessionRepository.findById(login.sessionId()).orElseThrow().getRevokedAt();
        assertThat(Instant.parse((String) revoked.get(0).getParams().get("accessTokenExpiresAt")))
                .isEqualTo(revokedAt.plusSeconds(3600));
        List<EventOutboxDelivery> deliveries = eventOutboxDeliveryRepository.findByOutboxId(revoked.get(0).getId());
        assertThat(deliveries)
                .extracting(EventOutboxDelivery::getTarget, EventOutboxDelivery::getEndpointKey)
                .containsExactlyInAnyOrder(
                        tuple(OutboxTarget.NOTI, "noti.sessionRevoked"),
                        tuple(OutboxTarget.REALTIME, "auth.session.revoked"));
    }
}
