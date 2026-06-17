package com.oneorthree.phone.repository.group;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupChallenge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GroupChallengeRepository extends JpaRepository<GroupChallenge, Long> {

    List<GroupChallenge> findByGroupOrderByCreatedAtDesc(Group group);
}
