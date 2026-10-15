package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 닉네임 쿼리 계약 (GROMO-1215 · GROMO-1996) — 체크 API·저장 경로가 공유하는 중복 검사와, 친구 검색이
 * 쓰는 전체 일치 조회를 실제 DB 로 검증한다.
 *
 * <p>정책(policy-2026-09-14): 「닉네임은 <b>대소문자를 구분하지 않고</b> 중복될 수 없으며 앞뒤 공백 없이
 * 저장한다. 친구 검색은 대소문자를 구분하지 않고 <b>정확히 일치할 때만</b> 결과를 보여 주며 본인과
 * 탈퇴한 사용자는 제외한다.」 두 문장이 같은 {@code lower(nickname)} 축을 쓴다 — 축이 갈리면 「검색에는
 * 한 명만 잡혀야 하는데 두 명이 가입돼 있다」가 된다.
 */
class UserRepositoryTest extends RepositoryTestBase {

    @Autowired
    UserRepository userRepository;

    // ── 중복 검사 (대소문자 무시) ────────────────────────────

    @Test
    @DisplayName("중복 검사 — 타인이 쓰는 닉네임은 대소문자가 달라도 true (GROMO-1996)")
    void existsWhenOtherUserHasNickname() {
        userRepository.save(User.builder().nickname("Alice").build());
        User me = userRepository.save(User.builder().nickname("내닉").build());

        assertThat(userRepository.existsByNicknameIgnoreCaseAndIdNot("Alice", me.getId())).isTrue();
        assertThat(userRepository.existsByNicknameIgnoreCaseAndIdNot("alice", me.getId())).isTrue();
        assertThat(userRepository.existsByNicknameIgnoreCaseAndIdNot("ALICE", me.getId())).isTrue();
    }

    @Test
    @DisplayName("중복 검사 — 자기 자신의 현재 닉네임은 제외 → 대소문자만 바꾸는 변경도 막지 않는다")
    void excludesOwnRow() {
        User me = userRepository.save(User.builder().nickname("내닉").build());
        User latin = userRepository.save(User.builder().nickname("Alice").build());

        assertThat(userRepository.existsByNicknameIgnoreCaseAndIdNot("내닉", me.getId())).isFalse();
        assertThat(userRepository.existsByNicknameIgnoreCaseAndIdNot("ALICE", latin.getId())).isFalse();
    }

    @Test
    @DisplayName("중복 검사 — nickname=null 행(탈퇴자)이 있어도 안전하게 false")
    void safeAgainstNullNicknameRows() {
        // 탈퇴 시 nickname=null 로 파기된다(withdraw 의 PII 파기) — lower(NULL) 은 NULL 이라
        // 어떤 질의와도 매치되지 않아야 하고, 쿼리 자체도 에러 없이 동작해야 한다.
        userRepository.save(User.builder().nickname(null).isDeleted(true).build());
        User me = userRepository.save(User.builder().nickname("내닉").build());

        assertThat(userRepository.existsByNicknameIgnoreCaseAndIdNot("아무닉", me.getId())).isFalse();
    }

    // ── 친구 검색 조회 (대소문자 무시 전체 일치) ─────────────

    /**
     * 종전 trgm 유사도 검색은 부분 일치를 허용해 「닉네임 두 글자로 이 앱 사용자 훑기」가 됐다
     * (GROMO-1996). 그 메서드와 함께 「alicekim 이 alice 검색에 잡힌다」는 검증도 뒤집혔다.
     */
    @Test
    @DisplayName("친구 검색 조회 — 대소문자 무시 전체 일치, 부분 일치·탈퇴자 제외")
    void findActiveByNicknameIgnoreCase_matchesWholeNicknameOnly() {
        User alice = userRepository.save(User.builder().nickname("Alice").build());
        userRepository.save(User.builder().nickname("alicekim").build());          // 부분 일치 → 안 잡힌다
        userRepository.save(User.builder().nickname("zoe").isDeleted(true).build());   // 탈퇴자 → 제외

        assertThat(userRepository.findActiveByNicknameIgnoreCase("alice"))
                .get().extracting(User::getId).isEqualTo(alice.getId());
        assertThat(userRepository.findActiveByNicknameIgnoreCase("ALICE"))
                .get().extracting(User::getId).isEqualTo(alice.getId());
        // 부분 일치는 앞뒤 어느 쪽으로도 안 된다.
        assertThat(userRepository.findActiveByNicknameIgnoreCase("alic")).isEmpty();
        assertThat(userRepository.findActiveByNicknameIgnoreCase("alicek")).isEmpty();
        // 탈퇴자는 닉네임이 남아 있어도 안 잡힌다.
        assertThat(userRepository.findActiveByNicknameIgnoreCase("zoe")).isEmpty();
        assertThat(userRepository.findActiveByNicknameIgnoreCase("")).isEmpty();
    }
}
