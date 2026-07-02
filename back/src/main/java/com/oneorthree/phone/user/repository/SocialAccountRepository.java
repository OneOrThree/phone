package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SocialAccountRepository extends JpaRepository<SocialAccount, UUID> {

    // 로그인 조회 — deletedAt 필터 없음 (소프트딜리트 row도 찾아 재활성화 처리)
    Optional<SocialAccount> findByProviderAndProviderId(Provider provider, String providerId);

    // 유저의 활성 연동 전체 조회
    List<SocialAccount> findAllByUserAndDeletedAtIsNull(User user);

    // 특정 provider 활성 연동 단건 조회
    Optional<SocialAccount> findByUserAndProviderAndDeletedAtIsNull(User user, Provider provider);

    // 활성 연동 수 집계 — 마지막 연동 해제 방지용
    long countByUserAndDeletedAtIsNull(User user);

    // 연동 해제 경로 전용 — 비관적 잠금(SELECT FOR UPDATE)으로 동시 DELETE race condition 방지
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT sa FROM SocialAccount sa WHERE sa.user = :user AND sa.deletedAt IS NULL")
    List<SocialAccount> findAllByUserAndDeletedAtIsNullForUpdate(@Param("user") User user);
}
