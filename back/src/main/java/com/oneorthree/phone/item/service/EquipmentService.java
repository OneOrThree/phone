package com.oneorthree.phone.item.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.domain.CharacterEquipment;
import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.domain.UserItem;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.item.repository.ItemRepository;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class EquipmentService {

    private final UserRepository userRepository;
    private final ItemRepository itemRepository;
    private final UserItemRepository userItemRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private String notFoundUser = "유저를 찾을 수 없습니다.";

    // 유저 캐릭터 전체 장착 상태 조회
    public List<CharacterEquipmentResponse> getEquipment(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException(notFoundUser));
        return characterEquipmentRepository.findByUser(user)
                .stream()
                .map(CharacterEquipmentResponse::from)
                .toList();
    }

    // 아이템 장착
    @Transactional
    public CharacterEquipmentResponse equip(UUID userId, UUID itemId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException(notFoundUser));
        Item item = itemRepository.findById(itemId)
                .orElseThrow(() -> new EntityNotFoundException("아이템을 찾을 수 없습니다."));

        // 소유 여부 검증 + acquiredAt 확보 (신규 획득 스킨 장착 분석은 timestamp - acquired_at 시차로 도출)
        UserItem userItem = userItemRepository.findByUserAndItem(user, item)
                .orElseThrow(() -> new IllegalArgumentException("보유하지 않은 아이템입니다."));

        // 해당 슬롯에 이미 장착 -> 교체, 없으면 새로 생성 (UPSERT)
        CharacterEquipment equipment = characterEquipmentRepository
                .findByUserAndSlotType(user, item.getSlotType())
                .orElse(CharacterEquipment.builder()
                        .user(user)
                        .slotType(item.getSlotType())
                        .build());
        equipment.equip(item);
        CharacterEquipmentResponse response =
                CharacterEquipmentResponse.from(characterEquipmentRepository.save(equipment));

        // user_id 는 인증 유저(MDC)가 아니라 실제 장착 대상인 서비스 파라미터 userId 를 명시 오버로드로 기록.
        // payload 에 null 값 금지 — nullable 필드는 키 생략
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("item_id", itemId.toString());
        if (item.getSlotType() != null) {
            payload.put("slot_type", item.getSlotType().name());
        }
        payload.put("item_type", item.getItemType().name());
        payload.put("rarity", item.getRarity().name());
        if (userItem.getAcquiredAt() != null) {
            payload.put("acquired_at", userItem.getAcquiredAt().toEpochMilli());
        }
        userActivityEventLogger.log(userId.toString(), UserActivityEvent.ITEM_EQUIPPED, payload);
        return response;
    }

    // 아이템 벗기
    @Transactional
    public void unequip(UUID userId, SlotType slotType) {
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
