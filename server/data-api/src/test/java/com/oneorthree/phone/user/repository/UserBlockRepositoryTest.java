package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserBlock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// GROMO-676 — user_blocks 스키마+매핑 선반영 검증 (차단 기능 로직은 별도 티켓).
// 실 PostgreSQL(Testcontainers)에서 매핑 저장/조회와 (blocker_id, blocked_id) 유니크 제약
// 위반 → DataIntegrityViolationException 번역을 확인한다.
class UserBlockRepositoryTest extends RepositoryTestBase {

    @Autowired
    UserBlockRepository userBlockRepository;
    @Autowired
    UserRepository userRepository;

    private User blocker;
    private User blocked;

    @BeforeEach
    void setUp() {
        blocker = userRepository.save(User.builder().nickname("차단자").build());
        blocked = userRepository.save(User.builder().nickname("피차단자").build());
    }

    @Test
    @DisplayName("저장 후 findByBlockerAndBlocked 조회 — id·createdAt 채움 및 양쪽 FK 매핑 확인")
    void saveAndFindByBlockerAndBlocked() {
        UserBlock saved = userBlockRepository.saveAndFlush(UserBlock.builder()
                .blocker(blocker).blocked(blocked).build());

        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(userBlockRepository.findByBlockerAndBlocked(blocker, blocked))
                .hasValueSatisfying(block -> {
                    assertThat(block.getId()).isEqualTo(saved.getId());
                    assertThat(block.getBlocker().getId()).isEqualTo(blocker.getId());
                    assertThat(block.getBlocked().getId()).isEqualTo(blocked.getId());
                });
    }

    @Test
    @DisplayName("(blocker_id, blocked_id) 중복 저장 → DataIntegrityViolationException")
    void duplicateBlockRejected() {
        userBlockRepository.saveAndFlush(UserBlock.builder()
                .blocker(blocker).blocked(blocked).build());

        assertThatThrownBy(() -> userBlockRepository.saveAndFlush(UserBlock.builder()
                .blocker(blocker).blocked(blocked).build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
