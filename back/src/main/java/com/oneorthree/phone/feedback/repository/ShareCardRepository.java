package com.oneorthree.phone.feedback.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.feedback.domain.ShareCard;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ShareCardRepository extends JpaRepository<ShareCard, UUID> {

    Optional<ShareCard> findByGroupAndUser(Group group, User user);

    List<ShareCard> findByUser(User user);
}
