package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.FirstIslandArrival;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 계정의 첫 섬 도착 사건 (GROMO-2741, V10). */
public interface FirstIslandArrivalRepository extends JpaRepository<FirstIslandArrival, UUID> {

    /**
     * 이미 있으면 아무것도 하지 않는다. 넣은 행 수(0|1)를 돌려준다. 메타 값이 없으면 호출부가 SKIPPED 로 넘긴다.
     * attempts 는 0 을 직접 넣는다 — Flyway 를 끈 local·ci 스키마(엔티티 생성)에는 DB 기본값이 없다.
     *
     * @param extinfoJson 16칸 문자열 배열의 JSON 텍스트(없으면 null)
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "INSERT INTO first_island_arrivals (user_id, event_id, island_id, occurred_at, anon_id, "
            + "advertiser_tracking_enabled, extinfo, client_ip, send_status, attempts, next_attempt_at) "
            + "VALUES (:userId, :eventId, :islandId, :occurredAt, CAST(:anonId AS varchar), "
            + "CAST(:tracking AS boolean), CAST(:extinfoJson AS jsonb), CAST(:clientIp AS varchar), :status, 0, "
            + "CAST(:nextAttemptAt AS timestamptz)) ON CONFLICT (user_id) DO NOTHING",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("eventId") UUID eventId,
            @Param("islandId") UUID islandId, @Param("occurredAt") Instant occurredAt,
            @Param("anonId") String anonId, @Param("tracking") Boolean tracking,
            @Param("extinfoJson") String extinfoJson, @Param("clientIp") String clientIp,
            @Param("status") String status, @Param("nextAttemptAt") Instant nextAttemptAt);

    /** 지금 보낼 차례인 PENDING 행 — 오래 기다린 것부터. */
    @Query("SELECT a FROM FirstIslandArrival a WHERE a.sendStatus = 'PENDING' AND a.nextAttemptAt <= :now "
            + "ORDER BY a.nextAttemptAt")
    List<FirstIslandArrival> findDue(@Param("now") Instant now, Pageable page);

    /**
     * 전송 결과를 적는다. PENDING 이 아니게 되면 매칭 값(anon_id·extinfo·client_ip)을 지운다(데이터 최소화).
     * 이미 종료된 행은 건드리지 않는다.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE first_island_arrivals SET send_status = :status, attempts = :attempts, "
            + "next_attempt_at = CAST(:nextAttemptAt AS timestamptz), sent_at = CAST(:sentAt AS timestamptz), "
            + "last_error = CAST(:lastError AS varchar), "
            + "anon_id = CASE WHEN :status = 'PENDING' THEN anon_id END, "
            + "extinfo = CASE WHEN :status = 'PENDING' THEN extinfo END, "
            + "client_ip = CASE WHEN :status = 'PENDING' THEN client_ip END "
            + "WHERE user_id = :userId AND send_status = 'PENDING'", nativeQuery = true)
    int recordResult(@Param("userId") UUID userId, @Param("status") String status,
            @Param("attempts") int attempts, @Param("nextAttemptAt") Instant nextAttemptAt,
            @Param("sentAt") Instant sentAt, @Param("lastError") String lastError);

    /** 탈퇴 정리 — 개인 이력이라 원문째 지운다. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM FirstIslandArrival a WHERE a.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
