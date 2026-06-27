package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByNickname(String nickname);

    Optional<User> findByRefreshToken(String refreshToken);

    // 닉네임 trgm fuzzy 검색 (NicknameSearchStrategy에서 호출).
    // 전제: pg_trgm 확장 + users.nickname GIN trgm 인덱스 (run-migration-v13.sh).
    // % = 트라이그램 유사도 매칭, <-> = 거리(가까운 순). 임계값 튜닝은 실데이터 기준(한글 gotcha 주의).
    @Query(value = "SELECT * FROM users u"
            + " WHERE u.nickname % :q AND u.deleted_at IS NULL"
            + " ORDER BY u.nickname <-> :q"
            + " LIMIT :limit", nativeQuery = true)
    List<User> searchByNicknameTrgm(@Param("q") String q, @Param("limit") int limit);
}
