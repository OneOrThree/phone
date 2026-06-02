package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Room;
import com.oneorthree.phone.domain.RoomInvite;
import com.oneorthree.phone.domain.RoomInviteStatus;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomInviteRepository extends JpaRepository<RoomInvite, Long> {
    List<RoomInvite> findByInviteeAndStatus(User invitee, RoomInviteStatus status);
    Optional<RoomInvite> findByRoomAndInvitee(Room room, User invitee);
}
