package com.oneorthree.phone.repository.user;

import com.oneorthree.phone.domain.user.Provider;
import com.oneorthree.phone.domain.user.SocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {
    // OAuth 로그인 시 기존 계정 찾기
    Optional<SocialAccount> findByProviderAndProviderId(Provider provider, String providerId);
}
