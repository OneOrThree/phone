package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.*;
import com.oneorthree.phone.repository.ItemRepository;
import com.oneorthree.phone.repository.UserItemRepository;
import com.oneorthree.phone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
public class InventoryServiceTest {

    @InjectMocks
    private InventoryService inventoryService;

    @Mock
    private UserRepository userRepository;
    @Mock
    private ItemRepository itemRepository;
    @Mock
    private UserItemRepository userItemRepository;

    @Test
    @DisplayName("인벤토리 조회 성공")
    void getInventorySuccess() {
        // given
        User user = User.builder().nickname("테스터").build();
        given(userRepository.findById(1L)).willReturn(Optional.of(user));
        given(userItemRepository.findByUser(user)).willReturn(List.of());

        // when
        List<UserItem> result = inventoryService.getInventory(1L);

        // then
        assertThat(result).isEmpty();
        verify(userItemRepository, times(1)).findByUser(user);
    }

    @Test
    @DisplayName("존재하지 않는 유저 인벤토리 조회 시 예외")
    void getInventoryFailUserNotFound() {
        // given
        given(userRepository.findById(99L)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> inventoryService.getInventory(99L))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("유저를 찾을 수 없습니다.");
    }

    @Test
    @DisplayName("아이템 지급 성공")
    void grantItemSuccess() {
        // given
        User user = User.builder().nickname("테스터").build();
        Item item = Item.builder().name("모자").slotType(SlotType.HAT).rarity(Rarity.COMMON).build();
        given(userRepository.findById(1L)).willReturn(Optional.of(user));
        given(itemRepository.findById(1L)).willReturn(Optional.of(item));

        // when
        inventoryService.grantItem(1L, 1L);

        // then
        verify(userItemRepository, times(1)).grantIfNotExists(1L, 1L);
    }
}
