package com.oneorthree.phone.repository.user;

import com.oneorthree.phone.domain.user.Provider;
import com.oneorthree.phone.domain.user.SocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface SocialAccountRepository extends JpaRepository<SocialAccount, UUID> {

    Optional<SocialAccount> findByProviderAndProviderId(Provider provider, String providerId);
}
