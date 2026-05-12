package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.CharacterEquipment;
import com.oneorthree.phone.domain.SlotType;
import com.oneorthree.phone.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CharacterEquipmentRepository extends JpaRepository<CharacterEquipment, Long> {
    // 유저의 전체 장착 상태 조회 (캐릭터 렌더링)
    List<CharacterEquipment> findByUser(User user);

    // 특정 슬롯 장착 상태 조회 (장착 / 해제)
    Optional<CharacterEquipment> findByUserAndSlotType(User user, SlotType slotType);
}
