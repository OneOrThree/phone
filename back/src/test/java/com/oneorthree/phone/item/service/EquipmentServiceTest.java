package com.oneorthree.phone.item.service;

import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.domain.CharacterEquipment;
import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.item.domain.Rarity;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.service.EquipmentService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.item.repository.ItemRepository;
import com.oneorthree.phone.item.repository.UserItemRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;

@ExtendWith(MockitoExtension.class)
@Disabled
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

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID USER_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");
    private static final UUID ITEM_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private User user;

    private Item item;

    @BeforeEach
    void setUp() {
        user = User.builder().nickname("테스터").build();
        item = Item.builder().name("조재영의 하얀 모자")
                .slotType(SlotType.HAIR)
                .rarity(Rarity.LEGENDARY)
                .build();
    }

    @Test
    @DisplayName("아이템 장착 성공")
    void equipSuccess() {
        // given
        given(userRepo.findById(USER_ID)).willReturn(Optional.of(user));
        given(itemRepo.findById(ITEM_ID)).willReturn(Optional.of(item));
        given(userItemRepo.existsByUserAndItem(user, item)).willReturn(true);
        given(characterEquipmentRepo.findByUserAndSlotType(user, SlotType.HAIR)).willReturn(Optional.empty());
        given(characterEquipmentRepo.save(any())).willAnswer(i -> i.getArgument(0));

        // when
        CharacterEquipmentResponse result = equipmentService.equip(USER_ID, ITEM_ID);

        // then
        assertThat(result.getItem().getName()).isEqualTo(item.getName());
        assertThat(result.getSlotType()).isEqualTo(SlotType.HAIR.name());
    }

    @Test
    @DisplayName("보유하지 않은 아이템 장착 시 예외")
    void equipFailNotOwned() {
        // given
        given(userRepo.findById(USER_ID)).willReturn(Optional.of(user));
        given(itemRepo.findById(ITEM_ID)).willReturn(Optional.of(item));
        given(userItemRepo.existsByUserAndItem(user, item)).willReturn(false);

        // when + then
        assertThatThrownBy(() -> equipmentService.equip(USER_ID, ITEM_ID))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("보유하지 않은 아이템입니다.");
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
