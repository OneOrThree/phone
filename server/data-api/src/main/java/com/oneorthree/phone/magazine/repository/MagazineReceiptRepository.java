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

    /**
     * 처음 받음을 적는다 — 이미 있으면 아무것도 하지 않는다. 같은 사람의 두 요청이 겹쳐도 PK 위반으로 실패하지 않고, 받은
     * 곳·시각은 먼저 들어온 값으로 고정된다.
     */
    @Modifying
    @Query(value = "INSERT INTO magazine_receipts (user_id, issue_id, received_place, received_at) "
            + "VALUES (:userId, :issueId, :place, :receivedAt) ON CONFLICT (user_id, issue_id) DO NOTHING",
            nativeQuery = true)
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
