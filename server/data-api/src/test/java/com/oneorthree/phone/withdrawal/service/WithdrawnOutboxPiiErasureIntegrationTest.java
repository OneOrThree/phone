package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupMemberStatus;
import com.oneorthree.phone.group.service.LinkMembershipEventService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 탈퇴 TX 가 outbox 봉투 속 이름 사본과 legacy 멱등 기록을 파기한다 (GROMO-1946 · 계정 LLD §4 「신규 일반
 * receipt·outbox·위성 projection 속 name/기기 자격」). 실제 Flyway 스키마·실제 relay 상태 열 위에서 본다.
 *
 * <p>봉투는 전달 상태별로 셋을 심는다 — 전달 완료(기록)·미시도(첫 전송 전)·시도했지만 미완료(재전달 대기).
 * 앞의 둘만 이름이 지워지고, 셋째는 같은 본문으로 다시 나가야 하므로 바이트 그대로 남아야 한다.
 */
@SpringBootTest
class WithdrawnOutboxPiiErasureIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired AccountWithdrawalService withdrawal;
    @Autowired LinkMembershipEventService linkEvents;
    @Autowired UserSatelliteCommandService satelliteCommands;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @PersistenceContext EntityManager em;

    @Test
    @DisplayName("탈퇴자 닉네임 변경 봉투는 재전달 대기분만 빼고 이름이 지워지고, legacy 멱등 기록도 전부 사라진다")
    void erasesDisplayNameCopiesAndLegacyIdempotencyRows() {
        UUID w = actor();
        UUID c = actor();
        joinSameGroup(w, c);
        UUID delivered = recordDisplayName(w, "W이름-완료");
        UUID pending = recordDisplayName(w, "W이름-미시도");
        UUID inFlight = recordDisplayName(w, "W이름-재전달대기");
        UUID other = recordDisplayName(c, "C이름");
        jdbc.update("update event_outbox_deliveries set delivered_at = now(), attempt_count = 1 where outbox_id = ?",
                delivered);
        jdbc.update("update event_outbox_deliveries set attempt_count = 1, last_error = 'HTTP 503' where outbox_id = ?",
                inFlight);
        String inFlightPayload = deliveryPayload(inFlight);
        // legacy 내부 명령 멱등 기록 — 저장된 응답 봉투에 기기 토큰이 든다
        satelliteCommands.recordDeviceTokenDeletion(w, new DeviceTokenDeletionRequest("token-w", null, 0L),
                "legacy-" + UUID.randomUUID());
        satelliteCommands.recordDeviceTokenDeletion(c, new DeviceTokenDeletionRequest("token-c", null, 0L),
                "legacy-" + UUID.randomUUID());
        assertThat(count("select count(*) from command_idempotency where user_id=? and response_body::text"
                + " like '%token-w%'", w)).isEqualTo(1L);

        withdrawal.withdraw(w);

        for (UUID erased : List.of(delivered, pending)) {
            assertThat(nameInParams(erased)).isNull();
            assertThat(nameInDelivery(erased)).isNull();
            // 키는 남기고 값만 null — 계약(inviterDisplayName: string|null)의 모양을 유지한다
            assertThat(count("select count(*) from event_outbox where id=?"
                    + " and jsonb_exists(params, 'inviterDisplayName')",
                    erased)).isEqualTo(1L);
        }
        // 재전달 대기 봉투는 바이트 그대로 — 본문이 바뀐 재전달은 소비자에서 영구 실패가 된다
        assertThat(nameInParams(inFlight)).isEqualTo("W이름-재전달대기");
        assertThat(deliveryPayload(inFlight)).isEqualTo(inFlightPayload);
        // 다른 사용자의 봉투는 그대로
        assertThat(nameInParams(other)).isEqualTo("C이름");
        assertThat(nameInDelivery(other)).isEqualTo("C이름");

        // legacy 행까지 탈퇴자 멱등 기록 전부 삭제(탈퇴 자신의 기기 토큰 삭제 기록 포함), 상대의 기록은 유지
        assertThat(count("select count(*) from command_idempotency where user_id=?", w)).isZero();
        assertThat(count("select count(*) from command_idempotency where user_id=?", c)).isEqualTo(1L);
        // 실제 토큰 삭제를 나르는 봉투는 남는다 — 지우면 알림 서버가 어떤 토큰을 지울지 모른다
        assertThat(count("select count(*) from event_outbox where user_id=? and type=?"
                + " and params->>'deviceToken' = 'token-w'",
                w, UserSatelliteCommandService.EVENT_DEVICE_TOKEN_DELETED)).isEqualTo(1L);
    }

    // ---------------------------------------------------------------- 픽스처

    private UUID actor() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private void joinSameGroup(UUID wId, UUID cId) {
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            Group group = Group.builder().name("이름" + UUID.randomUUID().toString().substring(0, 6)).maxMembers(10)
                    .build();
            em.persist(group);
            em.persist(GroupMember.builder().group(group).user(em.find(User.class, cId)).role(GroupMemberRole.OWNER)
                    .status(GroupMemberStatus.FOCUS).announcementPermission(GroupAnnouncementGrant.ALLOW).build());
            em.persist(GroupMember.builder().group(group).user(em.find(User.class, wId)).role(GroupMemberRole.MEMBER)
                    .status(GroupMemberStatus.FOCUS).announcementPermission(GroupAnnouncementGrant.ALLOW).build());
        });
    }

    /** 실제 닉네임 변경 경로가 적는 봉투 하나를 만들고 그 id 를 돌려준다(그룹 하나라 호출마다 한 건). */
    private UUID recordDisplayName(UUID userId, String name) {
        new TransactionTemplate(transactions).executeWithoutResult(
                status -> linkEvents.recordDisplayNameChanged(userId, name));
        return jdbc.queryForObject("select id from event_outbox where user_id=? and type=?"
                + " and params->>'inviterDisplayName' = ?", UUID.class,
                userId, LinkMembershipEventService.EVENT_DISPLAY_NAME_CHANGED, name);
    }

    private String nameInParams(UUID outboxId) {
        return jdbc.queryForObject("select params->>'inviterDisplayName' from event_outbox where id=?",
                String.class, outboxId);
    }

    private String nameInDelivery(UUID outboxId) {
        return jdbc.queryForObject("select payload->'params'->>'inviterDisplayName' from event_outbox_deliveries"
                + " where outbox_id=?", String.class, outboxId);
    }

    private String deliveryPayload(UUID outboxId) {
        return jdbc.queryForObject("select payload::text from event_outbox_deliveries where outbox_id=?",
                String.class, outboxId);
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}
