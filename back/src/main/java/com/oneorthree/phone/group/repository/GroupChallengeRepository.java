package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupChallengeRepository extends JpaRepository<GroupChallenge, UUID> {

    // 삭제(soft delete)된 챌린지는 어느 조회 경로에서도 살아있는 것으로 보이면 안 된다 —
    // 목록/중복 검사/대표 미션이 모두 deleted_at IS NULL 로 통일돼 있어야 "삭제 후 재생성"이 성립한다.
    Optional<GroupChallenge> findByIdAndGroupAndDeletedAtIsNull(UUID id, Group group);

    /**
     * 위와 같은 조회 + 챌린지 행 배타 락(SELECT … FOR UPDATE).
     *
     * <p>"OPEN 내기가 달린 챌린지는 삭제 불가"라는 불변식을 <b>내기 개설과 직렬화</b>하기 위한 것이다.
     * 락이 없으면 삭제 쪽이 "OPEN 내기 없음"을 본 직후 다른 그룹원의 개설 트랜잭션이 커밋돼,
     * 에스크로된 판돈이 걸린 내기가 삭제된 챌린지에 매달려 앱에서 보이지 않게 된다(PR #381 리뷰).
     *
     * <p>개설·삭제 두 경로가 같은 챌린지 행을 이 메서드로 잠그면 한쪽이 커밋할 때까지 다른 쪽이 대기한다.
     * 개설이 먼저면 삭제는 뒤이은 OPEN 내기 검사에서 걸리고, 삭제가 먼저면 개설은 READ COMMITTED 의
     * 조건 재평가(deleted_at IS NULL)에서 행이 빠져 NOT_FOUND 가 된다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from GroupChallenge c where c.id = :id and c.group = :group and c.deletedAt is null")
    Optional<GroupChallenge> findByIdAndGroupAndDeletedAtIsNullForUpdate(
            @Param("id") UUID id, @Param("group") Group group);

    List<GroupChallenge> findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(Group group);

    // GROMO-674: 그룹 대표 챌린지(가장 오래된 ACTIVE, 미삭제) — 그룹 상세/오버뷰의 미션 정보 소스.
    // 창설 시점 미션(구 groups.mission_*)의 의미 보존을 위해 최신이 아니라 최초 ACTIVE 를 대표로 삼는다
    // — 이후 챌린지가 추가돼도 대표 미션이 흔들리지 않음 (PR #173 리뷰).
    Optional<GroupChallenge> findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
            Group group, GroupChallengeStatus status);

    boolean existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
            Group group, MissionCategory category, MissionType type, GroupChallengeStatus status);

    // TIME_WINDOW 겹침 판정은 window 컬럼의 상세 테이블 분리에 따라
    // GroupChallengeWindowRepository.existsOverlappingTimeWindow 로 이동.

    /**
     * 창 종료 감지 푸시(B4) 대상 후보 — 카테고리·타입이 맞는 살아있는 ACTIVE 챌린지 전건.
     *
     * <p>15분 크론이 매 틱 도는 조회라 group 을 함께 fetch 한다(딥링크의 groupId). 실제 발송 대상은
     * 여기서 창 상세를 붙여 "오늘 창 종료가 방금 지났는지" 로 다시 좁히므로, 이 조회 결과는 보통
     * 그룹 수준의 소수다(활성 챌린지는 그룹당 카테고리×타입 1개 = 최대 4개, V20 부분 유니크).
     */
    @Query("SELECT c FROM GroupChallenge c JOIN FETCH c.group "
            + "WHERE c.status = :status AND c.deletedAt IS NULL "
            + "AND c.category = :category AND c.type = :type")
    List<GroupChallenge> findActiveByCategoryAndType(
            @Param("status") GroupChallengeStatus status,
            @Param("category") MissionCategory category,
            @Param("type") MissionType type);
}
