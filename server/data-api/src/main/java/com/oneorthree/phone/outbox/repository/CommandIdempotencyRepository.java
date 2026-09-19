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

    /**
     * 사용자의 멱등 기록을 <b>전부</b> 지운다 (GROMO-1801 공개 receipt · GROMO-1946 legacy 내부 명령, 계정 LLD §4).
     *
     * <p>공개 명령 receipt({@code public:v1:*})에는 개인 응답(이름 등)이, legacy 내부 명령 행에는 저장된 응답
     * 봉투 속 기기 토큰 같은 자격이 들어 있다. 탈퇴 뒤에는 둘 다 재생 근거로 쓰이지 않는다 — 공개 명령은 재생
     * 전에 활성 검사가 거절하고, 탈퇴 자체의 기기 토큰 삭제 명령({@code withdraw:<userId>})은 탈퇴가 다시 불리지
     * 않으며(404) 실제 삭제는 이미 적힌 outbox 봉투가 나른다.
     *
     * @param userId 탈퇴하는 유저
     * @return 지운 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM CommandIdempotency c WHERE c.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
