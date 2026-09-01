package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 그룹 챌린지 조회. 거의 모든 메서드가 {@code deletedAt IS NULL} 을 이름·쿼리에 박아 두고 있다 —
 * 소프트 삭제가 이 도메인의 유일한 삭제라 필터가 빠진 조회 하나가 곧 "지워진 챌린지가 살아 돌아오는" 경로다.
 *
 * <p><b>잠금 세 갈래</b>가 이 인터페이스의 핵심이다: 종료·삭제는 배타 락(FOR UPDATE), 참여는 공유 락
 * (FOR SHARE), 배치 자동 개설은 그룹 검증 없는 배타 락을 쓴다. 유저 요청 경로는 반드시 그룹을 함께
 * 검증하는 쪽을 골라야 한다 — 그러지 않으면 남의 그룹 챌린지를 id 만으로 건드릴 수 있다.
 */
public interface GroupChallengeRepository extends JpaRepository<GroupChallenge, UUID> {

    /**
     * 삭제(soft delete)된 챌린지는 어느 조회 경로에서도 살아있는 것으로 보이면 안 된다 —
     * 목록/중복 검사/대표 미션이 모두 deleted_at IS NULL 로 통일돼 있어야 "삭제 후 재생성"이 성립한다.
     *
     * @param id 챌린지 id
     * @param group 이 챌린지가 속해야 하는 그룹 — 불일치면 존재해도 empty 다(타 그룹 챌린지 조작 차단)
     * @return 살아 있는 챌린지. empty 는 없음·삭제됨·남의 그룹 것을 구분하지 않는다 — 호출측이 셋 다
     *     {@code NOT_FOUND} 로 접어 소속 여부가 응답으로 새지 않게 한다. 락이 없어 조회 직후 다른
     *     트랜잭션이 삭제할 수 있으므로 쓰기 전 검사에는 쓰지 않는다
     */
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
     *
     * @param id 잠글 챌린지 id
     * @param group 소속 검증용 그룹 — 유저 요청 경로라 그룹 확인이 락과 한 쿼리에 붙어 있다
     * @return 잠긴 살아 있는 챌린지. 다른 트랜잭션이 같은 행을 쥐고 있으면 <b>대기</b>한다(건너뛰지 않는다).
     *     empty 면 이미 삭제됐거나 남의 그룹 것이다. readOnly 트랜잭션에서는 쓸 수 없다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from GroupChallenge c where c.id = :id and c.group = :group and c.deletedAt is null")
    Optional<GroupChallenge> findByIdAndGroupAndDeletedAtIsNullForUpdate(
            @Param("id") UUID id, @Param("group") Group group);

    /**
     * 그룹 스코프 없는 잠금 조회(GROMO-1411 배치·N35) — 자동 개설({@code ensureSession})이 챌린지
     * 행을 잠가 삭제·레거시 개설과 직렬화한다. 유저 요청 경로는 항상 그룹 검증이 있는
     * {@link #findByIdAndGroupAndDeletedAtIsNullForUpdate}/{@link
     * #findByIdAndGroupAndDeletedAtIsNullForShare} 를 쓸 것 — 이 메서드는 배치 전용이다.
     *
     * @param id 잠글 챌린지 id. <b>그룹 검증이 없다</b> — 배치는 이미 자기가 뽑은 id 만 다루기 때문이다
     * @return 잠긴 살아 있는 챌린지. empty 면 그 사이 삭제된 것이므로 배치는 이번 건을 건너뛴다
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from GroupChallenge c where c.id = :id and c.deletedAt is null")
    Optional<GroupChallenge> findByIdAndDeletedAtIsNullForUpdate(@Param("id") UUID id);

    /**
     * 신 참여 경로(GROMO-1408·1414) 전용 — 같은 조회 + 챌린지 행 <b>공유 락</b>(SELECT … FOR SHARE).
     *
     * <p>참여(회차 lazy 개설 포함)는 이 공유 락 아래에서만 진행한다(계약 §3): 종료·삭제의 배타 락
     * ({@link #findByIdAndGroupAndDeletedAtIsNullForUpdate}, N42)과 직렬화돼, 삭제가 "OPEN 회차
     * 없음"을 본 뒤에 lazy 개설·참가가 끼어들어 삭제된 챌린지에 참가비가 매달리는 창을 없앤다.
     * 참여끼리는 공유 락이라 병렬이다 — 회차·지갑 직렬화는 회차 행 락과 원장 유니크가 맡는다.
     *
     * @param id 잠글 챌린지 id
     * @param group 소속 검증용 그룹
     * @return 공유 락이 걸린 살아 있는 챌린지. 다른 참여 트랜잭션과는 서로 막지 않고, 종료·삭제의
     *     배타 락과만 줄을 선다. readOnly 트랜잭션에서는 쓸 수 없다
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select c from GroupChallenge c where c.id = :id and c.group = :group and c.deletedAt is null")
    Optional<GroupChallenge> findByIdAndGroupAndDeletedAtIsNullForShare(
            @Param("id") UUID id, @Param("group") Group group);

    /**
     * 그룹 챌린지 목록(카드 화면) — 최신 생성순. 페이징이 없고, 활성 상한이 4라 결과가 길어지지 않는다.
     *
     * @param group 조회 대상 그룹
     * @return 삭제되지 않은 챌린지 전량 — <b>종료(ENDED)된 것도 포함</b>한다(진행 여부는 화면이 가른다).
     *     빈 리스트면 이 그룹에 아직 챌린지가 없다는 뜻이다
     */
    List<GroupChallenge> findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(Group group);

    /**
     * GROMO-674: 그룹 대표 챌린지(가장 오래된 ACTIVE, 미삭제) — 그룹 상세/오버뷰의 미션 정보 소스.
     * 창설 시점 미션(구 groups.mission_*)의 의미 보존을 위해 최신이 아니라 최초 ACTIVE 를 대표로 삼는다
     * — 이후 챌린지가 추가돼도 대표 미션이 흔들리지 않음 (PR #173 리뷰).
     *
     * @param group 대표 미션을 뽑을 그룹
     * @param status 사실상 {@code ACTIVE} 고정 — 종료된 챌린지를 대표로 세우지 않는다
     * @return 가장 먼저 만들어진 진행 중 챌린지. empty 면 대표 미션이 없는 그룹이라 상세 화면의 미션
     *     영역이 비는 것이 정상이다(에러가 아니다)
     */
    Optional<GroupChallenge> findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
            Group group, GroupChallengeStatus status);

    /**
     * 하루형 중복 생성 사전 검사 — 같은 그룹에 같은 (카테고리, 방식)의 진행 중 챌린지가 이미 있는지.
     * V20 부분 유니크 인덱스가 최후 방어선이고 이 조회는 사용자에게 친절한 에러를 내주는 앞단이다.
     *
     * @param group 검사 대상 그룹
     * @param category 재는 지표
     * @param type 미션 방식 — 창형은 겹치지만 않으면 여럿 허용이라 사실상 {@code DURATION} 검사다
     * @param status 사실상 {@code ACTIVE} 고정
     * @return 이미 있으면 true. <b>삭제된 챌린지는 세지 않으므로</b> 삭제 후 같은 조합 재생성이 열린다.
     *     락 없이 도는 검사라 동시 생성 방어는 그룹 행 배타 락이 따로 진다
     */
    boolean existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
            Group group, MissionCategory category, MissionType type, GroupChallengeStatus status);

    // 그룹당 활성 챌린지 4개 상한(FR-1 · GROMO-1422) 사전 검사용 — 그룹 행 배타 락 아래에서만 의미 있다
    // (GroupRepository.findByIdForUpdate 로 생성을 직렬화한 뒤 센다).
    /**
     * 그룹의 진행 중 챌린지 개수 — 활성 4개 상한(FR-1) 검사용.
     *
     * @param group 검사 대상 그룹
     * @param status 사실상 {@code ACTIVE} 고정
     * @return 삭제되지 않은 해당 상태 챌린지 수. <b>그룹 행 배타 락 밖에서 세면 의미가 없다</b> —
     *     동시 생성 2건이 같은 수를 읽고 둘 다 통과해 상한을 넘긴다
     */
    long countByGroupAndStatusAndDeletedAtIsNull(Group group, GroupChallengeStatus status);

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
     * 상세(창·일 목표)를 붙여 "방금 끝났는지" 로 다시 좁힌다. 활성 챌린지는 그룹당 최대 4개
     * (FR-1 · GROMO-1422)라 결과는 타입당 최대 (그룹 수 × 4) 건이다.
     *
     * @param status 사실상 {@code ACTIVE} 고정 — 끝난 챌린지에 종료 푸시를 다시 쏘지 않는다
     * @param type 감지 주기가 갈리는 축. {@code TIME_WINDOW} 는 15분 크론, {@code DURATION} 은 일 1회 크론이
     *     이 조회를 쓴다
     * @return 그룹이 함께 로드된 후보 전량(페이징 없음) — <b>발송 대상이 아니라 후보</b>다. "방금 끝났는지"는
     *     호출측이 상세를 붙여 다시 좁힌다. 빈 리스트면 이번 틱에 볼 챌린지가 없다는 뜻이다
     */
    @Query("SELECT c FROM GroupChallenge c JOIN FETCH c.group "
            + "WHERE c.status = :status AND c.deletedAt IS NULL AND c.type = :type")
    List<GroupChallenge> findActiveByType(
            @Param("status") GroupChallengeStatus status,
            @Param("type") MissionType type);
}
