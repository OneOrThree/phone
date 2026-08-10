package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupChallengeBetParticipantRepository
        extends JpaRepository<GroupChallengeBetParticipant, UUID> {

    boolean existsBySessionIdAndUserId(UUID sessionId, UUID userId);

    long countBySessionId(UUID sessionId);

    /**
     * 잠금 후 재조회용 단건 — 회차 행 잠금을 잡은 <b>뒤</b> 내 참가 행이 아직 있는지 다시 본다
     * (1258 P0 이중 환불 재발 방지: 잠금 대기 중 취소·탈퇴가 이미 처리했으면 없어야 정상).
     */
    @EntityGraph(attributePaths = "user")
    Optional<GroupChallengeBetParticipant> findBySessionIdAndUserId(UUID sessionId, UUID userId);

    /**
     * 조회 조립·정산 공용 배치 로드. 응답에 닉네임이 필요하고 정산도 userId 를 봐야 하므로
     * user 를 함께 fetch 해 참가자 수만큼의 추가 SELECT 를 막는다.
     */
    @EntityGraph(attributePaths = "user")
    List<GroupChallengeBetParticipant> findBySessionIdIn(Collection<UUID> sessionIds);
}
