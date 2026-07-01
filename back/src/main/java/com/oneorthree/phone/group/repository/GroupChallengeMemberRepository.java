package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeMember;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

// GROMO-561: 스키마+매핑만. 진행/달성 집계·조회 쿼리는 별도 티켓에서 추가.
public interface GroupChallengeMemberRepository extends JpaRepository<GroupChallengeMember, UUID> {
}
