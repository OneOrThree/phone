package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 방명록 30개 정리 (GROMO-2287) — 지운 글 100개가 쌓인 섬에서 {@code trimBeyondLatest30} 이 «살아 있는 글 중 최신 30개»
 * 만 남기고, 지운 글은 건드리지 않으며, 다른 섬은 그대로 둔다. 운영 저장소 질의를 V129 가 붙은 실 스키마에서 돌린다.
 */
@SpringBootTest
class IslandGuestbookTrimIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandGuestbookEntryRepository entries;
    @Autowired
    PlatformTransactionManager transactions;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("지운 글 100개 + 살아 있는 글 45개 → 최신 30개만 남고 15개가 지워진다, 이미 지운 글·다른 섬은 그대로")
    void trimKeepsNewest30AmongLive() {
        UUID island = island();
        UUID other = island();
        // created_at: 숫자가 클수록 오래됐다. 1~45 살아 있음, 46~145 이미 지움(가장 오래됨).
        seed(island, 145, 45);
        seed(other, 40, 40);
        Instant now = Instant.parse("2026-10-19T00:00:00Z");

        int trimmed = new TransactionTemplate(transactions).execute(status -> entries.trimBeyondLatest30(island, now));

        assertThat(trimmed).isEqualTo(15);
        List<Integer> live = jdbc.queryForList("SELECT content FROM island_guestbook_entries "
                + "WHERE island_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC", String.class, island)
                .stream().map(Integer::valueOf).toList();
        assertThat(live).containsExactlyElementsOf(java.util.stream.IntStream.rangeClosed(1, 30).boxed().toList());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_guestbook_entries WHERE island_id = ? "
                + "AND deleted_at IS NOT NULL", Integer.class, island)).isEqualTo(115);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_guestbook_entries WHERE island_id = ? "
                + "AND deleted_at IS NULL", Integer.class, other)).as("다른 섬은 건드리지 않는다").isEqualTo(40);
    }

    private UUID island() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '방명록섬', 10, true, 'OWNER_ONLY', 'WAITING')", id);
        return id;
    }

    /** content = 1..count(작을수록 최신), 앞의 {@code live} 개만 살아 있다. */
    private void seed(UUID island, int count, int live) {
        jdbc.update("INSERT INTO users (id, is_guest) SELECT gen_random_uuid(), false FROM generate_series(1, ?)", count);
        jdbc.update("INSERT INTO island_guestbook_entries (id, island_id, author_id, content, written_on, created_at, deleted_at) "
                + "SELECT gen_random_uuid(), ?, u.id, u.rn::text, DATE '2034-01-01', now() - (u.rn || ' hours')::interval, "
                + "CASE WHEN u.rn > ? THEN now() END "
                + "FROM (SELECT id, row_number() OVER () rn FROM (SELECT id FROM users ORDER BY id DESC LIMIT ?) x) u",
                island, live, count);
    }
}
