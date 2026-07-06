package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByNickname(String nickname);

    // 닉네임 중복 검사 (GROMO-584) — 본인 제외(AndIdNot)로 자기 닉네임 재사용은 허용.
    boolean existsByNicknameAndIdNot(String nickname, UUID id);

    Optional<User> findByRefreshToken(String refreshToken);

    // 닉네임 trgm fuzzy 검색 (NicknameSearchStrategy에서 호출).
    // 전제: pg_trgm 확장 + users.nickname GIN trgm 인덱스 (run-migration-v13.sh).
    // % = 트라이그램 유사도 매칭, <-> = 거리(가까운 순). 임계값 튜닝은 실데이터 기준(한글 gotcha 주의).
    @Query(value = "SELECT * FROM users u"
            + " WHERE u.nickname % :q AND u.deleted_at IS NULL"
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
            + " WHERE u.isGuest = false AND u.deletedAt IS NULL"
            + " AND u.lastActiveAt >= :startInclusive AND u.lastActiveAt < :endExclusive")
    List<User> findInactiveReturnTargets(@Param("startInclusive") Instant startInclusive,
                                         @Param("endExclusive") Instant endExclusive);
}
