package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.CharacterEquipment;
import com.oneorthree.phone.domain.Item;
import com.oneorthree.phone.domain.SlotType;
import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.repository.ItemRepository;
import com.oneorthree.phone.repository.UserItemRepository;
import com.oneorthree.phone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class EquipmentService {

    private final UserRepository userRepository;
    private final ItemRepository itemRepository;
    private final UserItemRepository userItemRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;

    // 유저 캐릭터 전체 장착 상태 조회
    public List<CharacterEquipment> getEquipment(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("유저를 찾을 수 없습니다."));
        return characterEquipmentRepository.findByUser(user);
    }

    // 아이템 장착
    @Transactional
    public CharacterEquipment equip(Long userId, Long itemId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("유저를 찾을 수 없습니다."));
        Item item = itemRepository.findById(itemId)
                .orElseThrow(() -> new EntityNotFoundException("아이템을 찾을 수 없습니다."));

        // 소유 여부 검증
        if (!userItemRepository.existsByUserAndItem(user, item)) {
            throw new IllegalArgumentException("보유하지 않은 아이템입니다.");
        }

        // 해당 슬롯에 이미 장착 -> 교체, 없으면 새로 생성 (UPSERT)
        CharacterEquipment equipment = characterEquipmentRepository
                .findByUserAndSlotType(user, item.getSlotType())
                .orElse(CharacterEquipment.builder()
                        .user(user)
                        .slotType(item.getSlotType())
                        .build());
        equipment.equip(item);
        return characterEquipmentRepository.save(equipment);
    }

    // 아이템 벗기
    @Transactional
    public void unequip(Long userId, SlotType slotType) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("유저를 찾을 수 없습니다."));
        characterEquipmentRepository
                .findByUserAndSlotType(user, slotType)
                .ifPresent(equipment -> {
                    equipment.unequip(); // item = null
                    characterEquipmentRepository.save(equipment);
                });
    }
}
