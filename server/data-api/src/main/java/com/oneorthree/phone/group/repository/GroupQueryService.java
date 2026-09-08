package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.GroupJoinCode;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 그룹·멤버십을 id 로 조회하는 진입점 (GROMO-1655). 규약은
 * {@code docs/conventions/backend-layering.md} §3.
 *
 * <p>종전엔 group service 7개가 {@code groupRepository}·{@code groupMemberRepository} 를 직접 들고
 * 같은 조회를 47번 되풀이했다. 그중 그룹 조회 23건은 전부 {@link GroupErrorCode#NOT_FOUND} 를 던져
 * 접기 쉬웠지만, 멤버십 조회 24건은 <b>같은 쿼리인데 부재의 뜻이 다섯 갈래</b>였다 —
 * {@code MEMBER_ONLY}(17) · {@code NOT_OWNER}(3) · {@code NOT_FOUND}(2, 요청자가 아니라 지목한
 * 대상이라서) · {@code ALREADY_MEMBER}(1, 존재가 거절 사유) · 예외 없이 boolean(1).
 *
 * <p>그래서 <b>조회만 접고 판정은 service 에 남긴다.</b> 역할·권한은 조회 결과에 대한 비즈니스
 * 규칙이지 영속성 관심사가 아니다. 이 클래스가 주는 건 두 가지뿐이다 — "멤버십이 있어야 한다"
 * ({@link #getMembership})와 "있는지 없는지 보고 내가 판단하겠다"({@link #findMembership}).
 *
 * <p><b>멤버십의 잠금판은 일부러 없다.</b> 그룹은 락 있는 조회({@link #getGroupForUpdate})를 두었지만
 * 멤버십은 두지 않았다 — 돈이 걸린 경로가 쓰는 것은 {@code (userId, groupId)} 로 활성 행을 잠그는
 * {@link GroupMemberRepository#findActiveByUserIdAndGroupIdForShare} 계열이라 여기의
 * {@code (User, Group)} 시그니처와 인자부터 다르다. 감춘 게 아니라 그 조합을 안 만든 것이고,
 * 해당 호출부는 repository 를 직행한다(§3 「옮기지 않는 것」).
 *
 * <h2>내기 회차·챌린지 상세·참가 코드 — 부재가 정상인 쪽이 다수다</h2>
 * 이 축으로 접은 조회 20건을 재니 <b>부재의 뜻이 갈렸다</b> — 잠금 대기 중 취소·철회가 지운 행을
 * 조용히 건너뛰는 자리 <b>14건</b>({@code orElse}·{@code ifPresent}·결과를 버리는 선잠금),
 * 요청이 지목한 회차 부재 {@code BET_NOT_FOUND} 4건, 참가 코드 재발급의 {@code NOT_FOUND} 1건,
 * 그리고 배치 조회 1건.
 *
 * <p>그래서 <b>배타 락에 {@code get} 과 {@code find} 를 둘 다 둔다.</b> 여러 회차를 오름차순으로 잠그며
 * 열린 것만 모으는 루프({@code GroupBetService} 의 환불·{@code GroupBetSettler} 의 무효화)는 이미 정산된
 * 회차 하나에 던지면 배치 전체가 죽는다 — 락을 잡되 부재는 정상이다.
 * {@code UserQueryService#findActiveForUpdate} 와 같은 축이다.
 *
 * <p>창(window)·기간(duration) 상세는 던지는 자리가 없어 {@code find} 만 만들었다. 둘 다 PK 가
 * {@code challenge_id} 라 "챌린지에 그 타입 상세가 붙어 있나"를 묻는 조회이고, 없으면 그 타입이
 * 아니라는 뜻이라 부재가 정상이다.
 *
 * <p><b>트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여한다.
 */
@Service
@RequiredArgsConstructor
public class GroupQueryService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupJoinCodeRepository groupJoinCodeRepository;
    private final GroupChallengeRepository groupChallengeRepository;

    /**
     * 그룹 단건 — 락 없음.
     *
     * @param groupId 조회 대상
     * @return 그룹. <b>종료·삭제 상태는 보지 않는다</b> — 그 판정은 호출측 몫이다
     * @throws GroupException 없으면 {@link GroupErrorCode#NOT_FOUND}
     */
    public Group getGroup(UUID groupId) {
        return groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
    }

    /**
     * 그룹 단건 — <b>배타 락</b>. 이 트랜잭션이 그룹 행을 변경할 때만 쓴다.
     *
     * <p>다른 트랜잭션이 같은 행을 쥐고 있으면 <b>대기</b>한다(건너뛰지 않는다).
     * {@code readOnly} 트랜잭션에서는 쓸 수 없다.
     *
     * @param groupId 조회 대상
     * @return 잠긴 그룹. 상태·삭제를 보지 않는 것은 락 없는 조회와 같다
     * @throws GroupException 없으면 {@link GroupErrorCode#NOT_FOUND}
     */
    public Group getGroupForUpdate(UUID groupId) {
        return groupRepository.findByIdForUpdate(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
    }

    /**
     * 그 유저가 그 그룹의 멤버여야 하는 자리 — 아니면 거절한다.
     *
     * <p><b>역할(방장 여부)은 보지 않는다.</b> 방장 전용 동작은 이걸로 멤버십을 얻은 뒤
     * service 가 역할을 따로 검사한다 — 그게 비즈니스 규칙이라 조회 계층에 넣으면
     * "왜 이 API 는 방장만 되는가"가 코드에서 사라진다.
     *
     * @param user  요청자
     * @param group 대상 그룹
     * @return <b>활성 멤버십</b> 1건. 탈퇴·강퇴 행({@code is_left = true})은 쿼리에서 이미 걸러지므로
     *     호출측이 {@code isLeft} 를 다시 볼 필요가 없다. 락이 없어 조회 직후 탈퇴가 커밋될 수 있으니,
     *     돈이 걸린 경로는 잠금판({@link GroupMemberRepository#findActiveByUserIdAndGroupIdForShare})을
     *     직접 써야 한다 — 그 락 등급은 이 계층이 감추지 않는다
     * @throws GroupException 활성 멤버가 아니면 {@link GroupErrorCode#MEMBER_ONLY}. "가입한 적 없음"과
     *     "나갔음"을 구분하지 않는다
     */
    public GroupMember getMembership(User user, Group group) {
        return groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
    }

    /**
     * 멤버십이 있는지 없는지만 알려준다 — <b>부재가 정상이거나, 존재 자체가 거절 사유</b>인 자리.
     *
     * <p>{@link #getMembership} 로는 표현할 수 없는 자리가 셋이다 — 존재가 거절 사유인 곳
     * ({@code ALREADY_MEMBER}), 부재를 {@code MEMBER_ONLY} 가 아닌 다른 코드로 거절하는 곳
     * ({@code NOT_OWNER} · 지목한 대상이라 {@code NOT_FOUND}), 그리고 부재가 정상이라 boolean 으로만
     * 쓰는 곳. 예외 의미를 호출부에 남겨 두는 것이 목적이므로 이 메서드는 아무것도 던지지 않는다.
     *
     * <p>재가입 판정("강퇴된 적 있는가")은 이걸로 못 한다 — 강퇴 행은 {@code is_left = true} 라
     * 여기서 빈 값으로 나온다. 그 판정은 {@link GroupMemberRepository#findAnyByUserAndGroup} 을
     * 직접 쓴다(이 계층에 없는 유일한 멤버십 조회다).
     *
     * @param user  대상 유저
     * @param group 대상 그룹
     * @return 활성 멤버십 1건. 없거나 이미 나갔으면 빈 값
     */
    public Optional<GroupMember> findMembership(User user, Group group) {
        return groupMemberRepository.findByUserAndGroup(user, group);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 내기 회차 — 돈이 걸린 행. 변경 트랜잭션은 배타 락으로 잡는다.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 회차 단건 — 락 없음, <b>부재가 정상</b>.
     *
     * <p>부재를 어떻게 다룰지는 호출부가 정한다 — 그룹 스코프까지 확인해 거절하는 자리도 있고
     * (다른 그룹의 회차 id 를 끼워 넣으면 {@code BET_NOT_FOUND}), 이미 사라진 회차라 조용히
     * 넘어가는 자리도 있다.
     *
     * @param sessionId 조회 대상
     * @return 회차. 없으면 빈 값
     */
    public Optional<GroupChallengeBetSession> findBetSession(UUID sessionId) {
        return groupChallengeBetSessionRepository.findById(sessionId);
    }

    /**
     * 회차 단건 — <b>배타 락</b>, 부재가 오류.
     *
     * <p>다른 트랜잭션이 같은 행을 쥐고 있으면 <b>대기</b>한다. {@code readOnly} 에서는 쓸 수 없다.
     * 여러 회차를 한 트랜잭션에서 잠글 때는 <b>id 오름차순</b>이어야 교착이 나지 않는다.
     *
     * @param sessionId 조회 대상
     * @return 잠긴 회차
     * @throws GroupException 없으면 {@link GroupErrorCode#BET_NOT_FOUND}
     */
    public GroupChallengeBetSession getBetSessionForUpdate(UUID sessionId) {
        return groupChallengeBetSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
    }

    /**
     * 회차 단건 — <b>배타 락</b>인데 <b>부재가 정상</b>.
     *
     * <p>여러 회차를 훑으며 열린 것만 모으는 배치가 쓴다. 던지면 이미 정산된 회차 하나 때문에
     * 나머지 환불·무효화가 전부 죽는다 — 잠금 대기 중 마지막 참가자 철회로 회차가 사라지는 것은
     * 정상 흐름이다(걸린 돈이 없다).
     *
     * @param sessionId 조회 대상
     * @return 잠긴 회차. 잠금 대기 중 사라졌으면 빈 값
     */
    public Optional<GroupChallengeBetSession> findBetSessionForUpdate(UUID sessionId) {
        return groupChallengeBetSessionRepository.findByIdForUpdate(sessionId);
    }

    /**
     * 참가 행 단건 — 락 없음, <b>부재가 정상</b>.
     *
     * <p>회차를 잠근 <b>뒤</b> 참가 행을 재조회하는 자리가 쓴다. 잠금을 기다리는 사이 취소·탈퇴가
     * 지운 행이 여기서 빈 결과로 잡힌다 — 엔티티를 미리 올려 뒀다면 1차 캐시가 유령을 돌려줘
     * flush 에서 터진다.
     *
     * @param participantId 조회 대상
     * @return 참가 행. 없으면 빈 값
     */
    public Optional<GroupChallengeBetParticipant> findBetParticipant(UUID participantId) {
        return groupChallengeBetParticipantRepository.findById(participantId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 챌린지 타입별 상세(CTI) — PK 가 challenge_id 다. 던지는 자리가 없다.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 창(TIME_WINDOW) 챌린지 상세.
     *
     * @param challengeId 챌린지 id (이 테이블의 PK 다)
     * @return 상세. 그 챌린지가 창 타입이 아니면 빈 값
     */
    public Optional<GroupChallengeWindow> findChallengeWindow(UUID challengeId) {
        return groupChallengeWindowRepository.findById(challengeId);
    }

    /**
     * 기간(DURATION) 챌린지 상세.
     *
     * @param challengeId 챌린지 id (이 테이블의 PK 다)
     * @return 상세. 그 챌린지가 기간 타입이 아니면 빈 값
     */
    public Optional<GroupChallengeDuration> findChallengeDuration(UUID challengeId) {
        return groupChallengeDurationRepository.findById(challengeId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 참가 코드 — PK 가 group_id 인 1:1 행이다.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 참가 코드 — 부재가 오류. 재발급처럼 코드가 있어야 성립하는 자리가 쓴다.
     *
     * @param groupId 그룹 id (이 테이블의 PK 다)
     * @return 참가 코드 행
     * @throws GroupException 없으면 {@link GroupErrorCode#NOT_FOUND}
     */
    public GroupJoinCode getJoinCode(UUID groupId) {
        return groupJoinCodeRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
    }

    /**
     * 참가 코드 — <b>부재가 정상</b>. 상세 응답이 방장에게만 코드를 실을 때처럼, 없으면 안 싣는 자리.
     *
     * @param groupId 그룹 id
     * @return 참가 코드 행. 없으면 빈 값
     */
    public Optional<GroupJoinCode> findJoinCode(UUID groupId) {
        return groupJoinCodeRepository.findById(groupId);
    }

    /**
     * 참가 코드 배치 조회 — 내 그룹 목록이 그룹마다 코드를 실을 때. N+1 을 IN 집계 1회로 접는다.
     *
     * @param groupIds 그룹 id 들
     * @return 참가 코드 행. <b>부재분은 빠지므로 요청 수와 결과 수가 다를 수 있다</b>
     */
    public List<GroupJoinCode> findAllJoinCodes(Collection<UUID> groupIds) {
        return groupJoinCodeRepository.findAllById(groupIds);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 다른 도메인이 빌려 가는 조회 — 부재가 정상인 쪽만 있다.
    // 알림·초대링크는 이벤트를 뒤늦게 처리하므로 그 사이 삭제된 대상을 만나는 게 흔한 일이다.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 그룹 단건 — 락 없음, <b>부재가 정상</b>.
     *
     * <p>{@link #getGroup} 과 달리 던지지 않는다. 초대 링크 랜딩처럼 "그룹이 사라졌으면 만료와 같게
     * 다룬다"는 자리가 쓴다 — 종료·삭제 판정은 <b>호출부가 이어서</b> 한다(그건 비즈니스 규칙이다).
     *
     * @param groupId 조회 대상
     * @return 그룹. 없으면 빈 값
     */
    public Optional<Group> findGroup(UUID groupId) {
        return groupRepository.findById(groupId);
    }

    /**
     * 챌린지 단건 — 락 없음, <b>부재가 정상</b>.
     *
     * <p>{@code AFTER_COMMIT} + {@code @Async} 알림이 이벤트를 받은 시점엔 생성 직후의 삭제·종료가
     * 이미 커밋돼 있을 수 있다. 삭제·상태 판정은 호출부 몫이다.
     *
     * @param challengeId 조회 대상
     * @return 챌린지. 없으면 빈 값
     */
    public Optional<GroupChallenge> findChallenge(UUID challengeId) {
        return groupChallengeRepository.findById(challengeId);
    }

    /**
     * 회차 배치 조회 — 알림 묶음이 대상 회차를 한 번에 읽을 때.
     *
     * @param sessionIds 조회 대상
     * @return 회차. <b>부재분은 빠지므로 요청 수와 결과 수가 다를 수 있다</b>
     */
    public List<GroupChallengeBetSession> findAllBetSessions(Collection<UUID> sessionIds) {
        return groupChallengeBetSessionRepository.findAllById(sessionIds);
    }
}
