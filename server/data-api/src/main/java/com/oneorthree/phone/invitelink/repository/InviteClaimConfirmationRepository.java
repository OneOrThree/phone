package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteClaimConfirmation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * 확정 근거 저장소 (A22 ㋟).
 *
 * <p>{@code claimId} 조회 하나가 「이미 확정됐는가」의 전부다 — 같은 claim 이 두 번 확정되면 링크
 * 원장에 같은 귀속이 두 번 반영된다.
 */
public interface InviteClaimConfirmationRepository extends JpaRepository<InviteClaimConfirmation, UUID> {

    /**
     * @param claimId 링크 서버의 잠정 claim id
     * @return 이미 남긴 확정 근거
     */
    Optional<InviteClaimConfirmation> findByClaimId(UUID claimId);
}
