package com.oneorthree.phone.auth.repository;

import com.oneorthree.phone.auth.repository.domain.AuthSession;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 세션 축 저장소 (A22 ㋣ · ㋞).
 *
 * <p><b>조회 셋이 서로 다른 것을 판정한다</b> — RT 해시로 찾는 것은 refresh·개별 로그아웃,
 * bootstrap nonce 로 찾는 것은 기기 등록의 세션 확인(㋤), 유저별 활성 목록은 전 기기 로그아웃·탈퇴다.
 * 하나로 합치면 「개별 로그아웃이 전 세션을 지운다」가 조용히 돌아온다.
 */
public interface AuthSessionRepository extends JpaRepository<AuthSession, UUID> {

    /**
     * @param refreshTokenHash RT 의 SHA-256 hex
     * @return 그 RT 를 인정하는 세션. 폐기 여부는 <b>거르지 않는다</b> — 호출부가 「없음」과
     *     「끊긴 세션」을 구분해야 한다
     */
    Optional<AuthSession> findByRefreshTokenHash(String refreshTokenHash);

    /**
     * 기기 등록의 세션 확인(㋤) — <b>배타 잠금</b>으로 읽는다.
     *
     * <p>확인과 fencing 값 전달을 같은 순서 경계에 넣기 위한 잠금이다. 무락으로 읽으면 확인 직후
     * 커밋된 로그아웃을 못 보고, 그 창으로 지연 등록이 「미사용 1회용 자격」으로 통과한다.
     *
     * @param userId    확인 대상 유저 — 남의 세션 자격을 통과시키지 않으려면 조건에 함께 넣어야 한다
     * @param nonceHash {@code deviceBootstrap} 의 SHA-256 hex
     * @return 그 유저의 세션
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM AuthSession s WHERE s.userId = :userId AND s.bootstrapNonceHash = :nonceHash")
    Optional<AuthSession> findByUserIdAndBootstrapNonceHashForUpdate(
            @Param("userId") UUID userId, @Param("nonceHash") String nonceHash);

    /**
     * 자격 없는 기기 등록의 세션 확인(㋤ 의 구 앱 경로) — <b>배타 잠금</b>으로 읽는다.
     *
     * <p>{@code deviceBootstrap} 을 저장하지 않는 구 앱은 자격을 제시하지 못한다. 그 대신 <b>서버가
     * 서명한 AT 의 {@code sid}</b> 로 같은 확인을 한다 — 위조할 수 없고, 자격 원문을 주고받지도
     * 않는다. 잠금이 필요한 이유는 위 조회와 같다: 무락으로 읽으면 확인 직후 커밋된 로그아웃을
     * 못 본다.
     *
     * @param userId    확인 대상 유저 — 남의 세션 id 를 통과시키지 않으려면 조건에 함께 넣어야 한다
     * @param sessionId AT 의 {@code sid} claim
     * @return 그 유저의 세션. 폐기 여부는 <b>거르지 않는다</b> — 호출부가 판정한다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM AuthSession s WHERE s.id = :sessionId AND s.userId = :userId")
    Optional<AuthSession> findByIdAndUserIdForUpdate(
            @Param("sessionId") UUID sessionId, @Param("userId") UUID userId);

    /**
     * @param userId 유저
     * @return 그 유저의 살아 있는 세션 전부 — 전 기기 로그아웃·탈퇴가 이 목록을 폐기한다
     */
    @Query("SELECT s FROM AuthSession s WHERE s.userId = :userId AND s.revokedAt IS NULL")
    List<AuthSession> findActiveByUserId(@Param("userId") UUID userId);
}
