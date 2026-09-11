package com.oneorthree.phone.outbox.repository;

import com.oneorthree.phone.outbox.repository.domain.CommandIdempotency;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.UUID;

/** 명령 멱등 기록 (A21 · ㊼). */
public interface CommandIdempotencyRepository extends JpaRepository<CommandIdempotency, String> {

    /**
     * 키를 선점한다 — 이미 있으면 아무것도 하지 않는다.
     *
     * <p>{@code save()} 가 아닌 이유는 {@link AggregateVersionRepository#insertIfAbsent} 와 같다:
     * 동시 요청에서 UNIQUE 위반 예외가 트랜잭션을 오염시키면 재생조차 못 한다. 이 문장은 <b>상대
     * 트랜잭션이 끝날 때까지 기다렸다가</b> 0 을 돌려주므로, 첫 요청이 커밋된 뒤 두 번째가 저장된
     * 응답을 읽게 된다 — 그 대기가 바로 「첫 응답 유실이면 같은 봉투」의 직렬화 지점이다.
     *
     * <p>{@code response_body} 는 비운 채 선점한다. 같은 트랜잭션에서 곧바로 채워지므로
     * <b>커밋된 행은 항상 응답을 갖는다</b>.
     *
     * @param key         멱등 키
     * @param userId      명령 주체
     * @param commandType 명령 종류
     * @param fingerprint 요청 본문 지문
     * @param now         선점 시각
     * @return 1 = 이 호출이 선점했다(명령을 실행한다), 0 = 남이 이미 처리했다(재생한다)
     */
    @Modifying
    @Query(value = "INSERT INTO command_idempotency "
            + "(idempotency_key, user_id, command_type, request_fingerprint, response_body, created_at) "
            + "VALUES (:key, :userId, :commandType, :fingerprint, NULL, :now) "
            + "ON CONFLICT (idempotency_key) DO NOTHING", nativeQuery = true)
    int insertClaim(
            @Param("key") String key,
            @Param("userId") UUID userId,
            @Param("commandType") String commandType,
            @Param("fingerprint") String fingerprint,
            @Param("now") Instant now);
}
