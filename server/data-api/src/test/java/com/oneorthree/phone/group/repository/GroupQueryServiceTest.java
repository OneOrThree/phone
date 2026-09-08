package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.GroupJoinCode;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * GroupQueryService 단위 테스트 (GROMO-1655).
 *
 * <p><b>왜 이 파일이 필요한가.</b> 조회 계층이 생기기 전에는 각 service 테스트가
 * {@code given(groupRepository.findById(id)).willReturn(Optional.empty())} 처럼 <b>행 부재를 입력</b>해
 * 예외 코드를 단언했다. 조회가 계층으로 접히면서 그 테스트들은 {@code given(groupQueryService.getGroup(id))
 * .willThrow(...)} 로 바뀌었는데, 그건 <b>목에게 답을 알려주고 그 답이 돌아오는지 보는 동어반복</b>이라
 * "부재 → 어떤 코드" 매핑을 더는 증명하지 못한다. 그 계약이 이제 이 클래스 한 곳에만 있으므로
 * 증인도 여기 둔다.
 *
 * <p>따라서 이 테스트가 지키는 것은 서비스 동작이 아니라 <b>계층 자신의 네 가지 계약</b>이다 —
 * 부재 시 코드, 던지는 것과 안 던지는 것의 구분, 그리고 <b>어떤 리포지토리 메서드를 부르는가</b>
 * (락 등급이 여기서 정해지므로 호출 대상 자체가 계약이다).
 */
@ExtendWith(MockitoExtension.class)
class GroupQueryServiceTest {

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID CHALLENGE_ID = UUID.randomUUID();
    private static final UUID PARTICIPANT_ID = UUID.randomUUID();

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;

    @Mock
    private GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;

    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;

    @Mock
    private GroupChallengeDurationRepository groupChallengeDurationRepository;

    @Mock
    private GroupJoinCodeRepository groupJoinCodeRepository;

    @InjectMocks
    private GroupQueryService groupQueryService;

    @Mock
    private User user;

    @Mock
    private Group group;

    @Mock
    private GroupMember groupMember;

    @Mock
    private GroupChallengeBetSession betSession;

    @Mock
    private GroupJoinCode joinCode;

    @Test
    @DisplayName("getGroup — 그룹이 없으면 NOT_FOUND")
    void getGroupThrowsNotFoundWhenAbsent() {
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> groupQueryService.getGroup(GROUP_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("getGroup — 락 없는 조회를 쓴다(findById)")
    void getGroupUsesUnlockedRead() {
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));

        assertThat(groupQueryService.getGroup(GROUP_ID)).isSameAs(group);
        verify(groupRepository).findById(GROUP_ID);
    }

    @Test
    @DisplayName("getGroupForUpdate — 그룹이 없으면 NOT_FOUND")
    void getGroupForUpdateThrowsNotFoundWhenAbsent() {
        given(groupRepository.findByIdForUpdate(GROUP_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> groupQueryService.getGroupForUpdate(GROUP_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
    }

    /**
     * 락 등급이 이 한 줄에만 있다. {@code findByIdForUpdate} 를 {@code findById} 로 바꾸면
     * createChallenge 가 그룹 행 배타 락을 잃어 활성 4개 상한·창 겹침 검사가 동시 생성끼리
     * 직렬화되지 않는데(GROMO-1422), 호출측 테스트는 계층을 목으로 세우므로 아무것도 눈치채지 못한다.
     */
    @Test
    @DisplayName("getGroupForUpdate — 배타 락 조회를 쓴다(findByIdForUpdate) · 무락 조회로 내려가지 않는다")
    void getGroupForUpdateUsesExclusiveLockRead() {
        given(groupRepository.findByIdForUpdate(GROUP_ID)).willReturn(Optional.of(group));

        assertThat(groupQueryService.getGroupForUpdate(GROUP_ID)).isSameAs(group);
        verify(groupRepository).findByIdForUpdate(GROUP_ID);
        verify(groupRepository, never()).findById(GROUP_ID);
    }

    @Test
    @DisplayName("getMembership — 활성 멤버가 아니면 MEMBER_ONLY")
    void getMembershipThrowsMemberOnlyWhenAbsent() {
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        assertThatThrownBy(() -> groupQueryService.getMembership(user, group))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.MEMBER_ONLY);
    }

    @Test
    @DisplayName("getMembership — 멤버면 그 행을 그대로 준다")
    void getMembershipReturnsRowWhenPresent() {
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(groupMember));

        assertThat(groupQueryService.getMembership(user, group)).isSameAs(groupMember);
    }

    /**
     * {@link GroupQueryService#findMembership} 이 던지면 호출부의 {@code ALREADY_MEMBER}·
     * {@code NOT_OWNER}·{@code NOT_FOUND}·boolean 분기가 전부 무너진다. "안 던진다"가 계약이다.
     */
    @Test
    @DisplayName("findMembership — 멤버가 아니어도 던지지 않고 빈 값을 준다")
    void findMembershipReturnsEmptyWithoutThrowing() {
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        assertThat(groupQueryService.findMembership(user, group)).isEmpty();
    }

    @Test
    @DisplayName("findMembership — 멤버면 그 행을 담아 준다")
    void findMembershipReturnsRowWhenPresent() {
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(groupMember));

        assertThat(groupQueryService.findMembership(user, group)).contains(groupMember);
    }

    /**
     * 두 멤버십 조회가 같은 쿼리를 쓴다는 것 자체가 계약이다 — 한쪽만 {@code findAnyByUserAndGroup}
     * (탈퇴·강퇴 행까지 보는 유일한 조회)으로 갈아타면 계층을 지나는 멤버십 판정에 떠난 사람이
     * 되살아난다. 그 조회는 재가입 판정 전용이라 이 계층에 없다.
     */
    @Test
    @DisplayName("멤버십 조회 둘 다 활성 전용 쿼리를 쓴다 — findAnyByUserAndGroup 을 쓰지 않는다")
    void bothMembershipLookupsUseActiveOnlyQuery() {
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(groupMember));

        groupQueryService.getMembership(user, group);
        groupQueryService.findMembership(user, group);

        verify(groupMemberRepository, times(2)).findByUserAndGroup(user, group);
        verify(groupMemberRepository, never()).findAnyByUserAndGroup(user, group);
    }
    // ── 내기 회차 — 배타 락에 get 과 find 가 둘 다 있는 이유 ────────────────

    @Test
    @DisplayName("getBetSessionForUpdate — 회차가 없으면 BET_NOT_FOUND")
    void getBetSessionForUpdateThrowsBetNotFound() {
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> groupQueryService.getBetSessionForUpdate(SESSION_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.BET_NOT_FOUND);
    }

    /**
     * 같은 배타 락 쿼리인데 한쪽은 던지고 한쪽은 안 던진다. 이 구분이 무너지면 여러 회차를
     * 훑는 환불·무효화 배치가 이미 정산된 회차 하나에 통째로 죽는다.
     */
    @Test
    @DisplayName("findBetSessionForUpdate — 같은 배타 락인데 부재에 던지지 않는다(배치가 죽으면 안 된다)")
    void findBetSessionForUpdateDoesNotThrow() {
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID)).willReturn(Optional.empty());

        assertThat(groupQueryService.findBetSessionForUpdate(SESSION_ID)).isEmpty();
    }

    @Test
    @DisplayName("회차 배타 락 두 판 모두 ForUpdate 쿼리를 탄다 — 무락으로 내려가면 돈 경합이 열린다")
    void betSessionLockedReadsUseExclusiveLock() {
        given(groupChallengeBetSessionRepository.findByIdForUpdate(SESSION_ID))
                .willReturn(Optional.of(betSession));

        assertThat(groupQueryService.getBetSessionForUpdate(SESSION_ID)).isSameAs(betSession);
        assertThat(groupQueryService.findBetSessionForUpdate(SESSION_ID)).contains(betSession);

        verify(groupChallengeBetSessionRepository, times(2)).findByIdForUpdate(SESSION_ID);
        verify(groupChallengeBetSessionRepository, never()).findById(SESSION_ID);
    }

    @Test
    @DisplayName("findBetSession — 무락 조회를 타고 부재에 던지지 않는다")
    void findBetSessionUsesUnlockedRead() {
        given(groupChallengeBetSessionRepository.findById(SESSION_ID)).willReturn(Optional.empty());

        assertThat(groupQueryService.findBetSession(SESSION_ID)).isEmpty();
        verify(groupChallengeBetSessionRepository).findById(SESSION_ID);
        verify(groupChallengeBetSessionRepository, never()).findByIdForUpdate(SESSION_ID);
    }

    @Test
    @DisplayName("findBetParticipant — 잠금 뒤 재조회라 부재가 정상이다(취소·탈퇴가 지운 행)")
    void findBetParticipantDoesNotThrow() {
        given(groupChallengeBetParticipantRepository.findById(PARTICIPANT_ID)).willReturn(Optional.empty());

        assertThat(groupQueryService.findBetParticipant(PARTICIPANT_ID)).isEmpty();
    }

    // ── 챌린지 상세·참가 코드 ──────────────────────────────────────────

    @Test
    @DisplayName("창·기간 상세는 던지지 않는다 — 부재는 '그 타입이 아니다'라는 뜻이다")
    void challengeDetailLookupsDoNotThrow() {
        given(groupChallengeWindowRepository.findById(CHALLENGE_ID)).willReturn(Optional.empty());
        given(groupChallengeDurationRepository.findById(CHALLENGE_ID)).willReturn(Optional.empty());

        assertThat(groupQueryService.findChallengeWindow(CHALLENGE_ID)).isEmpty();
        assertThat(groupQueryService.findChallengeDuration(CHALLENGE_ID)).isEmpty();
    }

    @Test
    @DisplayName("참가 코드 — get 은 부재에 NOT_FOUND, find 는 빈 값(방장에게만 싣는 자리)")
    void joinCodeGetThrowsButFindDoesNot() {
        given(groupJoinCodeRepository.findById(GROUP_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> groupQueryService.getJoinCode(GROUP_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThat(groupQueryService.findJoinCode(GROUP_ID)).isEmpty();
    }

    @Test
    @DisplayName("참가 코드 배치 조회는 부재분을 빼고 돌려준다")
    void findAllJoinCodesDropsMissing() {
        List<UUID> ids = List.of(GROUP_ID, UUID.randomUUID());
        given(groupJoinCodeRepository.findAllById(ids)).willReturn(List.of(joinCode));

        assertThat(groupQueryService.findAllJoinCodes(ids)).containsExactly(joinCode);
    }
}
