package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.response.CharacterEquipmentResponse;
import com.oneorthree.phone.domain.CharacterEquipment;
import com.oneorthree.phone.domain.Item;
import com.oneorthree.phone.domain.Rarity;
import com.oneorthree.phone.domain.SlotType;
import com.oneorthree.phone.domain.User;
import com.oneorthree.phone.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.repository.ItemRepository;
import com.oneorthree.phone.repository.UserItemRepository;
import com.oneorthree.phone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;

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

    private User user;

    private Item item;

    @BeforeEach
    void setUp() {
        user = User.builder().nickname("테스터").build();
        item = Item.builder().name("조재영의 하얀 모자")
                .slotType(SlotType.HAT)
                .rarity(Rarity.LEGENDARY)
                .build();
    }

    @Test
    @DisplayName("아이템 장착 성공")
    void equipSuccess() {
        // given
        given(userRepo.findById(1L)).willReturn(Optional.of(user));
        given(itemRepo.findById(1L)).willReturn(Optional.of(item));
        given(userItemRepo.existsByUserAndItem(user, item)).willReturn(true);
        given(characterEquipmentRepo.findByUserAndSlotType(user, SlotType.HAT)).willReturn(Optional.empty());
        given(characterEquipmentRepo.save(any())).willAnswer(i -> i.getArgument(0));

        // when
        CharacterEquipmentResponse result = equipmentService.equip(1L, 1L);

        // then
        assertThat(result.getItem().getName()).isEqualTo(item.getName());
        assertThat(result.getSlotType()).isEqualTo(SlotType.HAT.name());
    }

    @Test
    @DisplayName("보유하지 않은 아이템 장착 시 예외")
    void equipFailNotOwned() {
        // given
        given(userRepo.findById(1L)).willReturn(Optional.of(user));
        given(itemRepo.findById(1L)).willReturn(Optional.of(item));
        given(userItemRepo.existsByUserAndItem(user, item)).willReturn(false);

        // when + then
        assertThatThrownBy(() -> equipmentService.equip(1L, 1L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("보유하지 않은 아이템입니다.");
    }

    @Test
    @DisplayName("존재하지 않는 유저 장착 시 예외")
    void equipFailUserNotFound() {
        // given
        given(userRepo.findById(99L)).willReturn(Optional.empty());

        // when + then
        assertThatThrownBy(() -> equipmentService.equip(99L, 1L))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("유저를 찾을 수 없습니다.");
    }

    @Test
    @DisplayName("아이템 해제 성공")
    void unequipSuccess() {
        // given
        CharacterEquipment equipment = CharacterEquipment.builder()
                .user(user)
                .slotType(SlotType.HAT)
                .build();
        equipment.equip(item);

        given(userRepo.findById(1L)).willReturn(Optional.of(user));
        given(characterEquipmentRepo.findByUserAndSlotType(user, SlotType.HAT)).willReturn(Optional.of(equipment));

        // when
        equipmentService.unequip(1L, SlotType.HAT);

        // then
        assertThat(equipment.getItem()).isNull();
    }

}
