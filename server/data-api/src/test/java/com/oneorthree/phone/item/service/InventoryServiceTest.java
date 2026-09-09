package com.oneorthree.phone.item.service;

import com.oneorthree.phone.item.dto.UserItemResponse;
import com.oneorthree.phone.item.repository.domain.Item;
import com.oneorthree.phone.item.repository.domain.SlotType;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.item.repository.ItemQueryService;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
@Disabled
public class InventoryServiceTest {

    @InjectMocks
    private InventoryService inventoryService;

    @Mock
    private UserQueryService userQueryService;

    @Mock
    private ItemQueryService itemQueryService;

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
        given(userQueryService.getCaller(USER_ID)).willReturn(user);
        given(userItemRepository.findByUser(user)).willReturn(List.of());

        // when
        List<UserItemResponse> result = inventoryService.getInventory(USER_ID);

        // then
        assertThat(result).isEmpty();
        verify(userItemRepository, times(1)).findByUser(user);
    }

    @Test
    @DisplayName("존재하지 않는(또는 탈퇴한) 유저 인벤토리 조회 시 UserException NOT_FOUND (GROMO-1237 예외 통일)")
    void getInventoryFailUserNotFound() {
        // given
        given(userQueryService.getCaller(USER_ID_99)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        // when & then
        assertThatThrownBy(() -> inventoryService.getInventory(USER_ID_99))
                .isInstanceOf(UserException.class)
                .extracting(e -> ((UserException) e).getErrorCode())
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("아이템 지급 성공")
    void grantItemSuccess() {
        // given
        User user = User.builder().nickname("테스터").build();
        Item item = Item.builder().name("모자").slotType(SlotType.HAIR).grade("COMMON").build();
        // GROMO-1237: 지급(변경) 경로는 공유 락 활성 조회를 쓴다(락 규율).
        given(userQueryService.getTargetForShare(USER_ID)).willReturn(user);   // 지급 대상 = 지목 유저
        given(itemQueryService.getItem(ITEM_ID)).willReturn(item);

        // when
        inventoryService.grantItem(USER_ID, ITEM_ID);

        // then
        verify(userItemRepository, times(1)).grantIfNotExists(USER_ID, ITEM_ID);
    }

    @Test
    @DisplayName("없는 유저에게 지급 → TARGET_USER_NOT_FOUND — 지급 대상은 요청자가 아니라 지목한 유저다 (GROMO-1725)")
    void grantItemToAbsentTargetThrowsTargetNotFound() {
        given(userQueryService.getTargetForShare(USER_ID_99))
                .willThrow(new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));

        assertThatThrownBy(() -> inventoryService.grantItem(USER_ID_99, ITEM_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.TARGET_USER_NOT_FOUND);
        verify(userQueryService, never()).getCallerForShare(any());
    }

}
