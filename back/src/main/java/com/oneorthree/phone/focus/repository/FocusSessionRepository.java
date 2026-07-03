package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface FocusSessionRepository extends JpaRepository<FocusSession, UUID> {

    // 기간 필터 + 커서(keyset) 페이지네이션. UUID v7 id 는 생성 시간순이라 id 내림차순이 곧 최신순.
    // cursor 가 null 이면 첫 페이지. Slice 는 size+1 조회로 hasNext 를 판정(count 쿼리 없음).
    @Query("SELECT s FROM FocusSession s "
            + "WHERE s.user = :user AND s.startedAt BETWEEN :from AND :to "
            + "AND (:cursor IS NULL OR s.id < :cursor) "
            + "ORDER BY s.id DESC")
    Slice<FocusSession> findSessionsByCursor(@Param("user") User user,
                                             @Param("from") Instant from,
                                             @Param("to") Instant to,
                                             @Param("cursor") UUID cursor,
                                             Pageable pageable);

    // 진행 중(미종료) 세션 — 핀 친구 isFocusing 판정용. endedAt IS NULL.
    List<FocusSession> findByUserInAndEndedAtIsNull(Collection<User> users);

    @Modifying
    @Query("UPDATE FocusSession f SET f.user = null WHERE f.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);
}
