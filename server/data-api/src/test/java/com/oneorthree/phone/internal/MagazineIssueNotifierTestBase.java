package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 잡지 발행 알림(GROMO-2307) 통합 테스트의 공통 — 모드(LEGACY|OUTBOX)는 컨텍스트를 갈라야 해서 하위 클래스가
 * {@code @SpringBootTest(properties)} 로 정한다. 호는 발행 서비스 대신 행으로 심는다(알림 펼치기만 본다).
 */
abstract class MagazineIssueNotifierTestBase {

    static final LocalDate DATE = LocalDate.of(2034, 5, 10);
    static final Instant PUBLISHED_AT = Instant.parse("2034-05-09T22:00:00Z"); // 07:00 KST
    static final Instant NOW = Instant.parse("2034-05-09T22:05:00Z");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("magazine.enabled", () -> true);
    }

    @Autowired
    MagazineIssueNotifier notifier;
    @Autowired
    UserRepository users;
    @Autowired
    JdbcTemplate jdbc;

    UUID issueId;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE magazine_receipts, magazine_issues, notification_sent_logs");
        jdbc.execute("DELETE FROM event_outbox_deliveries");
        jdbc.execute("DELETE FROM event_outbox");
        jdbc.execute("UPDATE users SET is_deleted = true WHERE is_guest = false AND is_deleted = false");
        issueId = UUID.randomUUID();
        jdbc.update("INSERT INTO magazine_issues(id, issue_date, issue_no, published_at, editorial, promotion_count)"
                        + " VALUES (?, ?, 7, ?, '{\"ranking\":[],\"newIslands\":[],\"note\":{\"type\":\"EDITOR\","
                        + "\"body\":\"x\",\"tipNo\":null}}'::jsonb, 0)",
                issueId, java.sql.Date.valueOf(DATE), Timestamp.from(PUBLISHED_AT));
        ReflectionTestUtils.setField(notifier, "pageSize", 2);
    }

    /** 정식 계정 {@code formal} 명 + 게스트 1 + 탈퇴 1 — 대상은 정식 계정뿐이다. */
    List<UUID> usersFor(int formal) {
        List<UUID> ids = new java.util.ArrayList<>();
        for (int i = 0; i < formal; i++) {
            ids.add(users.save(User.builder().nickname("잡지알림-" + UUID.randomUUID()).language("ko").build()).getId());
        }
        users.save(User.builder().nickname("게스트-" + UUID.randomUUID()).isGuest(true).build());
        users.save(User.builder().nickname("탈퇴-" + UUID.randomUUID()).isDeleted(true).build());
        return ids;
    }

    Instant notifiedAt() {
        Timestamp stamp = jdbc.queryForObject("SELECT notified_at FROM magazine_issues WHERE id = ?",
                Timestamp.class, issueId);
        return stamp == null ? null : stamp.toInstant();
    }
}
