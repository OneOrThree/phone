package com.oneorthree.phone.repository.room;

import com.oneorthree.phone.domain.room.Room;
import com.oneorthree.phone.domain.room.RoomStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoomRepository extends JpaRepository<Room, Long> {
    List<Room> findByStatus(RoomStatus status);
}
