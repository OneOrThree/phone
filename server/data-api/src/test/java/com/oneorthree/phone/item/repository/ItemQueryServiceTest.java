package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.item.repository.domain.Item;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

/**
 * 아이템 조회 계층 (GROMO-1655).
 *
 * <p><b>이 테스트는 잘못된 동작을 고정한다 — 알고 그렇게 한다.</b> {@code getItem} 은 저장소 전체에서
 * 유일하게 raw {@link EntityNotFoundException} 을 던지고, 그게 {@code GlobalExceptionHandler} 에
 * 없어 <b>404 가 아니라 500 으로 나간다</b>. 고치는 것은 GROMO-895 이고, GROMO-1655 는 "동작 변경 0"
 * 이 검증 기준이라 여기서 바꿀 수 없다.
 *
 * <p>그래서 지금 단언하는 것은 "이게 옳다"가 아니라 <b>"이관이 예외를 바꾸지 않았다"</b>이다.
 * GROMO-895 가 {@code ItemException(NOT_FOUND)} 로 고칠 때 이 테스트가 빨개지는 것이 정상이고,
 * 그때 함께 고치면 된다.
 */
@ExtendWith(MockitoExtension.class)
class ItemQueryServiceTest {

    private static final UUID ITEM_ID = UUID.randomUUID();

    @Mock
    private ItemRepository itemRepository;

    @InjectMocks
    private ItemQueryService itemQueryService;

    @Mock
    private Item item;

    @Test
    @DisplayName("아이템이 없으면 EntityNotFoundException — 전역 핸들러가 안 잡아 500 이다(GROMO-895)")
    void getItemThrowsRawEntityNotFound() {
        given(itemRepository.findById(ITEM_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> itemQueryService.getItem(ITEM_ID))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("아이템을 찾을 수 없습니다.");
    }

    @Test
    @DisplayName("아이템이 있으면 그대로 준다 — 락 없는 조회를 쓴다")
    void getItemReturnsItemWhenPresent() {
        given(itemRepository.findById(ITEM_ID)).willReturn(Optional.of(item));

        assertThat(itemQueryService.getItem(ITEM_ID)).isSameAs(item);
        verify(itemRepository).findById(ITEM_ID);
    }
}
