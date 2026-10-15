package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// GROMO-581 — (provider, provider_id) 유니크 제약이 실제 스키마(create-drop, 엔티티 반영)에서 작동하는지 검증.
// Mockito 단위 테스트가 검증 못 하는 "실 DB 유니크 위반 → DataIntegrityViolationException 번역"을 확인.
class SocialAccountRepositoryTest extends RepositoryTestBase {

    @Autowired
    SocialAccountRepository socialAccountRepository;
    @Autowired
    UserRepository userRepository;

    @Test
    @DisplayName("(provider, provider_id) 중복 저장 → DataIntegrityViolationException")
    void duplicateProviderIdRejected() {
        User u1 = userRepository.save(User.builder().build());
        User u2 = userRepository.save(User.builder().build());
        socialAccountRepository.saveAndFlush(SocialAccount.builder()
                .user(u1).provider(Provider.KAKAO).providerId("dup-123").build());

        assertThatThrownBy(() -> socialAccountRepository.saveAndFlush(SocialAccount.builder()
                .user(u2).provider(Provider.KAKAO).providerId("dup-123").build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("provider 가 다르면 같은 provider_id 허용")
    void sameProviderIdDifferentProviderAllowed() {
        User u = userRepository.save(User.builder().build());
        socialAccountRepository.saveAndFlush(SocialAccount.builder()
                .user(u).provider(Provider.KAKAO).providerId("id-1").build());

        SocialAccount saved = socialAccountRepository.saveAndFlush(SocialAccount.builder()
                .user(u).provider(Provider.GOOGLE).providerId("id-1").build());

        assertThat(saved.getId()).isNotNull();
    }
}
