package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.QueryHints;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InviteLinkClickRepository extends JpaRepository<InviteLinkClick, UUID> {

    /** Hibernate 에서 {@code FOR UPDATE SKIP LOCKED} 를 뜻하는 lock timeout 매직값. */
    String SKIP_LOCKED = "-2";

    /**
     * deferred 매치 후보 — 같은 IP해시+OS 로 시간창 안에 찍힌 <b>미소진</b> 클릭 중 가장 최근 1건.
     *
     * <p>{@code PESSIMISTIC_WRITE}(SELECT … FOR UPDATE)로 잠근다. 잠그지 않으면 동시에 들어온 두
     * 매치 요청이 같은 클릭을 읽고 둘 다 소진 처리해, 한 클릭이 두 기기에 매치된다.
     *
     * <p>{@code SKIP LOCKED} 를 함께 쓰는 이유는 PostgreSQL 의 {@code FOR UPDATE} + {@code LIMIT}
     * 조합 때문이다. 그냥 기다리면, 잠금이 풀린 뒤 그 행이 조건에서 탈락했을 때 Postgres 는 다음
     * 후보를 다시 찾지 않고 <b>빈 결과</b>를 준다. 공유 Wi-Fi(같은 fingerprint)에서 후보가 여러 건
     * 쌓인 상황이 정확히 그 조건이라, 아직 남은 후보가 있는데도 매치 실패가 된다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = SKIP_LOCKED))
    Optional<InviteLinkClick> findFirstByIpHashAndOsAndMatchedFalseAndClickedAtAfterOrderByClickedAtDesc(
            String ipHash, String os, Instant clickedAfter);

    /** claim 대상 — 해당 링크에서 매치까지 간 클릭 중 아직 유저가 안 붙은 가장 최근 1건. */
    Optional<InviteLinkClick> findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNullOrderByMatchedAtDesc(UUID linkId);

    /** 링크별 클릭 목록 — 지금은 테스트가 상태 전이를 검증하는 데 쓰고, 링크별 집계의 조회 경로이기도 하다. */
    List<InviteLinkClick> findByLinkId(UUID linkId);
}
