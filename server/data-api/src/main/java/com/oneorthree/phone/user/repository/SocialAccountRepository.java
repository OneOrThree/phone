package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SocialAccountRepository extends JpaRepository<SocialAccount, UUID> {

    /**
     * 로그인 조회 — deletedAt 필터 없음 (소프트딜리트 row도 찾아 재활성화 처리)
     */
    Optional<SocialAccount> findByProviderAndProviderId(Provider provider, String providerId);

    /**
     * 유저의 활성 연동 전체 조회
     */
    List<SocialAccount> findAllByUserAndDeletedAtIsNull(User user);

    /**
     * 특정 provider 활성 연동 단건 조회
     */
    Optional<SocialAccount> findByUserAndProviderAndDeletedAtIsNull(User user, Provider provider);

    // 활성 연동 수 집계 — 마지막 연동 해제 방지용
    long countByUserAndDeletedAtIsNull(User user);

    /**
     * 연동 해제 경로 전용 — 비관적 잠금(SELECT FOR UPDATE)으로 동시 DELETE race condition 방지
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT sa FROM SocialAccount sa WHERE sa.user = :user AND sa.deletedAt IS NULL")
    List<SocialAccount> findAllByUserAndDeletedAtIsNullForUpdate(@Param("user") User user);

    /**
     * 회원 탈퇴 — 해당 유저 소셜 연동 전체 하드 삭제 (provider_id PII 파기 + (provider,provider_id) 재가입 확보 + FK 프리). GROMO-635
     * clearAutomatically 는 벌크 DELETE 후 stale SocialAccount 재사용 방지(GROMO-635 리뷰).
     * flushAutomatically 를 함께 켜는 이유(GROMO-801): flush 없이 clear 만 하면 그때까지 영속성
     * 컨텍스트에 쌓인 미flush 변경(더티 체킹 UPDATE·persist·remove)이 통째로 버려진다 — 실제로
     * withdraw 의 소프트딜리트·지갑 삭제가 조용히 유실되고 있었다(통합 테스트가 고정).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM SocialAccount sa WHERE sa.user.id = :userId")
    void deleteByUserId(@Param("userId") UUID userId);
}
