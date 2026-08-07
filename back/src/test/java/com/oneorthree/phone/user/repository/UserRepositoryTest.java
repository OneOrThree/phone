package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 닉네임 중복검사 쿼리 계약 (GROMO-1215) — 체크 API·저장 경로가 공유하는
 * existsByNicknameAndIdNot 의 본인 제외·null 닉네임 행 안전성을 실제 DB 로 검증한다.
 */
class UserRepositoryTest extends RepositoryTestBase {

    @Autowired
    UserRepository userRepository;

    @Test
    @DisplayName("existsByNicknameAndIdNot — 타인이 쓰는 닉네임 → true")
    void existsWhenOtherUserHasNickname() {
        userRepository.save(User.builder().nickname("점유닉").build());
        User me = userRepository.save(User.builder().nickname("내닉").build());

        assertThat(userRepository.existsByNicknameAndIdNot("점유닉", me.getId())).isTrue();
    }

    @Test
    @DisplayName("existsByNicknameAndIdNot — 자기 자신의 현재 닉네임은 제외 → false")
    void excludesOwnRow() {
        User me = userRepository.save(User.builder().nickname("내닉").build());

        assertThat(userRepository.existsByNicknameAndIdNot("내닉", me.getId())).isFalse();
    }

    @Test
    @DisplayName("existsByNicknameAndIdNot — nickname=null 행(탈퇴자)이 있어도 안전하게 false")
    void safeAgainstNullNicknameRows() {
        // 탈퇴 시 nickname=null 로 파기된다(withdraw 의 PII 파기) — 동등 비교(nickname = ?)는
        // null 행과 매치되지 않아야 하고, 쿼리 자체도 에러 없이 동작해야 한다.
        userRepository.save(User.builder().nickname(null).isDeleted(true).build());
        User me = userRepository.save(User.builder().nickname("내닉").build());

        assertThat(userRepository.existsByNicknameAndIdNot("아무닉", me.getId())).isFalse();
    }
}
