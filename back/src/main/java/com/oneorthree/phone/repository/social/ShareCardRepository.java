package com.oneorthree.phone.repository.social;

import com.oneorthree.phone.domain.room.Room;
import com.oneorthree.phone.domain.social.ShareCard;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ShareCardRepository extends JpaRepository<ShareCard, Long> {
    Optional<ShareCard> findByRoomAndUser(Room room, User user);
    List<ShareCard> findByUser(User user);
}
