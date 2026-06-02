package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.Room;
import com.oneorthree.phone.domain.RoomStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoomRepository extends JpaRepository<Room, Long> {
    List<Room> findByStatus(RoomStatus status);
}
