package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 소셜 연동 행. 연동 <b>해제</b>는 소프트 딜리트({@code deletedAt})지만 <b>탈퇴</b>는 하드 삭제다 —
 * provider_id 가 PII 이고, 같은 소셜 계정으로 재가입할 수 있어야 하기 때문이다. 그래서 대부분의 조회에
 * {@code deletedAt IS NULL} 이 붙고, 로그인 조회만 일부러 그 조건을 뺀다(해제한 계정으로 다시 로그인하면
 * 그 행을 되살린다).
 */
public interface SocialAccountRepository extends JpaRepository<SocialAccount, UUID> {

    /**
     * 로그인 조회 — deletedAt 필터 없음 (소프트딜리트 row도 찾아 재활성화 처리)
     *
     * @param provider   소셜 제공자
     * @param providerId 제공자가 준 계정 식별자
     * @return 연동 행. <b>해제된 연동도 잡히므로</b> 호출측이 재활성화할지 새로 만들지 가른다.
     *         탈퇴한 계정의 행은 하드 삭제돼 없으므로 재가입은 새 연동이 된다
     */
    Optional<SocialAccount> findByProviderAndProviderId(Provider provider, String providerId);

    /**
     * 유저의 활성 연동 전체 조회
     *
     * @param user 연동 주인
     * @return 해제되지 않은 연동. 락이 없으므로 연동 해제와 경합하는 경로에서는
     *         {@link #findAllByUserAndDeletedAtIsNullForUpdate} 를 써야 한다
     */
    List<SocialAccount> findAllByUserAndDeletedAtIsNull(User user);

    /**
     * 특정 provider 활성 연동 단건 조회
     *
     * @param user     연동 주인
     * @param provider 찾을 제공자
     * @return 그 제공자의 활성 연동. 해제했거나 연동한 적이 없으면 빈 값
     */
    Optional<SocialAccount> findByUserAndProviderAndDeletedAtIsNull(User user, Provider provider);

    /**
     * 활성 연동 수 집계 — 마지막 연동 해제 방지용.
     *
     * @param user 연동 주인
     * @return 남아 있는 연동 수. 1이면 그 연동은 해제할 수 없다(로그인 수단이 사라진다)
     */
    // 활성 연동 수 집계 — 마지막 연동 해제 방지용
    long countByUserAndDeletedAtIsNull(User user);

    /**
     * 연동 해제 경로 전용 — 비관적 잠금(SELECT FOR UPDATE)으로 동시 DELETE race condition 방지
     *
     * @param user 연동 주인
     * @return 잠긴 활성 연동 전체. 개수 검사와 해제를 이 목록 위에서 함께 해야 동시 해제 두 건이
     *         각각 "아직 2개 남았다"를 보고 <b>마지막 하나까지 지우는</b> 일이 없다
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
     *
     * @param userId 탈퇴 유저 id
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM SocialAccount sa WHERE sa.user.id = :userId")
    void deleteByUserId(@Param("userId") UUID userId);
}
