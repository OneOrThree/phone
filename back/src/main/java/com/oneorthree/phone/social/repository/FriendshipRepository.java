package com.oneorthree.phone.social.repository;

import com.oneorthree.phone.social.domain.Friendship;
import com.oneorthree.phone.social.domain.FriendshipStatus;
import com.oneorthree.phone.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FriendshipRepository extends JpaRepository<Friendship, Long> {

    List<Friendship> findByRequesterAndStatus(User requester, FriendshipStatus status);

    List<Friendship> findByReceiverAndStatus(User receiver, FriendshipStatus status);

    Optional<Friendship> findByRequesterAndReceiver(User requester, User receiver);

    boolean existsByRequesterAndReceiver(User requester, User receiver);
}
