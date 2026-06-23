package com.oneorthree.phone.item.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.item.domain.CharacterEquipment;
import com.oneorthree.phone.item.domain.Item;
import com.oneorthree.phone.item.domain.Rarity;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.item.repository.ItemRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@Disabled
public class CharacterEquipmentRepositoryTest extends RepositoryTestBase {

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
                .slotType(SlotType.HAIR)
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
                .slotType(SlotType.HAIR)
                .build();
        repo.save(equipment);

        // when
        Optional<CharacterEquipment> result = repo.findByUserAndSlotType(user, SlotType.HAIR);

        // then
        assertThat(result).isPresent();
        assertThat(result.get().getItem().getName()).isEqualTo("테스트 모자");
    }

}
