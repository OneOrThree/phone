package com.oneorthree.phone.item.service;

import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.repository.ItemRepository;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
@Slf4j
public class InventoryService {
    private final UserRepository userRepository;
    private final ItemRepository itemRepository;
    private final UserItemRepository userItemRepository;

    /**
     * 내 인벤토리 조회
     * todo 조회 성능 개선
     */
    public List<UserItemResponse> getInventory(UUID userId) {
        // 순수 읽기 — 무락 활성 필터 (GROMO-1237). readOnly 트랜잭션이라 락 금지(FOR SHARE 거절).
        // 예외도 변경 경로와 동일하게 UserException(NOT_FOUND, 404)으로 통일.
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                        .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return userItemRepository.findByUser(user)
                .stream()
                .map(UserItemResponse::from)
                .toList();
    }

    /**
     * 아이템 지급 (테스트용)
     * todo 쓰기 성능 개선 및 로직 개선
     */
    @Transactional
    public void grantItem(UUID userId, UUID itemId) {
        requireActiveUser(userId);
        itemRepository.findById(itemId)
                .orElseThrow(() -> new EntityNotFoundException("아이템을 찾을 수 없습니다."));

        userItemRepository.grantIfNotExists(userId, itemId);
    }

    /**
     * 활성 검증 + 공유 락 (GROMO-801 락 규율, GROMO-1237) — 아이템 지급처럼 users 행은 <b>읽기만
     * 하고</b> user_items 를 insert 하는 변경 트랜잭션의 요청자 로드. 결과를 버리는 존재 확인이던
     * 기존 findById 를 락 조회로 바꿔 계정 탈퇴(유저 행 배타 락)와 직렬화한다 — 탈퇴가 먼저
     * 커밋되면 READ COMMITTED 재평가로 빈 결과 → NOT_FOUND(404). 예외는 기존
     * EntityNotFoundException(핸들러 미등록 → 500) 대신 다른 서비스와 동일한
     * UserException(NOT_FOUND, 404)으로 통일한다(GROMO-1237).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 FOR SHARE 를
     * 거절한다. 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private void requireActiveUser(UUID userId) {
        userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }
}
