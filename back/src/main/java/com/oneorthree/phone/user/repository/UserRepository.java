package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByNickname(String nickname);

    // 소프트딜리트(탈퇴) 유저 차단 (GROMO-635) — is_deleted=true 인 유저는 조회/변경 경로에서 제외.
    Optional<User> findByIdAndIsDeletedFalse(UUID id);

    @Query("SELECT new com.oneorthree.phone.user.repository.UserTierLevelProjection(u.id, u.tierLevel)"
            + " FROM User u WHERE u.id IN :ids AND u.isDeleted = false")
    List<UserTierLevelProjection> findTierLevelsByIdInAndIsDeletedFalse(@Param("ids") Collection<UUID> ids);

    /** 티어 정산처럼 실제 User 변경이 필요한 경로의 활성 사용자 엔티티 배치 조회. */
    List<User> findAllByIdInAndIsDeletedFalse(Collection<UUID> ids);

    // 인증 hot path 단일 조회 (GROMO-903) — 탈퇴 차단 판정(827)과 활동 갱신 판정(578)을 한 왕복으로 병합.
    // 이전엔 존재 확인(왕복 ①) 직후 오늘 이미 갱신된 유저에게도 UPDATE 트랜잭션(왕복 ②)이 매 요청 붙었다.
    // 왕복 ① 이 이미 그 유저 행을 PK 로 찾으므로, last_active_at 을 함께 읽어오면 왕복을 늘리지 않고 스로틀 판정이 끝난다.
    // empty = 없는 유저 or 소프트딜리트 → existsByIdAndIsDeletedFalse 가 false 이던 집합과 동일(=401 신호 불변).
    // (last_active_at 은 NOT NULL 이라 "행은 있는데 값이 null" 로 empty 가 되는 경우는 없다)
    @Query("SELECT u.lastActiveAt FROM User u WHERE u.id = :id AND u.isDeleted = false")
    Optional<Instant> findLastActiveAtIfActive(@Param("id") UUID id);

    // 닉네임 중복 검사 (GROMO-584) — 본인 제외(AndIdNot)로 자기 닉네임 재사용은 허용.
    boolean existsByNicknameAndIdNot(String nickname, UUID id);

    Optional<User> findByRefreshTokenHash(String hash);

    // 닉네임 trgm fuzzy 검색 (NicknameSearchStrategy에서 호출).
    // 전제: pg_trgm 확장 + users.nickname GIN trgm 인덱스 (run-migration-v13.sh).
    // % = 트라이그램 유사도 매칭, <-> = 거리(가까운 순). 임계값 튜닝은 실데이터 기준(한글 gotcha 주의).
    @Query(value = "SELECT * FROM users u"
            + " WHERE u.nickname % :q AND u.is_deleted = false"
            + " ORDER BY u.nickname <-> :q"
            + " LIMIT :limit", nativeQuery = true)
    List<User> searchByNicknameTrgm(@Param("q") String q, @Param("limit") int limit);

    // last_active_at 스로틀 갱신 (GROMO-578) — JwtFilter 인증 통과 지점에서 호출.
    // WHERE 의 last_active_at < :startOfTodayKst 가드로 하루 최대 1 row write/유저 (오늘 이미 갱신됐으면 0건 매치=무쓰기).
    // User 엔티티 로드 없이 UPDATE 만 — @Modifying 이라 호출측 @Transactional 필요.
    @Modifying
    @Query("UPDATE User u SET u.lastActiveAt = :now"
            + " WHERE u.id = :id AND u.lastActiveAt < :startOfTodayKst")
    int touchLastActiveAt(@Param("id") UUID id,
                          @Param("now") Instant now,
                          @Param("startOfTodayKst") Instant startOfTodayKst);

    // 미접속 복귀 푸시 대상 조회 (GROMO-578) — last_active_at 가 [startInclusive, endExclusive) KST 하루 구간에 든 유저.
    // 호출측이 D+3/7/14 각 단계의 KST 캘린더 하루 경계를 주입 → "정확히 N일째" 판정. isGuest·소프트딜리트 유저는 제외.
    // (deviceToken·알림설정 필터는 sendIfAllowed 가 처리 — 여기선 대상 셋만 좁힘)
    @Query("SELECT u FROM User u"
            + " WHERE u.isGuest = false AND u.isDeleted = false"
            + " AND u.lastActiveAt >= :startInclusive AND u.lastActiveAt < :endExclusive")
    List<User> findInactiveReturnTargets(@Param("startInclusive") Instant startInclusive,
                                         @Param("endExclusive") Instant endExclusive);
}
