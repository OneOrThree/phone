package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;


class UserItemRepositoryTest extends RepositoryTestBase {
    @Autowired
    private UserItemRepository userItemRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ItemRepository itemRepository;

    private User user;
    private Item item;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder()
                .nickname("테스터")
                .build());

        item = itemRepository.save(Item.builder()
                .name("테스트 모자")
                .slotType(SlotType.HAT)
                .rarity(Rarity.COMMON)
                .build());
    }

    @Test
    @DisplayName("아이템 지급 후 인벤토리 조회")
    void grantAndFindByUser() {
        // given
        userItemRepository.grantIfNotExists(user.getId(), item.getId());

        // when
        List<UserItem> result = userItemRepository.findByUser(user);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getItem().getName()).isEqualTo("테스트 모자");
    }

    @Test
    @DisplayName("중복 아이템 지급해도 에러 없이 1개만 존재")
    void grantDuplicate() {
        // given
        userItemRepository.grantIfNotExists(user.getId(), item.getId());
        userItemRepository.grantIfNotExists(user.getId(), item.getId());    //중복 지급

        // when
        List<UserItem> result = userItemRepository.findByUser(user);

        // then
        assertThat(result).hasSize(1);
    }
}
