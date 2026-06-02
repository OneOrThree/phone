package com.oneorthree.phone.repository.room;

import com.oneorthree.phone.domain.room.Room;
import com.oneorthree.phone.domain.room.RoomInvite;
import com.oneorthree.phone.domain.room.RoomInviteStatus;
import com.oneorthree.phone.domain.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomInviteRepository extends JpaRepository<RoomInvite, Long> {
    List<RoomInvite> findByInviteeAndStatus(User invitee, RoomInviteStatus status);
    Optional<RoomInvite> findByRoomAndInvitee(Room room, User invitee);
}
