package com.oneorthree.phone.repository.social;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.social.ShareCard;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ShareCardRepository extends JpaRepository<ShareCard, UUID> {

    Optional<ShareCard> findByGroupAndUser(Group group, User user);

    List<ShareCard> findByUser(User user);
}
