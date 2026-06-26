package com.oneorthree.phone.social.repository;

import com.oneorthree.phone.social.domain.Friendship;
import com.oneorthree.phone.social.domain.FriendshipStatus;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    List<Friendship> findByFromUserAndStatus(User fromUser, FriendshipStatus status);

    List<Friendship> findByToUserAndStatus(User toUser, FriendshipStatus status);

    Optional<Friendship> findByFromUserAndToUser(User fromUser, User toUser);

    boolean existsByFromUserAndToUser(User fromUser, User toUser);
}
