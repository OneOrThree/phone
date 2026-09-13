package com.oneorthree.phone.auth.repository;

import com.oneorthree.phone.auth.repository.domain.AuthSession;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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
     * 세션 회전 — <b>조건부 UPDATE(compare-and-swap)</b> 다 (A22 ㋣ · GROMO-1659 codex R10).
     *
     * <p><b>왜 엔티티 dirty checking 이 아닌가.</b> 회전 경로는 세션을 <b>락 없이</b>
     * ({@link #findByRefreshTokenHash}) 읽는다. 그 스냅샷으로 엔티티를 고쳐 두면 ① 같은 RT 로 들어온
     * 동시 갱신 둘이 «둘 다» 성공해 나중 커밋이 먼저 커밋의 새 RT 를 덮고(먼저 받은 클라이언트는
     * 죽은 RT 를 쥔 채 남는다), ② 그 사이 커밋된 로그아웃·탈퇴의 {@code revoked_at} 을 낡은 스냅샷이
     * 되살린다. 조건이 곧 CAS 라, 「여전히 그 RT 를 인정하고 여전히 살아 있을 때만」 바뀐다.
     *
     * <p><b>0 이면 회전을 포기하고 거절해야 한다</b> — 동시 회전의 패자거나 그 사이 세션이 끊긴
     * 것이고, 끊긴 세션은 되살리지 않는다.
     *
     * <p><b>호출 뒤 그 {@link AuthSession} 엔티티를 고치지 마라.</b> 벌크 UPDATE 는 영속성 컨텍스트를
     * 갱신하지 않아, 이후 dirty checking 이 붙으면 full-row UPDATE 가 방금 쓴 값을 되돌린다.
     * {@code updatedAt} 을 인자로 받는 것도 같은 이유다 — {@code @UpdateTimestamp} 는 벌크 경로에
     * 붙지 않는다.
     *
     * @param id           회전할 세션
     * @param expectedHash 조회 때 본 옛 RT 해시 — CAS 의 기대값
     * @param newHash      새 RT 의 SHA-256 hex
     * @param nonceHash    이 회전 뒤의 bootstrap 자격 해시. 이미 있던 값이면 그대로 넘긴다
     * @param sessionEpoch 유저 축 잠금 아래 새로 발급받은 fencing 값
     * @param now          갱신 시각
     * @return 1이면 회전 성공. 0이면 동시 회전의 패자이거나 이미 폐기된 세션이다
     */
    @Modifying
    @Query("UPDATE AuthSession s SET s.refreshTokenHash = :newHash, s.sessionEpoch = :sessionEpoch,"
            + " s.bootstrapNonceHash = :nonceHash, s.updatedAt = :now"
            + " WHERE s.id = :id AND s.refreshTokenHash = :expectedHash AND s.revokedAt IS NULL")
    int rotateIfCurrent(@Param("id") UUID id,
                        @Param("expectedHash") String expectedHash,
                        @Param("newHash") String newHash,
                        @Param("nonceHash") String nonceHash,
                        @Param("sessionEpoch") long sessionEpoch,
                        @Param("now") Instant now);

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
