package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface GroupChallengeDurationRepository extends JpaRepository<GroupChallengeDuration, UUID> {

    List<GroupChallengeDuration> findByChallengeIdIn(Collection<UUID> challengeIds);
}
