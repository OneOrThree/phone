package com.oneorthree.phone.repository.social;

import com.oneorthree.phone.domain.social.Friendship;
import com.oneorthree.phone.domain.social.FriendshipStatus;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    List<Friendship> findByRequesterAndStatus(User requester, FriendshipStatus status);

    List<Friendship> findByReceiverAndStatus(User receiver, FriendshipStatus status);

    Optional<Friendship> findByRequesterAndReceiver(User requester, User receiver);

    boolean existsByRequesterAndReceiver(User requester, User receiver);
}
