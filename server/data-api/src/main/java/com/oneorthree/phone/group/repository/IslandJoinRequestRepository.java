package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequestStatus;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * {@link IslandJoinRequest} 조회 — 소유 판정은 전부 {@code applicant_id} 를 함께 묶는다.
 *
 * <p>「id 만으로 찾아서 소유를 비교」하면 타인의 요청 존재 여부가 응답으로 새어 나간다 —
 * 존재하지 않는 것과 내 것이 아닌 것은 전부 같은 「없음」이어야 한다(§3.8).
 */
public interface IslandJoinRequestRepository extends JpaRepository<IslandJoinRequest, UUID> {

    /**
     * 요약 뷰의 «본인 최신 신청» — 열려 있든 닫혀 있든 최신 요청부터 내린다.
     * 호출측은 {@code PageRequest.of(0, 1)} 로 한 건만 취한다.
     */
    @Query("SELECT r FROM IslandJoinRequest r "
            + "WHERE r.island.id = :islandId AND r.applicant.id = :applicantId "
            + "ORDER BY r.createdAt DESC")
    List<IslandJoinRequest> findLatestByIslandIdAndApplicantId(
            @Param("islandId") UUID islandId, @Param("applicantId") UUID applicantId, Pageable pageable);

    /**
     * 같은 (섬, 신청자)의 열린 요청 — 정상 재시도는 새 행이 아니라 이 자원을 돌려준다(§3.7).
     */
    @Query("SELECT r FROM IslandJoinRequest r "
            + "WHERE r.island.id = :islandId AND r.applicant.id = :applicantId AND r.status = :status")
    Optional<IslandJoinRequest> findByIslandIdAndApplicantIdAndStatus(
            @Param("islandId") UUID islandId, @Param("applicantId") UUID applicantId,
            @Param("status") IslandJoinRequestStatus status);

    /**
     * 본인 요청 조회(/me/join-requests/{requestId}) — 타인 것은 여기서 이미 「없음」이다.
     */
    @Query("SELECT r FROM IslandJoinRequest r WHERE r.id = :id AND r.applicant.id = :applicantId")
    Optional<IslandJoinRequest> findByIdAndApplicantId(
            @Param("id") UUID id, @Param("applicantId") UUID applicantId);

    /**
     * 상태 전이용 배타 잠금 — 취소·승인·섬 종결이 서로를 직렬화하는 지점이다.
     * PESSIMISTIC_WRITE 는 락 타임아웃 힌트가 없으면 커밋된 업데이트를 무한정 기다린다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
    @Query("SELECT r FROM IslandJoinRequest r WHERE r.id = :id AND r.applicant.id = :applicantId")
    Optional<IslandJoinRequest> findByIdAndApplicantIdForUpdate(
            @Param("id") UUID id, @Param("applicantId") UUID applicantId);

    /**
     * 섬 종결 처리용 — 그 섬의 열린 요청 전부를 배타 잠금으로 집는다. 호출측은 이미 그룹 행을
     * 잠근 상태여야 하고, 신청 생성(같은 그룹 잠금)·신청자 취소(요청 행 잠금)와 모두 직렬화된다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
    @Query("SELECT r FROM IslandJoinRequest r WHERE r.island.id = :islandId AND r.status = :status")
    List<IslandJoinRequest> findByIslandIdAndStatusForUpdate(
            @Param("islandId") UUID islandId, @Param("status") IslandJoinRequestStatus status);

    /**
     * 직접 가입 성공 시 같은 (섬, 신청자)의 열린 요청을 닫기 위한 배타 잠금 — 신청자 취소와
     * 같은 잠금이라 둘 중 하나만 전이한다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
    @Query("SELECT r FROM IslandJoinRequest r "
            + "WHERE r.island.id = :islandId AND r.applicant.id = :applicantId AND r.status = :status")
    Optional<IslandJoinRequest> findByIslandIdAndApplicantIdAndStatusForUpdate(
            @Param("islandId") UUID islandId, @Param("applicantId") UUID applicantId,
            @Param("status") IslandJoinRequestStatus status);

    /**
     * 계정 탈퇴 정리용 — 탈퇴자가 신청자로 연 둔 요청 전부를 배타 잠금으로 집는다. 신청은
     * 멤버십과 무관하게 어떤 섬에나 남아 있을 수 있어, 탈퇴의 그룹 선점 목록에 잡히지 않는다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "3000"))
    @Query("SELECT r FROM IslandJoinRequest r WHERE r.applicant.id = :applicantId AND r.status = :status")
    List<IslandJoinRequest> findByApplicantIdAndStatusForUpdate(
            @Param("applicantId") UUID applicantId, @Param("status") IslandJoinRequestStatus status);

    /**
     * 요약 일괄 해석용 가벼운 참조 — 엔티티를 통째로 올리지 않고 «최신 신청 id + pending 여부»만
     * 뽑는다. 검색·탐색·내 섬 목록이 섬마다 쿼리를 내지 않게 한 번에 묶는다.
     */
    @Query("SELECT r.island.id AS islandId, r.id AS requestId, r.status AS status, r.createdAt AS createdAt "
            + "FROM IslandJoinRequest r "
            + "WHERE r.applicant.id = :applicantId AND r.island.id IN :islandIds")
    List<JoinRequestRef> findRefsByApplicantIdAndIslandIds(
            @Param("applicantId") UUID applicantId, @Param("islandIds") Collection<UUID> islandIds);

    /** «섬별 최신 요청» 해석에 필요한 최소 열만 담는 투영. */
    interface JoinRequestRef {

        UUID getIslandId();

        UUID getRequestId();

        IslandJoinRequestStatus getStatus();

        Instant getCreatedAt();
    }
}
