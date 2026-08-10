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

    /**
     * 그룹 스코프 없는 잠금 조회(GROMO-1411 배치·N35) — 자동 개설({@code ensureSession})이 챌린지
     * 행을 잠가 삭제·레거시 개설과 직렬화한다. 유저 요청 경로는 항상 그룹 검증이 있는
     * {@link #findByIdAndGroupAndDeletedAtIsNullForUpdate} 를 쓸 것 — 이 메서드는 배치 전용이다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from GroupChallenge c where c.id = :id and c.deletedAt is null")
    Optional<GroupChallenge> findByIdAndDeletedAtIsNullForUpdate(@Param("id") UUID id);

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
     * 챌린지 종료 푸시(B4·GROMO-1088) 대상 후보 — 타입이 맞는 살아있는 ACTIVE 챌린지 전건.
     *
     * <p>종료 감지가 <b>타입별</b>로 갈리기 때문에 타입만으로 뽑는다: TIME_WINDOW 는 창 종료 시각(15분
     * 크론), DURATION 은 하루 마감(일 1회 크론)이다. 카테고리는 감지 기준이 아니라 문구·판정 소스에만
     * 영향을 주므로 여기서 나누지 않는다(종전 {@code findActiveByCategoryAndType} 대체 — 창 종료 푸시가
     * 스크린타임 전용이던 시절의 잔재였다).
     *
     * <p>매 틱 도는 조회라 group 을 함께 fetch 한다(딥링크의 groupId). 실제 발송 대상은 호출측이
     * 상세(창·일 목표)를 붙여 "방금 끝났는지" 로 다시 좁힌다. 활성 챌린지는 그룹당 카테고리×타입 1개
     * (V20 부분 유니크)라 결과는 타입당 최대 (그룹 수 × 2) 건이다.
     */
    @Query("SELECT c FROM GroupChallenge c JOIN FETCH c.group "
            + "WHERE c.status = :status AND c.deletedAt IS NULL AND c.type = :type")
    List<GroupChallenge> findActiveByType(
            @Param("status") GroupChallengeStatus status,
            @Param("type") MissionType type);
}
