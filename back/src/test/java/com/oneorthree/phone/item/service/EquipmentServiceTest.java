package com.oneorthree.phone.item.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.domain.CharacterEquipment;
import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.item.domain.ItemType;
import com.oneorthree.phone.item.domain.PriceType;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.domain.UserItem;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.item.repository.ItemRepository;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
public class EquipmentServiceTest {

    @InjectMocks
    private EquipmentService equipmentService;

    @Mock
    private UserRepository userRepo;

    @Mock
    private ItemRepository itemRepo;

    @Mock
    private UserItemRepository userItemRepo;

    @Mock
    private CharacterEquipmentRepository characterEquipmentRepo;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID USER_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final Instant ACQUIRED_AT = Instant.parse("2026-06-01T00:00:00Z");

    private User user;

    private Item item;

    private UserItem userItem;

    @BeforeEach
    void setUp() {
        user = User.builder().nickname("테스터").build();
        // paymentType 은 ItemResponse.from 매핑에 필수 (과거 @Disabled 원인이던 NPE 방지)
        item = Item.builder().name("조재영의 하얀 모자")
                .itemType(ItemType.EQUIPPABLE)
                .slotType(SlotType.HAIR)
                .grade("LEGENDARY")
                .paymentType(PriceType.CURRENCY)
                .build();
        userItem = new UserItem(UUID.randomUUID(), user, item, ACQUIRED_AT, false);
    }

    @Test
    @DisplayName("아이템 장착 성공")
    void equipSuccess() {
        // given
        given(userRepo.findById(USER_ID)).willReturn(Optional.of(user));
        given(itemRepo.findById(ITEM_ID)).willReturn(Optional.of(item));
        given(userItemRepo.findByUserAndItem(user, item)).willReturn(Optional.of(userItem));
        given(characterEquipmentRepo.findByUserAndSlotType(user, SlotType.HAIR)).willReturn(Optional.empty());
        given(characterEquipmentRepo.save(any())).willAnswer(i -> i.getArgument(0));

        // when
        CharacterEquipmentResponse result = equipmentService.equip(USER_ID, ITEM_ID);

        // then
        assertThat(result.getItem().getName()).isEqualTo(item.getName());
        assertThat(result.getSlotType()).isEqualTo(SlotType.HAIR.name());
    }

    @Test
    @DisplayName("아이템 장착 성공 → ITEM_EQUIPPED(slot_type·item_type·grade·acquired_at) 발행 — 명시 userId 오버로드")
    void equipEmitsItemEquipped() {
        // given
        given(userRepo.findById(USER_ID)).willReturn(Optional.of(user));
        given(itemRepo.findById(ITEM_ID)).willReturn(Optional.of(item));
        given(userItemRepo.findByUserAndItem(user, item)).willReturn(Optional.of(userItem));
        given(characterEquipmentRepo.findByUserAndSlotType(user, SlotType.HAIR)).willReturn(Optional.empty());
        given(characterEquipmentRepo.save(any())).willAnswer(i -> i.getArgument(0));

        // when
        equipmentService.equip(USER_ID, ITEM_ID);

        // then: user_id 는 서비스 파라미터(장착 대상)를 명시 전달, acquired_at 은 epoch millis
        verify(userActivityEventLogger).log(USER_ID.toString(), UserActivityEvent.ITEM_EQUIPPED,
                Map.of("item_id", ITEM_ID.toString(),
                        "slot_type", "HAIR",
                        "item_type", "EQUIPPABLE",
                        "grade", "LEGENDARY",
                        "acquired_at", ACQUIRED_AT.toEpochMilli()));
    }

    @Test
    @DisplayName("보유하지 않은 아이템 장착 시 예외 + ITEM_EQUIPPED 미발행")
    void equipFailNotOwned() {
        // given
        given(userRepo.findById(USER_ID)).willReturn(Optional.of(user));
        given(itemRepo.findById(ITEM_ID)).willReturn(Optional.of(item));
        given(userItemRepo.findByUserAndItem(user, item)).willReturn(Optional.empty());

        // when + then
        assertThatThrownBy(() -> equipmentService.equip(USER_ID, ITEM_ID))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("보유하지 않은 아이템입니다.");
        verify(userActivityEventLogger, never()).log(anyString(), any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("존재하지 않는 유저 장착 시 예외")
    void equipFailUserNotFound() {
        // given
        given(userRepo.findById(USER_ID_99)).willReturn(Optional.empty());

        // when + then
        assertThatThrownBy(() -> equipmentService.equip(USER_ID_99, ITEM_ID))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("유저를 찾을 수 없습니다.");
    }

    @Test
    @DisplayName("아이템 해제 성공")
    void unequipSuccess() {
        // given
        CharacterEquipment equipment = CharacterEquipment.builder()
                .user(user)
                .slotType(SlotType.HAIR)
                .build();
        equipment.equip(item);

        given(userRepo.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepo.findByUserAndSlotType(user, SlotType.HAIR)).willReturn(Optional.of(equipment));

        // when
        equipmentService.unequip(USER_ID, SlotType.HAIR);

        // then
        assertThat(equipment.getItem()).isNull();
    }

}
