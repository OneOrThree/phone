package com.oneorthree.phone.Repository;

import com.oneorthree.phone.domain.*;
import com.oneorthree.phone.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.repository.ItemRepository;
import com.oneorthree.phone.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

public class CharacterEquipmentRepositoryTest extends RepositoryTestBase{

    @Autowired
    private CharacterEquipmentRepository repo;

    @Autowired
    private UserRepository userRepo;

    @Autowired
    private ItemRepository itemRepo;

    private User user;
    private Item item;

    @BeforeEach
    void setUp() {
        user = userRepo.save(User.builder()
                .nickname("테스터")
                .build());

        item = itemRepo.save(Item.builder()
                .name("테스트 모자")
                .slotType(SlotType.HAT)
                .rarity(Rarity.COMMON)
                .build());
    }

    @Test
    @DisplayName("슬롯에 아이템 장착 후 조회")
    void equipAndFind() {
        // given
        CharacterEquipment equipment = CharacterEquipment.builder()
                .user(user)
                .item(item)
                .slotType(SlotType.HAT)
                .build();
        repo.save(equipment);

        // when
        Optional<CharacterEquipment> result = repo.findByUserAndSlotType(user, SlotType.HAT);

        // then
        assertThat(result).isPresent();
        assertThat(result.get().getItem().getName()).isEqualTo("테스트 모자");
    }
}
