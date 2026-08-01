package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.domain.Group;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 비공개 그룹 차단의 <b>실제 경계</b>인 네이티브 검색 SQL 검증.
 *
 * <p>A안에서 비공개 그룹의 유일한 접근 통제는 "이름 검색에서 제외"뿐이고, 그 제외는
 * {@link GroupRepository#searchPublicByNameTrgm} 의 {@code is_private = false} 한 줄이 전부다.
 * 서비스 단위 테스트는 이 레포지토리를 모킹해 공개 그룹만 돌려주도록 미리 정해 놓으므로,
 * 누가 그 조건이나 {@code deleted_at} 필터·{@code %} 연산자·{@code LIMIT} 바인딩을 깨뜨려도
 * 전부 통과한다. 실 DB 로 그 갭을 메운다.
 *
 * <p>ci 프로파일은 Flyway 가 꺼져 있어(create-drop) 확장·인덱스가 생기지 않으므로, 쿼리가 전제하는
 * pg_trgm 확장과 trgm 인덱스를 테스트에서 직접 만든다(선례: FriendshipRepositoryTest).
 */
class GroupRepositoryTest extends RepositoryTestBase {

    private static final int LIMIT = 20;

    @Autowired
    GroupRepository groupRepository;
    @Autowired
    EntityManager em;

    @BeforeEach
    void enableTrgm() {
        // 확장이 없으면 % 와 <-> 자체가 존재하지 않는다.
        em.createNativeQuery("CREATE EXTENSION IF NOT EXISTS pg_trgm").executeUpdate();
        // V18 과 같은 인덱스 — 여기서는 트랜잭션 안이라 CONCURRENTLY 없이 만든다.
        // 정확성에 필수는 아니지만, 연산자 클래스(gin_trgm_ops)가 이 컬럼에 실제로 붙는지까지 확인된다.
        em.createNativeQuery("CREATE INDEX IF NOT EXISTS idx_groups_name_trgm"
                + " ON groups USING gin (name gin_trgm_ops)").executeUpdate();
    }

    private Group save(String name, boolean isPrivate) {
        return groupRepository.save(Group.builder().name(name).maxMembers(10).isPrivate(isPrivate).build());
    }

    @Test
    @DisplayName("공개 그룹만 반환한다 — 같은 이름이어도 비공개는 제외")
    void returnsOnlyPublicGroups() {
        Group open = save("스터디모임", false);
        Group secret = save("스터디모임", true);
        groupRepository.flush();

        List<Group> results = groupRepository.searchPublicByNameTrgm("스터디모임", LIMIT);

        assertThat(results).extracting(Group::getId).contains(open.getId());
        // 이 한 줄이 A안의 유일한 접근 통제다 — is_private 필터가 빠지면 여기서만 잡힌다
        assertThat(results).extracting(Group::getId).doesNotContain(secret.getId());
    }

    @Test
    @DisplayName("소프트 딜리트된 공개 그룹은 제외된다")
    void excludesSoftDeletedGroups() {
        Group alive = save("독서모임", false);
        Group deleted = save("독서모임", false);
        // deletedAt 은 setter 가 없어 네이티브로 찍는다(운영에서도 소프트딜리트는 이 컬럼만 채운다).
        groupRepository.flush();
        em.createNativeQuery("UPDATE groups SET deleted_at = :now WHERE id = :id")
                .setParameter("now", Instant.now())
                .setParameter("id", deleted.getId())
                .executeUpdate();

        List<Group> results = groupRepository.searchPublicByNameTrgm("독서모임", LIMIT);

        assertThat(results).extracting(Group::getId)
                .contains(alive.getId())
                .doesNotContain(deleted.getId());
    }

    @Test
    @DisplayName("LIMIT 파라미터가 실제로 반환 건수를 자른다")
    void appliesLimit() {
        for (int i = 0; i < 25; i++) {
            save("한국사스터디" + i, false);
        }
        groupRepository.flush();

        // LIMIT 은 바인딩 파라미터다 — 드라이버가 값을 못 받으면 여기서 깨진다
        assertThat(groupRepository.searchPublicByNameTrgm("한국사스터디", LIMIT)).hasSize(LIMIT);
        assertThat(groupRepository.searchPublicByNameTrgm("한국사스터디", 3)).hasSize(3);
    }

    @Test
    @DisplayName("거리(<->) 순으로 정렬된다 — 정확히 일치하는 이름이 선두")
    void ordersByTrigramDistance() {
        save("토익스터디아침반저녁반", false);
        Group exact = save("토익스터디", false);
        save("토익스터디주말", false);
        groupRepository.flush();

        List<Group> results = groupRepository.searchPublicByNameTrgm("토익스터디", LIMIT);

        assertThat(results).isNotEmpty();
        assertThat(results.get(0).getId()).isEqualTo(exact.getId());
    }

    @Test
    @DisplayName("특수문자 검색어도 바인딩으로 처리된다 — 인젝션·구문오류 없이 결과 0건")
    void bindsSpecialCharactersSafely() {
        save("평범한모임", false);
        groupRepository.flush();

        // 검색어는 @Param 바인딩이라 SQL 구문의 일부가 되지 않는다. 문자열 연결로 바뀌면 여기서 터진다.
        List<String> hostile = List.of("100%", "_", "'", "';DROP TABLE groups;--", "\\", "?");
        for (String query : hostile) {
            assertThatCode(() -> groupRepository.searchPublicByNameTrgm(query, LIMIT))
                    .as("검색어 %s", query)
                    .doesNotThrowAnyException();
        }

        // 테이블이 살아 있다 = 인젝션이 실행되지 않았다
        assertThat(groupRepository.searchPublicByNameTrgm("평범한모임", LIMIT)).hasSize(1);
    }

    @Test
    @DisplayName("유사도 임계값 아래(전혀 다른 이름)는 매칭되지 않는다")
    void doesNotMatchUnrelatedNames() {
        Group target = save("영어회화", false);
        Group other = save("헬스크루", false);
        groupRepository.flush();

        List<UUID> ids = groupRepository.searchPublicByNameTrgm("영어회화", LIMIT)
                .stream().map(Group::getId).toList();

        assertThat(ids).contains(target.getId()).doesNotContain(other.getId());
    }
}
