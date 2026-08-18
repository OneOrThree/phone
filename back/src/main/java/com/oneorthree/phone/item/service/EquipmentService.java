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
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
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

    // 유저 캐릭터 전체 장착 상태 조회
    public List<CharacterEquipmentResponse> getEquipment(UUID userId) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        // 예외도 변경 경로와 동일하게 UserException(NOT_FOUND, 404)으로 통일.
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        return characterEquipmentRepository.findByUser(user)
                .stream()
                .map(CharacterEquipmentResponse::from)
                .toList();
    }

    // 아이템 장착
    @Transactional
    public CharacterEquipmentResponse equip(UUID userId, UUID itemId) {
        User user = requireActiveUser(userId);
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
        payload.put("grade", item.getGrade());
        if (userItem.getCreatedAt() != null) {
            payload.put("acquired_at", userItem.getCreatedAt().toEpochMilli());
        }
        userActivityEventLogger.log(userId.toString(), UserActivityEvent.ITEM_EQUIPPED, payload);
        return response;
    }

    // 아이템 벗기
    @Transactional
    public void unequip(UUID userId, SlotType slotType) {
        User user = requireActiveUser(userId);
        characterEquipmentRepository
                .findByUserAndSlotType(user, slotType)
                .ifPresent(equipment -> {
                    equipment.unequip(); // item = null
                    characterEquipmentRepository.save(equipment);
                });
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 장착/해제처럼 users 행은 <b>읽기만 하고</b>
     * character_equipment 를 upsert 하는 변경 트랜잭션의 요청자 로드. 락 없는 findById 는 계정 탈퇴
     * (UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아 탈퇴의 정리 스캔 이후·커밋 이전에 낀
     * 변경이 유령(탈퇴자 명의 장착 행)으로 남는다. 탈퇴가 먼저 커밋되면 READ COMMITTED 재평가로 빈
     * 결과 → NOT_FOUND(404). 예외는 기존 EntityNotFoundException(핸들러 미등록 → 500) 대신 다른
     * 서비스와 동일한 UserException(NOT_FOUND, 404)으로 통일한다 — is_deleted 차단이 목적이므로
     * 유저 조회 실패의 와이어도 404 로 정상화(GROMO-1237).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }
}
