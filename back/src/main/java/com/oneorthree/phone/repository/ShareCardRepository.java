package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Room;
import com.oneorthree.phone.domain.ShareCard;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ShareCardRepository extends JpaRepository<ShareCard, Long> {
    Optional<ShareCard> findByRoomAndUser(Room room, User user);
    List<ShareCard> findByUser(User user);
}
