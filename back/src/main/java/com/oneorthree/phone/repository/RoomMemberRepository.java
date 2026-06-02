package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Room;
import com.oneorthree.phone.domain.RoomMember;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomMemberRepository extends JpaRepository<RoomMember, Long> {
    List<RoomMember> findByRoom(Room room);
    List<RoomMember> findByUser(User user);
    Optional<RoomMember> findByUserAndRoom(User user, Room room);
}
