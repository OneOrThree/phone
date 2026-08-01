package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface GroupChallengeBetParticipantRepository
        extends JpaRepository<GroupChallengeBetParticipant, UUID> {

    boolean existsByBetIdAndUserId(UUID betId, UUID userId);

    long countByBetId(UUID betId);

    /**
     * 조회 조립·정산 공용 배치 로드. 응답에 닉네임이 필요하고 정산도 userId 를 봐야 하므로
     * user 를 함께 fetch 해 참가자 수만큼의 추가 SELECT 를 막는다.
     */
    @EntityGraph(attributePaths = "user")
    List<GroupChallengeBetParticipant> findByBetIdIn(Collection<UUID> betIds);
}
