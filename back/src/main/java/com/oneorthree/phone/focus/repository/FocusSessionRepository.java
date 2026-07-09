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

    // orphan 정리용(GROMO-610) — 앱 강제종료 등으로 threshold 이전에 시작됐으나 아직 미종료인 세션.
    // 스케줄러가 조회해 시작+상한으로 종료시각을 채워 '영원히 집중중' 오염을 제거한다.
    List<FocusSession> findByEndedAtIsNullAndStartedAtBefore(Instant threshold);

    // 오늘 집중 여부 판정용(GROMO-579 순위 추월 억제조건 c) — 대상 유저들 중 오늘(KST 하루 구간)
    // 시작한 세션이 하나라도 있는 유저 id 집합을 반환. startedAt 기준(라이브·소프트딜리트 무관 — '오늘 집중 행동을 했나'만 판단).
    // 유저별 단건 조회 N+1 금지: 대상 유저 전체를 한 쿼리로 좁혀 in-memory 판정.
    @Query("SELECT DISTINCT s.user.id FROM FocusSession s "
            + "WHERE s.user.id IN :userIds AND s.startedAt >= :from AND s.startedAt < :to")
    List<UUID> findUserIdsWithSessionStartedBetween(@Param("userIds") Collection<UUID> userIds,
                                                    @Param("from") Instant from,
                                                    @Param("to") Instant to);

    // 기간 내 완료 세션 집계용 전체 조회 — 카테고리별 집중 통계(GROMO-524).
    // GROMO-671(커밋3): local_date 컬럼 제거로 endedAt(UTC) [from,to) 윈도우 기준으로 조회한다.
    // 취소(CANCELED) 세션은 제외(과거 deleted_at IS NULL 을 status 기반으로 전환), focusTag LEFT JOIN FETCH 로 N+1 방지.
    @Query("SELECT s FROM FocusSession s LEFT JOIN FETCH s.focusTag "
            + "WHERE s.user = :user "
            + "AND s.endedAt IS NOT NULL "
            + "AND s.endedAt >= :from "
            + "AND s.endedAt < :to "
            + "AND s.status <> com.oneorthree.phone.focus.domain.FocusSessionStatus.CANCELED")
    List<FocusSession> findCompletedSessionsInPeriod(@Param("user") User user,
                                                     @Param("from") Instant from,
                                                     @Param("to") Instant to);

    @Modifying
    @Query("UPDATE FocusSession f SET f.user = null WHERE f.user.id = :userId")
    void nullifyUser(@Param("userId") UUID userId);

    // 원자적 조건부 종료(GROMO-610) — 진행 중(endedAt IS NULL)인 경우에만 종료 시각을 채운다.
    // 반환값(영향 row 수)이 1이면 이 요청이 종료를 성사시킨 것이고, 0이면 이미 종료됨(동시/중복 PATCH).
    // DB 단일 UPDATE 로 read-modify-write 를 원자화해 endFocusSession 의 TOCTOU 이중 완료(통계 이중 누적)를 차단한다.
    @Modifying
    @Query("UPDATE FocusSession s SET s.endedAt = :endedAt "
            + "WHERE s.id = :id AND s.endedAt IS NULL")
    int endSessionIfActive(@Param("id") UUID id, @Param("endedAt") Instant endedAt);
}
