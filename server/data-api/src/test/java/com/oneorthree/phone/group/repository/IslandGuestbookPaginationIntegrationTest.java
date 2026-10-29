package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.IslandGuestbookEntry;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.UUID;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 방명록 전체 보관·페이지 조회 (GROMO-2304) — 지운 글 100개가 쌓인 섬에서도 살아 있는 글 45개를
 * 30개·15개로 모두 읽고, 저장된 글과 다른 섬을 건드리지 않는다. V129 부분 인덱스가 붙은 실 스키마에서 검증한다.
 */
@SpringBootTest
class IslandGuestbookPaginationIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandGuestbookEntryRepository entries;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("지운 글 100개 + 살아 있는 글 45개 → 30개·15개를 이어 읽고 모든 글·다른 섬은 그대로 남는다")
    void pagesAllLiveEntriesWithoutTrimming() {
        UUID island = island();
        UUID other = island();
        // created_at: 숫자가 클수록 오래됐다. 1~45 살아 있음, 46~145 이미 지움(가장 오래됨).
        seed(island, 145, 45);
        seed(other, 40, 40);
        PageRequest page = PageRequest.of(0, 30);
        // 차단 관계가 없는 요청자 — 차단 제외는 IslandBlockFilterIntegrationTest 가 본다
        UUID viewer = UUID.randomUUID();
        var first = entries.findFirstPage(island, viewer, page);
        assertThat(first).extracting(IslandGuestbookEntry::getContent)
                .containsExactlyElementsOf(IntStream.rangeClosed(1, 30).mapToObj(String::valueOf).toList());

        IslandGuestbookEntry anchor = first.get(29);
        var second = entries.findPageAfter(island, viewer, anchor.getCreatedAt(), anchor.getId(), page);
        assertThat(second).extracting(IslandGuestbookEntry::getContent)
                .containsExactlyElementsOf(IntStream.rangeClosed(31, 45).mapToObj(String::valueOf).toList());
        IslandGuestbookEntry last = second.get(14);
        assertThat(entries.findPageAfter(island, viewer, last.getCreatedAt(), last.getId(), page)).isEmpty();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_guestbook_entries WHERE island_id = ? "
                + "AND deleted_at IS NULL", Integer.class, island)).isEqualTo(45);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_guestbook_entries WHERE island_id = ? "
                + "AND deleted_at IS NOT NULL", Integer.class, island)).isEqualTo(100);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_guestbook_entries WHERE island_id = ? "
                + "AND deleted_at IS NULL", Integer.class, other)).as("다른 섬은 건드리지 않는다").isEqualTo(40);
    }

    private UUID island() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO islands (id, name, max_members, is_chat_enabled, invite_permission, status) "
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
