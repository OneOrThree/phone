package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 그룹(방) 조회. "살아 있는 그룹"은 {@code status}(종료 여부)와 {@code deletedAt}(소프트 삭제) 두 축을
 * 함께 봐야 하는데, 아래 검색 쿼리들은 {@code deleted_at IS NULL} 만 걸고 종료(ENDED) 방은 거르지 않는다.
 *
 * <p>방장 판정은 이 테이블이 아니라 group_members 를 통해 한다(GROMO-676 이후 {@code host_id} 폐기) —
 * {@link #existsGroupOwnedBy} 가 그 조회를 이 리포지토리에 두고 있는 이유는 호출부가 유저 도메인이라서다.
 */
public interface GroupRepository extends JpaRepository<Group, UUID> {

    /**
     * 상태별 그룹 전량 조회 — <b>프로덕션 호출부가 없다</b>. 페이징·삭제 필터가 없어 그대로 쓰면
     * 지워진 방까지 전부 실린다.
     *
     * @param status 찾을 상태. 살아 있는 방은 사실상 전부 {@code WAITING} 이라 이 축만으로는 거의
     *     걸러지지 않는다
     * @return 조건에 맞는 그룹 전량(정렬·상한 없음). 빈 리스트는 그 상태의 방이 없다는 뜻일 뿐이다
     */
    List<Group> findByStatus(GroupStatus status);

    /**
     * 그룹 행 배타 락(SELECT … FOR UPDATE) — <b>챌린지 생성 직렬화 전용</b>(LLD §2.1 · GROMO-1422).
     *
     * <p>활성 4개 상한(FR-1)과 창 겹침(§A5)은 <b>그룹 전역</b> 불변식이라 행 단위 제약으로 못 지킨다 —
     * 동시 생성 2건이 둘 다 "3개네" 하고 통과하면 5개째가 들어온다(부분 유니크는 하루형 카테고리
     * 중복만 막는다). 생성은 그룹장 전용의 드문 동작이라 경합 비용은 없다시피 하다. 조회는 기존대로 무락.
     *
     * @param id 잠글 그룹 id
     * @return 잠긴 그룹 행. <b>상태·삭제를 보지 않으므로</b> 종료됐거나 지워진 방도 그대로 나온다 —
     *     그 판단은 호출측 몫이다. 다른 트랜잭션이 같은 행을 쥐고 있으면 여기서 <b>대기</b>한다
     *     (건너뛰지 않는다). readOnly 트랜잭션에서는 쓸 수 없다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from Group g where g.id = :id")
    Optional<Group> findByIdForUpdate(@Param("id") UUID id);

    /**
     * 그룹 행 <b>공유 락</b> — 「읽은 상태가 커밋까지 유지돼야 하지만 그룹을 바꾸지는 않는」 판정용
     * (GROMO-1660 · A22 ⓚ).
     *
     * <p>초대 자격 확정이 그 자리다. 무락으로 읽으면 판독 직후 커밋된 그룹 종료를 못 보고, 그 창으로
     * <b>이미 닫힌 그룹의 초대가 유효 귀속으로 확정</b>된다. 배타 락을 쓰지 않는 이유는 이 경로가
     * 그룹 행을 바꾸지 않기 때문이다 — 동시 확정끼리는 막을 이유가 없다.
     *
     * @param id 대상 그룹
     * @return 그 그룹. 소프트삭제·종료 여부는 <b>호출부가</b> 판정한다 — 여기서 걸러 내면
     *     「없는 그룹」과 「닫힌 그룹」이 한 값으로 뭉개진다
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select g from Group g where g.id = :id")
    Optional<Group> findByIdForShare(@Param("id") UUID id);

    /**
     * GROMO-676: groups.host_id 폐기 — 방장 여부는 group_members.role=OWNER 기준으로 판단한다.
     * A-0 소프트삭제: 활성 멤버십(is_left=false)만 센다. 이 필터가 없으면 종료된 그룹·위임 전 소유의
     * 잔존 OWNER 행이 남아, 계정 탈퇴가 영구히 막힌다(그룹 종료 시 방장 행은 leave 로 is_left=true 가 된다).
     *
     * @param userId 탈퇴를 시도하는 유저 id
     * @return 아직 방장으로 남은 활성 멤버십이 하나라도 있으면 true — 탈퇴를 막는 근거다.
     *     <b>그룹이 종료됐거나 소프트 삭제됐는지는 보지 않는다</b>(방장 행 자체가 leave 로 정리된다는
     *     전제에 기댄다)
     */
    @Query("select count(gm) > 0 from GroupMember gm "
            + "where gm.user.id = :userId "
            + "and gm.role = com.oneorthree.phone.group.repository.domain.GroupMemberRole.OWNER "
            + "and gm.isLeft = false")
    boolean existsGroupOwnedBy(@Param("userId") UUID userId);

    /**
     * 공개 그룹 이름 trgm fuzzy 검색. 비공개(is_private)·삭제 그룹은 제외한다.
     * 전제: pg_trgm 확장(V1) + groups.is_private(V17) + groups.name GIN trgm 인덱스(V18).
     * % = 트라이그램 유사도 매칭, &lt;-> = 거리(가까운 순). 임계값(기본 0.3)은 닉네임 검색과 함께만 조정한다.
     *
     * @param q 검색어 원문 — 파라미터 바인딩이라 {@code %}·{@code _} 같은 문자가 와도 패턴으로 해석되지
     *     않는다. 유사도 임계값에 못 미치면 아무것도 안 걸린다
     * @param limit 상한 건수. 정렬이 거리순이라 상한을 넘긴 뒤쪽은 "덜 비슷한" 쪽이 잘린다
     * @return 유사한 순(거리 오름차순) 공개·미삭제 그룹. <b>종료(ENDED)된 방은 걸러지지 않는다</b>.
     *     빈 리스트는 "임계값을 넘는 이름이 없다"는 뜻이지 오타를 못 잡았다는 뜻이 아니다
     */
    @Query(value = "SELECT * FROM groups g"
            + " WHERE g.name % :q AND g.is_private = false AND g.deleted_at IS NULL"
            + " ORDER BY g.name <-> :q"
            + " LIMIT :limit", nativeQuery = true)
    List<Group> searchPublicByNameTrgm(@Param("q") String q, @Param("limit") int limit);

    /**
     * A-10: 그룹 찾기 검색어 입력 전 기본 목록 — 공개(비공개·삭제 제외) 그룹을 최신 생성순으로 상위 N개.
     *
     * @param limit 상한 건수 — 검색어가 없을 때의 화면 한 판 분량이다
     * @return 생성 최신순 공개·미삭제 그룹. 정원이 찼거나 종료된 방도 그대로 실리므로, 참여 가능
     *     여부는 화면 조립 단계에서 따로 붙인다
     */
    @Query(value = "SELECT * FROM groups g"
            + " WHERE g.is_private = false AND g.deleted_at IS NULL"
            + " ORDER BY g.created_at DESC"
            + " LIMIT :limit", nativeQuery = true)
    List<Group> findTopPublicGroups(@Param("limit") int limit);
}
