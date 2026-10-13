package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.MagazineReceipt;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 계정당 1부의 받음 상태 (GROMO-2289, V115). */
public interface MagazineReceiptRepository extends JpaRepository<MagazineReceipt, MagazineReceipt.Key> {

    /** 받음 기록 삽입과 7호 밖 정리가 함께 쓰는 advisory 잠금 축. */
    String LOCK_KEY = "magazine-receipts";

    /**
     * 받음 기록 삽입 쪽 잠금 — <b>공유</b>라 받음끼리는 서로 막지 않고, 7호 밖 정리(배타)와만 줄을 선다. 트랜잭션 끝에서
     * 풀린다. 잡은 채로는 이 표의 행만 건드린다.
     *
     * @return 항상 true — 반환값이 아니라 호출 자체가 잠금이다
     */
    @Query(value = "SELECT true FROM (SELECT pg_advisory_xact_lock_shared(hashtextextended(:key, 0))) locked",
            nativeQuery = true)
    boolean lockForReceipt(@Param("key") String key);

    /** 7호 밖 정리 쪽 잠금 — <b>배타</b>. 진행 중인 받음 삽입이 모두 커밋된 뒤에 정리가 돈다. */
    @Query(value = "SELECT true FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) locked",
            nativeQuery = true)
    boolean lockForCleanup(@Param("key") String key);

    /**
     * 처음 받음을 적는다 — 그 호가 지금 최근 7호 안일 때만, 이미 있으면 아무것도 하지 않는다. 같은 사람의 두 요청이 겹쳐도
     * PK 위반으로 실패하지 않고, 받은 곳·시각은 먼저 들어온 값으로 고정된다. 7호 판정과 삽입이 한 문장이라 7호 밖이 된 호의
     * 행을 새로 만들지 않는다. 진행 중인 발행과의 겹침은 {@link #lockForReceipt}·{@link #lockForCleanup} 이 줄 세운다.
     */
    @Modifying
    @Query(value = "INSERT INTO magazine_receipts (user_id, issue_id, received_place, received_at) "
            + "SELECT :userId, i.id, :place, :receivedAt FROM magazine_issues i WHERE i.id = :issueId "
            + "AND i.id IN (SELECT id FROM magazine_issues ORDER BY issue_no DESC LIMIT 7) "
            + "ON CONFLICT (user_id, issue_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("issueId") UUID issueId, @Param("place") String place,
                       @Param("receivedAt") Instant receivedAt);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM MagazineReceipt r WHERE r.userId = :userId AND r.issueId = :issueId")
    Optional<MagazineReceipt> findForUpdate(@Param("userId") UUID userId, @Param("issueId") UUID issueId);

    @Query("SELECT r FROM MagazineReceipt r WHERE r.userId = :userId AND r.issueId IN :issueIds")
    List<MagazineReceipt> findByUserIdAndIssueIdIn(@Param("userId") UUID userId,
                                                   @Param("issueIds") Collection<UUID> issueIds);

    /** 최근 7호보다 오래된 호의 받음 상태 — 발행 배치가 지운다(지난 호는 7호까지만 보관, MAG-07). */
    @Modifying
    @Query(value = "DELETE FROM magazine_receipts WHERE issue_id NOT IN "
            + "(SELECT id FROM magazine_issues ORDER BY issue_no DESC LIMIT 7)", nativeQuery = true)
    int deleteOutsideLatestSeven();

    /** 계정 탈퇴 파기 — 유저 행은 익명화만 되고 지워지지 않아 V115 의 ON DELETE CASCADE 가 돌지 않는다. */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM MagazineReceipt r WHERE r.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
