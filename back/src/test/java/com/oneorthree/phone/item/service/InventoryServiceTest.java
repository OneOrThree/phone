package com.oneorthree.phone.item.service;

import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.service.InventoryService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.repository.ItemRepository;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
@Disabled
public class InventoryServiceTest {

    @InjectMocks
    private InventoryService inventoryService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private ItemRepository itemRepository;

    @Mock
    private UserItemRepository userItemRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID USER_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    @DisplayName("인벤토리 조회 성공")
    void getInventorySuccess() {
        // given
        User user = User.builder().nickname("테스터").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userItemRepository.findByUser(user)).willReturn(List.of());

        // when
        List<UserItemResponse> result = inventoryService.getInventory(USER_ID);

        // then
        assertThat(result).isEmpty();
        verify(userItemRepository, times(1)).findByUser(user);
    }

    @Test
    @DisplayName("존재하지 않는 유저 인벤토리 조회 시 예외")
    void getInventoryFailUserNotFound() {
        // given
        given(userRepository.findById(USER_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> inventoryService.getInventory(USER_ID_99))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("유저를 찾을 수 없습니다.");
    }

    @Test
    @DisplayName("아이템 지급 성공")
    void grantItemSuccess() {
        // given
        User user = User.builder().nickname("테스터").build();
        Item item = Item.builder().name("모자").slotType(SlotType.HAIR).grade("COMMON").build();
        // GROMO-1237: 지급(변경) 경로는 공유 락 활성 조회를 쓴다(락 규율).
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(itemRepository.findById(ITEM_ID)).willReturn(Optional.of(item));

        // when
        inventoryService.grantItem(USER_ID, ITEM_ID);

        // then
        verify(userItemRepository, times(1)).grantIfNotExists(USER_ID, ITEM_ID);
    }

}
