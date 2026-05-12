package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.domain.UserItem;
import com.oneorthree.phone.repository.ItemRepository;
import com.oneorthree.phone.repository.UserItemRepository;
import com.oneorthree.phone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

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
    public List<UserItem> getInventory(Long userId) {
        User user = userRepository.findById(userId)
                        .orElseThrow(() -> new EntityNotFoundException("유저를 찾을 수 없습니다."));

        return userItemRepository.findByUser(user);
    }

    /**
     * 아이템 지급 (테스트용)
     * todo 쓰기 성능 개선 및 로직 개선
     */
    @Transactional
    public void grantItem(Long userId, Long itemId) {
        userRepository.findById(userId)
                .orElseThrow(() -> new EntityNotFoundException("유저를 찾을 수 없습니다."));
        itemRepository.findById(itemId)
                .orElseThrow(() -> new EntityNotFoundException("아이템을 찾을 수 없습니다."));

        userItemRepository.grantIfNotExists(userId, itemId);
    }
}
