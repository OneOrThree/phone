package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// GROMO-584 — nickname 유니크 제약·existsByNicknameAndIdNot 이 실 DB 에서 작동하는지 검증.
class UserRepositoryTest extends RepositoryTestBase {

    @Autowired
    UserRepository userRepository;

    @Test
    @DisplayName("신규 User builder와 저장된 row의 기본 티어는 T1")
    void newUserDefaultsToTierOne() {
        User user = User.builder().build();

        assertThat(user.getTierLevel()).isEqualTo(1);
        assertThat(userRepository.saveAndFlush(user).getTierLevel()).isEqualTo(1);
    }

    @Test
    @DisplayName("ID 목록 티어 조회용 쿼리는 탈퇴 유저를 제외")
    void findAllByIdInAndIsDeletedFalseExcludesDeletedUsers() {
        User active = userRepository.save(User.builder().nickname("활성").tierLevel(2).build());
        User deleted = userRepository.save(User.builder().nickname("탈퇴").tierLevel(5).isDeleted(true).build());

        List<UserTierLevelProjection> result = userRepository.findTierLevelsByIdInAndIsDeletedFalse(
                List.of(active.getId(), deleted.getId()));

        assertThat(result).containsExactly(new UserTierLevelProjection(active.getId(), 2));
    }

    @Test
    @DisplayName("닉네임 중복 저장 → DataIntegrityViolationException")
    void duplicateNicknameRejected() {
        userRepository.saveAndFlush(User.builder().nickname("중복닉").build());

        assertThatThrownBy(() -> userRepository.saveAndFlush(User.builder().nickname("중복닉").build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("nickname null 은 다중 허용(게스트) — 유니크 위반 아님")
    void multipleNullNicknamesAllowed() {
        userRepository.saveAndFlush(User.builder().isGuest(true).build());
        User saved = userRepository.saveAndFlush(User.builder().isGuest(true).build());

        assertThat(saved.getId()).isNotNull();
    }

    @Test
    @DisplayName("existsByNicknameAndIdNot — 본인 제외(자기 닉네임 재사용 허용), 타인 닉네임만 true")
    void existsByNicknameAndIdNot() {
        User me = userRepository.saveAndFlush(User.builder().nickname("내닉").build());

        assertThat(userRepository.existsByNicknameAndIdNot("내닉", me.getId())).isFalse();       // 본인 → 허용
        assertThat(userRepository.existsByNicknameAndIdNot("내닉", UUID.randomUUID())).isTrue();  // 타인 → 중복
        assertThat(userRepository.existsByNicknameAndIdNot("없는닉", me.getId())).isFalse();
    }
}
