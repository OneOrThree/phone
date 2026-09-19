package com.oneorthree.phone.quest.repository;

import com.oneorthree.phone.quest.repository.domain.IslandQuestClaim;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface IslandQuestClaimRepository extends JpaRepository<IslandQuestClaim, UUID> {

    Optional<IslandQuestClaim> findByIslandIdAndOccurrenceIdAndKind(UUID islandId, UUID occurrenceId, String kind);
}
