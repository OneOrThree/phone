package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InviteLinkClickRepository extends JpaRepository<InviteLinkClick, UUID> {

    /**
     * deferred 매치 후보 — 같은 IP해시+OS 로 시간창 안에 찍힌 <b>미소진</b> 클릭 중 가장 최근 1건.
     *
     * <p>{@code PESSIMISTIC_WRITE}(SELECT … FOR UPDATE)로 잠근다. 잠그지 않으면 동시에 들어온 두
     * 매치 요청이 같은 클릭을 읽고 둘 다 소진 처리해, 한 클릭이 두 기기에 매치된다. 우리 트래픽
     * 규모에서 대기(SKIP LOCKED 아님)는 문제가 되지 않고, 오히려 두 번째 요청이 소진된 결과를
     * 보고 정확히 matched=false 로 떨어지는 편이 옳다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<InviteLinkClick> findFirstByIpHashAndOsAndMatchedFalseAndClickedAtAfterOrderByClickedAtDesc(
            String ipHash, String os, Instant clickedAfter);

    /** claim 대상 — 해당 링크에서 매치까지 간 클릭 중 아직 유저가 안 붙은 가장 최근 1건. */
    Optional<InviteLinkClick> findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNullOrderByMatchedAtDesc(UUID linkId);

    List<InviteLinkClick> findByLinkId(UUID linkId);
}
