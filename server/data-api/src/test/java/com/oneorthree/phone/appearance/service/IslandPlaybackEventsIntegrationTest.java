package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.AppearanceCommandView;
import com.oneorthree.phone.appearance.dto.PlaybackView;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 공용 음악 사건 생산 게이트를 <b>켠</b> 동작 (GROMO-1779, island-playback LLD §5) —
 * {@code island-playback.events-enabled=true}. 기본값(OFF)은 {@link IslandPlaybackServiceIntegrationTest} 가 본다.
 *
 * <p>시설 게이트는 기본값(OFF) 그대로라 방송기 없는 섬도 통과한다 — 적립 연동 전 기존 롤아웃 가드와 같은 결.
 */
@SpringBootTest
class IslandPlaybackEventsIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-playback.events-enabled", () -> true);
    }

    @Autowired
    IslandPlaybackService service;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;
    @Autowired
    JdbcTemplate jdbc;

    @Test
    @DisplayName("같은 키의 병렬 PATCH 2건 — 결과가 같고 변경·사건은 1건뿐이다 (LLD §6)")
    void parallelSameKeyYieldsIdenticalResultAndOneEvent() throws Exception {
        UUID ownerId = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build()).getId();
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(users.getReferenceById(ownerId)).group(island)
                .role(GroupMemberRole.OWNER).build());
        UUID islandId = island.getId();
        seedOwnedCampfire(islandId);
        UUID key = UUID.randomUUID();
        Map<String, Object> values = Map.of("trackId", "campfire", "playing", true);

        List<Object> outcomes = IslandPlaybackServiceIntegrationTest.race(
                () -> service.patch(islandId, ownerId, key, List.copyOf(values.keySet()), values, 0L),
                () -> service.patch(islandId, ownerId, key, List.copyOf(values.keySet()), values, 0L));

        assertThat(outcomes).allSatisfy(o -> assertThat(o).isInstanceOf(AppearanceCommandView.class));
        assertThat(outcomes.get(0)).isEqualTo(outcomes.get(1));
        assertThat(service.get(islandId, ownerId).version()).isEqualTo(1);
        Long rows = jdbc.queryForObject("SELECT COUNT(*) FROM event_outbox WHERE type = 'playback.updated' "
                + "AND aggregate_id = ?", Long.class, islandId.toString());
        assertThat(rows).isEqualTo(1L);
    }

    private void seedOwnedCampfire(UUID islandId) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type, created_at) "
                + "VALUES ('campfire', 'campfire', 'audio', 'island', now()) ON CONFLICT (product_id) DO NOTHING");
        jdbc.update("INSERT INTO audio_tracks (product_id, duration_millis) VALUES ('campfire', 120500) "
                + "ON CONFLICT (product_id) DO NOTHING");
        jdbc.update("INSERT INTO owned_products (id, owner_type, group_id, product_id, granted_ref, granted_at) "
                + "VALUES (gen_random_uuid(), 'island', ?, 'campfire', 'test-grant', now())", islandId);
    }

    @Test
    @DisplayName("실제 변경만 playback.updated 1건 — aggregateVersion == payload.version, 무변경·재생은 사건이 없다")
    void realChangeWritesExactlyOneEvent() {
        User owner = users.save(User.builder().nickname("방장-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(owner).group(island).role(GroupMemberRole.OWNER).build());
        UUID islandId = island.getId();
        seedOwnedCampfire(islandId);
        UUID key = UUID.randomUUID();
        Map<String, Object> values = Map.of("trackId", "campfire", "playing", true);

        AppearanceCommandView<PlaybackView> changed = service.patch(islandId, owner.getId(), key,
                List.copyOf(values.keySet()), values, 0L);
        AppearanceCommandView<PlaybackView> replay = service.patch(islandId, owner.getId(), key,
                List.copyOf(values.keySet()), values, 0L);
        service.patch(islandId, owner.getId(), UUID.randomUUID(), List.of("playing"),
                Map.of("playing", true), 1L);   // 같은 playing — 무변경

        assertThat(changed.events()).hasSize(1);
        Map<String, Object> envelope = changed.events().get(0);
        assertThat(envelope.get("type")).isEqualTo("playback.updated");
        assertThat(envelope.get("islandId")).isEqualTo(islandId.toString());
        assertThat(((Number) envelope.get("aggregateVersion")).longValue()).isEqualTo(1L);
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
        assertThat(payload).containsEntry("trackId", "campfire")
                .containsEntry("playing", true)
                .containsEntry("changedBy", owner.getId().toString())
                .containsEntry("durationSeconds", 120.5)
                .containsEntry("effectiveAt", changed.data().effectiveAt());
        assertThat(((Number) payload.get("version")).longValue()).isEqualTo(1L);
        assertThat(replay.events()).as("재생은 저장된 봉투를 돌려줄 뿐 재발행하지 않는다")
                .isEqualTo(changed.events());
        Long rows = jdbc.queryForObject("SELECT COUNT(*) FROM event_outbox WHERE type = 'playback.updated' "
                + "AND aggregate_id = ?", Long.class, islandId.toString());
        assertThat(rows).isEqualTo(1L);
    }
}
