package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.currency.domain.CurrencyTransaction;
import com.oneorthree.phone.currency.domain.CurrencyTransactionType;
import com.oneorthree.phone.currency.repository.CurrencyTransactionRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 계정 탈퇴 ↔ 그룹 정리 통합 테스트 (GROMO-801) — 탈퇴자가 유령 멤버로 남지 않고, OPEN 내기
 * 판돈이 에스크로에 묶이지 않는지를 실 DB 로 고정한다.
 *
 * <p>{@code UserService.withdraw} 가 그룹 탈퇴 경로({@code GroupMemberService.withdrawGroup})와
 * 같은 해제({@code releaseFromAllOpenBets, 유저 스코프}) → leave 순서를 밟는 것이 핵심이라,
 * 원장 멱등키까지 그룹 탈퇴 연동과 같은 포맷({@code bet:{betId}:refund:{userId}})이어야 한다.
 */
class UserWithdrawGroupCleanupIntegrationTest extends IntegrationTestBase {

    @Autowired
    UserService userService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    @Autowired
    CurrencyTransactionRepository currencyTransactionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private static final int STAKE = 30;
    /** 판돈 차감 후 잔액. 참가 시점에 이미 STAKE 만큼 빠져 있는 상태를 재현한다. */
    private static final int BALANCE_AFTER_STAKE = 70;

    private Group group;
    private GroupChallenge challenge;

    private final List<User> users = new ArrayList<>();
    private final List<GroupChallengeBet> bets = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        challenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .category(MissionCategory.FOCUS)
                .type(MissionType.DURATION)
                .build());
    }

    @AfterEach
    void tearDown() {
        users.forEach(u -> currencyTransactionRepository
                .deleteAll(currencyTransactionRepository.findByUserOrderByCreatedAtDesc(u)));
        bets.forEach(b -> groupChallengeBetParticipantRepository
                .deleteAll(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(b.getId()))));
        groupChallengeBetRepository.deleteAll(bets);
        groupChallengeRepository.delete(challenge);
        // 탈퇴는 멤버십 행을 지우지 않고 is_left=true 로 마킹만 하므로, 활성 조회가 아니라
        // findAnyByUserAndGroup 으로 소프트삭제 행까지 지워야 유저 삭제가 FK 를 위반하지 않는다.
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        users.forEach(u -> userWalletRepository.findById(u.getId()).ifPresent(userWalletRepository::delete));
        userRepository.deleteAll(users);
        // Group 은 @Version 낙관락이 있어, withdraw 가 close() 로 버전을 올린 뒤에는 setUp 의
        // detached 인스턴스로 delete 하면 stale 로 터진다 — 재조회해서 지운다.
        groupRepository.findById(group.getId()).ifPresent(groupRepository::delete);

        users.clear();
        bets.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** 그룹 멤버십까지 갖춘, 판돈을 이미 낸(잔액 70) 유저. */
    private User memberUser(String nickname, GroupMemberRole role) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        userWalletRepository.save(UserWallet.builder()
                .userId(user.getId()).balance(BALANCE_AFTER_STAKE).build());
        groupMemberRepository.save(GroupMember.builder().user(user).group(group).role(role).build());
        users.add(user);
        return user;
    }

    private GroupChallengeBet openBet(User creator) {
        GroupChallengeBet bet = groupChallengeBetRepository.save(GroupChallengeBet.builder()
                .group(group)
                .challenge(challenge)
                .creatorUser(creator)
                .stake(STAKE)
                .betDate(LocalDate.now())
                .status(GroupBetStatus.OPEN)
                .build());
        bets.add(bet);
        return bet;
    }

    private void participant(GroupChallengeBet bet, User user) {
        groupChallengeBetParticipantRepository.save(
                GroupChallengeBetParticipant.builder().bet(bet).user(user).build());
    }

    private List<CurrencyTransaction> refundsOf(User user) {
        return currencyTransactionRepository.findByUserOrderByCreatedAtDesc(user).stream()
                .filter(t -> t.getType() == CurrencyTransactionType.BET_REFUND)
                .toList();
    }

    // ── 시나리오 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("그룹 무관 탈퇴 — 소프트딜리트·PII 파기·지갑 삭제가 실제 DB 에 커밋된다 (GROMO-801 회귀 방지)")
    void bareWithdrawPersistsSoftDeleteAndWalletRemoval() {
        // 소셜 연동 벌크 DELETE 의 clearAutomatically 가 미flush 변경을 버리면, 탈퇴가 성공한 것처럼
        // 보이는데 user 는 활성 그대로 남는다 — 목 단위 테스트로는 못 잡는 유실이라 실 DB 로 고정한다.
        User user = userRepository.save(User.builder().nickname("무소속").isGuest(false).build());
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).balance(10).build());
        users.add(user);

        userService.withdraw(user.getId());

        User withdrawn = userRepository.findById(user.getId()).orElseThrow();
        assertThat(withdrawn.isDeleted()).isTrue();
        assertThat(withdrawn.getNickname()).isNull();
        assertThat(userWalletRepository.findById(user.getId())).isEmpty();
    }

    @Test
    @DisplayName("MEMBER 계정 탈퇴 — 참가 행 해제·환불 원장 기입·is_left=true·정원 반환이 한 트랜잭션에 끝난다")
    void memberWithdrawalReleasesOpenBetAndFreesSlot() {
        memberUser("방장", GroupMemberRole.OWNER);
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator);
        participant(bet, creator);
        participant(bet, leaver);
        participant(bet, third);

        userService.withdraw(leaver.getId());

        // 남은 참가자가 2명이라 내기는 계속되고, 탈퇴자 참가 행만 빠진다
        assertThat(groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus())
                .isEqualTo(GroupBetStatus.OPEN);
        assertThat(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId())))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), third.getId());
        // 환불 원장은 그룹 탈퇴 연동과 같은 멱등키 포맷으로 정확히 한 번 기입된다
        // (지갑은 탈퇴로 삭제되지만 원장은 남는다 — 판돈이 소각되지 않았다는 증거)
        assertThat(refundsOf(leaver))
                .extracting(CurrencyTransaction::getAmount, CurrencyTransaction::getIdempotencyKey)
                .containsExactly(tuple(STAKE, "bet:" + bet.getId() + ":refund:" + leaver.getId()));
        // 멤버십은 이탈 마킹 — 활성 목록에서 빠져 정원 한 자리가 돌아온다
        assertThat(groupMemberRepository.findAnyByUserAndGroup(leaver, group).orElseThrow().isLeft())
                .isTrue();
        assertThat(groupMemberRepository.findByGroup(group))
                .extracting(m -> m.getUser().getId())
                .doesNotContain(leaver.getId());
        // 탈퇴 자체도 완료 — 소프트딜리트 + 지갑 삭제
        assertThat(userRepository.findById(leaver.getId()).orElseThrow().isDeleted()).isTrue();
        assertThat(userWalletRepository.findById(leaver.getId())).isEmpty();
        // 잔류 참가자에게는 아무 일도 없다
        assertThat(userWalletRepository.findById(creator.getId()).orElseThrow().getBalance())
                .isEqualTo(BALANCE_AFTER_STAKE);
        assertThat(userWalletRepository.findById(third.getId()).orElseThrow().getBalance())
                .isEqualTo(BALANCE_AFTER_STAKE);
    }

    @Test
    @DisplayName("강퇴된 멤버의 계정 탈퇴 — 활성 멤버십이 없어도 참가 중인 OPEN 내기는 해제·환불된다 (codex 리뷰)")
    void kickedMemberWithdrawalStillReleasesOpenBet() {
        // kickMember 는 참가·판돈을 정산용으로 남긴다(지갑 생존 전제). 그 유저가 계정을 탈퇴하면
        // 지갑이 삭제되므로, 멤버십(is_left=false) 경유로만 해제하면 강퇴자의 판돈이 소각된다 —
        // 유저 스코프 해제가 멤버십 상태와 무관하게 참가 행을 집는지를 실 DB 로 고정한다.
        memberUser("방장", GroupMemberRole.OWNER);
        User creator = memberUser("개설자", GroupMemberRole.MEMBER);
        User third = memberUser("제3참가자", GroupMemberRole.MEMBER);
        User kicked = memberUser("강퇴자", GroupMemberRole.MEMBER);
        GroupChallengeBet bet = openBet(creator);
        participant(bet, creator);
        participant(bet, kicked);
        participant(bet, third);
        GroupMember kickedMembership = groupMemberRepository.findAnyByUserAndGroup(kicked, group).orElseThrow();
        kickedMembership.kick();
        groupMemberRepository.save(kickedMembership);

        userService.withdraw(kicked.getId());

        // 남은 참가자 2명 — 내기는 계속되고 강퇴자 참가 행만 빠진다
        assertThat(groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus())
                .isEqualTo(GroupBetStatus.OPEN);
        assertThat(groupChallengeBetParticipantRepository.findByBetIdIn(List.of(bet.getId())))
                .extracting(p -> p.getUser().getId())
                .containsExactlyInAnyOrder(creator.getId(), third.getId());
        // 판돈은 소각되지 않고 지갑 삭제 전에 환불 원장이 기입된다
        assertThat(refundsOf(kicked))
                .extracting(CurrencyTransaction::getAmount, CurrencyTransaction::getIdempotencyKey)
                .containsExactly(tuple(STAKE, "bet:" + bet.getId() + ":refund:" + kicked.getId()));
        assertThat(userRepository.findById(kicked.getId()).orElseThrow().isDeleted()).isTrue();
        assertThat(userWalletRepository.findById(kicked.getId())).isEmpty();
    }

    @Test
    @DisplayName("solo 방장 계정 탈퇴 — 그룹 자동 종료(ENDED)와 함께 그 그룹의 OPEN 내기도 취소·환불된다")
    void soloOwnerWithdrawalClosesGroupAndCancelsOpenBet() {
        User soloOwner = memberUser("나홀로방장", GroupMemberRole.OWNER);
        GroupChallengeBet bet = openBet(soloOwner);
        participant(bet, soloOwner);

        userService.withdraw(soloOwner.getId());

        // A-2 자동 종료 + 멤버십 이탈은 기존 그대로
        assertThat(groupRepository.findById(group.getId()).orElseThrow().getStatus())
                .isEqualTo(GroupStatus.ENDED);
        assertThat(groupMemberRepository.findAnyByUserAndGroup(soloOwner, group).orElseThrow().isLeft())
                .isTrue();
        // 자동 종료된 그룹의 OPEN 내기도 해제된다 — 개설자 탈퇴라 내기 전체 취소 + 환불 원장 기입
        assertThat(groupChallengeBetRepository.findById(bet.getId()).orElseThrow().getStatus())
                .isEqualTo(GroupBetStatus.CANCELED);
        assertThat(refundsOf(soloOwner))
                .extracting(CurrencyTransaction::getIdempotencyKey)
                .containsExactly("bet:" + bet.getId() + ":refund:" + soloOwner.getId());
        assertThat(userRepository.findById(soloOwner.getId()).orElseThrow().isDeleted()).isTrue();
        assertThat(userWalletRepository.findById(soloOwner.getId())).isEmpty();
    }
}
