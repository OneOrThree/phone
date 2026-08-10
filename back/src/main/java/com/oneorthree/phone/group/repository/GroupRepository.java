package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupRepository extends JpaRepository<Group, UUID> {

    List<Group> findByStatus(GroupStatus status);

    /**
     * 그룹 행 배타 락(SELECT … FOR UPDATE) — <b>챌린지 생성 직렬화 전용</b>(LLD §2.1 · GROMO-1422).
     *
     * <p>활성 4개 상한(FR-1)과 창 겹침(§A5)은 <b>그룹 전역</b> 불변식이라 행 단위 제약으로 못 지킨다 —
     * 동시 생성 2건이 둘 다 "3개네" 하고 통과하면 5개째가 들어온다(부분 유니크는 하루형 카테고리
     * 중복만 막는다). 생성은 그룹장 전용의 드문 동작이라 경합 비용은 없다시피 하다. 조회는 기존대로 무락.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from Group g where g.id = :id")
    Optional<Group> findByIdForUpdate(@Param("id") UUID id);

    // GROMO-676: groups.host_id 폐기 — 방장 여부는 group_members.role=OWNER 기준으로 판단한다.
    // A-0 소프트삭제: 활성 멤버십(is_left=false)만 센다. 이 필터가 없으면 종료된 그룹·위임 전 소유의
    // 잔존 OWNER 행이 남아, 계정 탈퇴가 영구히 막힌다(그룹 종료 시 방장 행은 leave 로 is_left=true 가 된다).
    @Query("select count(gm) > 0 from GroupMember gm "
            + "where gm.user.id = :userId and gm.role = com.oneorthree.phone.group.domain.GroupMemberRole.OWNER "
            + "and gm.isLeft = false")
    boolean existsGroupOwnedBy(@Param("userId") UUID userId);

    // 공개 그룹 이름 trgm fuzzy 검색. 비공개(is_private)·삭제 그룹은 제외한다.
    // 전제: pg_trgm 확장(V1) + groups.is_private(V17) + groups.name GIN trgm 인덱스(V18).
    // % = 트라이그램 유사도 매칭, <-> = 거리(가까운 순). 임계값(기본 0.3)은 닉네임 검색과 함께만 조정한다.
    @Query(value = "SELECT * FROM groups g"
            + " WHERE g.name % :q AND g.is_private = false AND g.deleted_at IS NULL"
            + " ORDER BY g.name <-> :q"
            + " LIMIT :limit", nativeQuery = true)
    List<Group> searchPublicByNameTrgm(@Param("q") String q, @Param("limit") int limit);

    // A-10: 그룹 찾기 검색어 입력 전 기본 목록 — 공개(비공개·삭제 제외) 그룹을 최신 생성순으로 상위 N개.
    @Query(value = "SELECT * FROM groups g"
            + " WHERE g.is_private = false AND g.deleted_at IS NULL"
            + " ORDER BY g.created_at DESC"
            + " LIMIT :limit", nativeQuery = true)
    List<Group> findTopPublicGroups(@Param("limit") int limit);
}
