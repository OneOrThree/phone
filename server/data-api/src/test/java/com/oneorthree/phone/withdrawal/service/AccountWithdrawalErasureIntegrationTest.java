package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.character.repository.domain.CharacterGeneration;
import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.domain.PinnedUser;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeMember;
import com.oneorthree.phone.group.repository.domain.GroupInvite;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupMemberStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.internal.dto.AccountPatchRequest;
import com.oneorthree.phone.internal.service.InternalAccountService;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.item.repository.domain.CharacterEquipment;
import com.oneorthree.phone.item.repository.domain.Item;
import com.oneorthree.phone.item.repository.domain.ItemType;
import com.oneorthree.phone.item.repository.domain.PriceType;
import com.oneorthree.phone.item.repository.domain.SlotType;
import com.oneorthree.phone.league.repository.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.StatVisibility;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserBlock;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 LLD §4 탈퇴 파기 전수 (GROMO-1801) — 모든 Data 대상 테이블에 탈퇴자(W)·상대(C)·제3자(T)의 행을 심고,
 * 실제 Flyway(V1~V65)·{@code ddl-auto=validate} 스키마에서 탈퇴 한 번 뒤 W 의 행은 지워지거나 비워지고
 * C·T 의 자기 행은 그대로인지 본다. 테이블은 테스트가 만들지 않는다 — 운영 마이그레이션이 만든다.
 */
@SpringBootTest
class AccountWithdrawalErasureIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        // 공개 PATCH receipt 파기를 보려면 receipt 가 있어야 한다 — 운영 기본(닫힘)을 이 테스트에서만 연다.
        registry.add("account.profile-update-enabled", () -> true);
    }

    @Autowired AccountWithdrawalService withdrawal;
    @Autowired InternalAccountService account;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;
    @PersistenceContext EntityManager em;

    @Test
    @DisplayName("§4 의 모든 Data 행이 파기되고 상대·제3자의 자기 행은 남는다")
    void erasesEveryDataItemOfTheWithdrawnUserOnly() {
        Actor w = actor();
        Actor c = actor();
        Actor t = actor();
        // 공개 PATCH receipt(이름이 든 개인 응답) — W·C 각각
        account.patch(w.id(), new AccountPatchRequest(name()), w.session(), 0L, UUID.randomUUID());
        account.patch(c.id(), new AccountPatchRequest(name()), c.session(), 0L, UUID.randomUUID());
        Seed s = seed(w.id(), c.id(), t.id());

        withdrawal.withdraw(w.id());

        // users 직접 PII — W 는 파기, C 는 그대로
        Map<String, Object> wu = row("select * from users where id=?", w.id());
        assertThat(wu).containsEntry("is_deleted", true).containsEntry("nickname", null)
                .containsEntry("occupation", null).containsEntry("last_active_at", null)
                .containsEntry("character_trial_anchor_at", null).containsEntry("stat_visibility", "FRIENDS");
        Map<String, Object> cu = row("select * from users where id=?", c.id());
        assertThat(cu.get("nickname")).isNotNull();
        assertThat(cu.get("last_active_at")).isNotNull();
        assertThat(cu).containsEntry("occupation", "TAX_ACCOUNTANT").containsEntry("stat_visibility", "PUBLIC");

        // group_announcements — 작성자 연결만 끊고 행·내용은 남긴다
        assertThat(row("select user_id, title from group_announcements where id=?", s.wAnnouncement()))
                .containsEntry("user_id", null).containsEntry("title", "W공지");
        assertThat(uuid("select user_id from group_announcements where id=?", s.cAnnouncement())).isEqualTo(c.id());

        // notification_sent_logs — W 수신 전부·W 상대 친구 알림은 삭제, 타인 추월은 상대만 null
        assertThat(count("select count(*) from notification_sent_logs where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from notification_sent_logs where id=?", s.friendLogAboutW())).isZero();
        assertThat(row("select user_id, target_user_id from notification_sent_logs where id=?", s.overtakeAboutW()))
                .containsEntry("user_id", c.id()).containsEntry("target_user_id", null);
        assertThat(uuid("select target_user_id from notification_sent_logs where id=?", s.otherLog()))
                .isEqualTo(s.otherSubject());

        // group_challenge_members — W 원본 보고 전부 삭제, C 보고 유지
        assertThat(count("select count(*) from group_challenge_members where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from group_challenge_members where user_id=?", c.id())).isEqualTo(1L);

        // bet participants — W 의 열람·lease 3열만 null, 정산 근거 유지. C 는 그대로
        Map<String, Object> wp = row("select * from group_challenge_bet_participants where id=?", s.wParticipant());
        assertThat(wp).containsEntry("acknowledged_at", null).containsEntry("display_claimed_at", null)
                .containsEntry("display_claim_token", null).containsEntry("achieved", true)
                .containsEntry("payout", 200).containsEntry("user_id", w.id());
        Map<String, Object> cp = row("select * from group_challenge_bet_participants where id=?", s.cParticipant());
        assertThat(cp.get("acknowledged_at")).isNotNull();
        assertThat(cp.get("display_claim_token")).isNotNull();

        // group_members — 관계 증거만 남기고 개인 설정 초기화. C 는 그대로
        assertThat(row("select * from group_members where id=?", s.wMembership()))
                .containsEntry("is_left", true).containsEntry("notification_enabled", false)
                .containsEntry("announcement_permission", "DISALLOW").containsEntry("status", "INACTIVE")
                .containsEntry("role", "MEMBER");
        assertThat(row("select * from group_members where id=?", s.cMembership()))
                .containsEntry("is_left", false).containsEntry("role", "OWNER")
                .containsEntry("announcement_permission", "ALLOW").containsEntry("status", "FOCUS");

        // group_invites — 양방향 삭제, 타인끼리는 유지
        assertThat(count("select count(*) from group_invites where inviter_id=? or invitee_id=?", w.id(), w.id()))
                .isZero();
        assertThat(count("select count(*) from group_invites where id=?", s.otherInvite())).isEqualTo(1L);

        // user_blocks — 양방향 삭제, 타인끼리는 유지
        assertThat(count("select count(*) from user_blocks where blocker_id=? or blocked_id=?", w.id(), w.id()))
                .isZero();
        assertThat(count("select count(*) from user_blocks where blocker_id=?", c.id())).isEqualTo(1L);

        // user_streaks
        assertThat(count("select count(*) from user_streaks where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from user_streaks where user_id=?", c.id())).isEqualTo(1L);

        // friendships — status·deleted_at 무관 전부 삭제, 타인끼리는 유지 / pinned_users 양방향 삭제
        assertThat(count("select count(*) from friendships where from_user_id=? or to_user_id=?", w.id(), w.id()))
                .isZero();
        assertThat(count("select count(*) from friendships where id=?", s.otherFriendship())).isEqualTo(1L);
        assertThat(count("select count(*) from pinned_users where user_id=? or pinned_user_id=?", w.id(), w.id()))
                .isZero();
        assertThat(count("select count(*) from pinned_users where user_id=?", c.id())).isEqualTo(1L);

        // character_equipment · character_generation
        assertThat(count("select count(*) from character_equipment where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from character_equipment where user_id=?", c.id())).isEqualTo(1L);
        assertThat(count("select count(*) from character_generation where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from character_generation where user_id=?", c.id())).isEqualTo(1L);

        // league — 일간 snapshot 삭제, 주간 결과는 (user, week) 완료 마커만
        assertThat(count("select count(*) from league_rank_snapshots where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from league_rank_snapshots where user_id=?", c.id())).isEqualTo(1L);
        assertThat(row("select * from league_weekly_results where user_id=?", w.id()))
                .containsEntry("previous_tier_level", null).containsEntry("new_tier_level", null)
                .containsEntry("result", null).containsEntry("focus_seconds", null)
                .containsEntry("acknowledged_at", null);
        assertThat(row("select * from league_weekly_results where user_id=?", c.id()))
                .containsEntry("result", "PROMOTED").containsEntry("focus_seconds", 3600);

        // user_focus_tags — 세션 태그 연결 해제 뒤 채택 행 삭제. 세션 행은 남는다(user_id 도 null)
        assertThat(count("select count(*) from user_focus_tags where user_id=?", w.id())).isZero();
        assertThat(row("select user_id, focus_tag_id from focus_sessions where id=?", s.wFocusSession()))
                .containsEntry("user_id", null).containsEntry("focus_tag_id", null);
        assertThat(uuid("select focus_tag_id from focus_sessions where id=?", s.cFocusSession()))
                .isEqualTo(s.cTag());

        // group_invite_links — 본인 발급 링크의 발급자만 null, 링크·종속 클릭 보존
        assertThat(uuid("select inviter_id from group_invite_links where id=?", s.wLink())).isNull();
        assertThat(uuid("select claimed_user_id from invite_link_clicks where id=?", s.clickOnWLink()))
                .isEqualTo(t.id());
        assertThat(uuid("select inviter_id from group_invite_links where id=?", s.cLink())).isEqualTo(c.id());

        // invite_link_clicks — W 가 claim 한 클릭의 귀속·기기·IP 해시·UA 파기, 소진 표지 보존
        assertThat(row("select * from invite_link_clicks where id=?", s.wClaimedClick()))
                .containsEntry("claimed_user_id", null).containsEntry("matched_device_id", null)
                .containsEntry("ip_hash", null).containsEntry("user_agent", null)
                .containsEntry("matched", true).containsEntry("app_instance_id", "app-w");
        assertThat(row("select claimed_at from invite_link_clicks where id=?", s.wClaimedClick()).get("claimed_at"))
                .isNotNull();

        // login_attempts — W 는 INVALIDATED + digest·서명 재료 파기, C 는 그대로
        assertThat(row("select * from login_attempts where attempt_id=?", s.wAttempt()))
                .containsEntry("status", "INVALIDATED").containsEntry("digest_key_id", null)
                .containsEntry("credential_digest", null).containsEntry("refresh_jti", null)
                .containsEntry("access_expires_at", null);
        assertThat(row("select * from login_attempts where attempt_id=?", s.cAttempt()))
                .containsEntry("status", "COMPLETED").containsEntry("credential_digest", "digest-c");

        // auth_sessions — 폐기 tombstone 에서 RT·bootstrap 해시 파기. C 세션은 살아 있다
        assertThat(count("select count(*) from auth_sessions where user_id=? and (refresh_token_hash is not null"
                + " or bootstrap_nonce_hash is not null or revoked_at is null)", w.id())).isZero();
        assertThat(count("select count(*) from auth_sessions where user_id=?", w.id())).isEqualTo(1L);
        assertThat(count("select count(*) from auth_sessions where user_id=? and refresh_token_hash is not null"
                + " and revoked_at is null", c.id())).isEqualTo(1L);

        // 공개 명령 receipt — W 는 삭제, C 는 유지
        assertThat(count("select count(*) from command_idempotency where user_id=?"
                + " and command_type like 'public:v1:%'", w.id())).isZero();
        assertThat(count("select count(*) from command_idempotency where user_id=?"
                + " and command_type like 'public:v1:%'", c.id())).isEqualTo(1L);

        // social_accounts (기존 파기) — W 삭제, C 유지
        assertThat(count("select count(*) from social_accounts where user_id=?", w.id())).isZero();
        assertThat(count("select count(*) from social_accounts where user_id=?", c.id())).isEqualTo(1L);
    }

    // ---------------------------------------------------------------- 픽스처

    private record Seed(UUID wAnnouncement, UUID cAnnouncement, UUID friendLogAboutW, UUID overtakeAboutW,
                        UUID otherLog, UUID otherSubject, UUID wParticipant, UUID cParticipant,
                        UUID wMembership, UUID cMembership, UUID otherInvite, UUID otherFriendship,
                        UUID wFocusSession, UUID cFocusSession, UUID cTag, UUID wLink, UUID cLink,
                        UUID clickOnWLink, UUID wClaimedClick, UUID wAttempt, UUID cAttempt) {
    }

    private Seed seed(UUID wId, UUID cId, UUID tId) {
        return new TransactionTemplate(transactions).execute(status -> {
            User w = em.find(User.class, wId);
            User c = em.find(User.class, cId);
            User t = em.find(User.class, tId);
            for (User user : new User[] {w, c}) {
                user.setOccupation(Occupation.TAX_ACCOUNTANT);
                user.setStatVisibility(StatVisibility.PUBLIC);
                user.setCharacterTrialAnchorAt(Instant.now());
                em.persist(com.oneorthree.phone.user.repository.domain.SocialAccount.builder().user(user)
                        .provider(com.oneorthree.phone.user.repository.domain.Provider.APPLE)
                        .providerId("apple-" + user.getId()).build());
            }
            Instant now = Instant.now();
            Instant past = now.minusSeconds(7200);

            // 그룹 G: C 방장, W 주민(개인 설정이 기본값이 아닌 상태)
            Group group = Group.builder().name("파기" + suffix()).maxMembers(10).build();
            em.persist(group);
            GroupMember cMember = GroupMember.builder().group(group).user(c).role(GroupMemberRole.OWNER)
                    .status(GroupMemberStatus.FOCUS).announcementPermission(GroupAnnouncementGrant.ALLOW).build();
            GroupMember wMember = GroupMember.builder().group(group).user(w).role(GroupMemberRole.MEMBER)
                    .status(GroupMemberStatus.FOCUS).announcementPermission(GroupAnnouncementGrant.ALLOW)
                    .notificationEnabled(true).build();
            em.persist(cMember);
            em.persist(wMember);
            GroupAnnouncement wNotice = GroupAnnouncement.builder().group(group).user(w).title("W공지")
                    .content("본문").build();
            GroupAnnouncement cNotice = GroupAnnouncement.builder().group(group).user(c).title("C공지")
                    .content("본문").build();
            em.persist(wNotice);
            em.persist(cNotice);
            em.persist(GroupInvite.builder().group(group).inviter(c).invitee(w).build());
            em.persist(GroupInvite.builder().group(group).inviter(w).invitee(c).build());
            GroupInvite otherInvite = GroupInvite.builder().group(group).inviter(c).invitee(t).build();
            em.persist(otherInvite);

            // 창형 보고 + 정산 끝난 회차의 참가 행
            GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.SCREEN_TIME)
                    .type(MissionType.TIME_WINDOW).build();
            em.persist(challenge);
            for (User user : new User[] {w, c}) {
                em.persist(GroupChallengeMember.builder().groupChallenge(challenge).user(user)
                        .usageDate(LocalDate.now(ZoneOffset.UTC)).progressMinutes(30).measuredAt(past).build());
            }
            GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge).stake(100)
                    .enabled(true).build();
            em.persist(bet);
            GroupChallengeBetSession session = GroupChallengeBetSession.builder().bet(bet).group(group)
                    .challenge(challenge).sessionDate(LocalDate.now(ZoneOffset.UTC).minusDays(1)).stake(100)
                    .goalMinutes(30).missionCategory(MissionCategory.SCREEN_TIME).missionType(MissionType.TIME_WINDOW)
                    .status(GroupBetStatus.SETTLED).settledAt(past)
                    .startsAt(past.minusSeconds(3600)).joinClosesAt(past).closesAt(past).settleAfter(past).build();
            em.persist(session);
            GroupChallengeBetParticipant wPart = GroupChallengeBetParticipant.builder().session(session).user(w)
                    .achieved(true).payout(200).progressMinutes(10).acknowledgedAt(past).displayClaimedAt(past)
                    .displayClaimToken(UUID.randomUUID()).build();
            GroupChallengeBetParticipant cPart = GroupChallengeBetParticipant.builder().session(session).user(c)
                    .achieved(false).payout(0).progressMinutes(90).acknowledgedAt(past).displayClaimedAt(past)
                    .displayClaimToken(UUID.randomUUID()).build();
            em.persist(wPart);
            em.persist(cPart);

            // 차단·스트릭·친구·핀
            em.persist(UserBlock.builder().blocker(w).blocked(c).build());
            em.persist(UserBlock.builder().blocker(c).blocked(w).build());
            em.persist(UserBlock.builder().blocker(c).blocked(t).build());
            for (User user : new User[] {w, c}) {
                em.persist(UserStreak.builder().user(user).streakCount(3).longestStreakCount(5)
                        .lastSessionDate(LocalDate.now(ZoneOffset.UTC)).build());
            }
            em.persist(Friendship.builder().fromUser(w).toUser(c).status(FriendshipStatus.ACCEPTED).build());
            Friendship oldRequest = Friendship.builder().fromUser(t).toUser(w).status(FriendshipStatus.REJECTED)
                    .build();
            em.persist(oldRequest);
            oldRequest.softDelete(past);
            Friendship otherFriendship = Friendship.builder().fromUser(c).toUser(t)
                    .status(FriendshipStatus.ACCEPTED).build();
            em.persist(otherFriendship);
            em.persist(PinnedUser.builder().user(w).pinnedUser(c).build());
            em.persist(PinnedUser.builder().user(c).pinnedUser(w).build());
            em.persist(PinnedUser.builder().user(c).pinnedUser(t).build());

            // 장착·생성 이력·리그
            Item item = Item.builder().name("모자").itemType(ItemType.EQUIPPABLE).slotType(SlotType.HAIR)
                    .grade("COMMON").paymentType(PriceType.CURRENCY).currencyPrice(10).build();
            em.persist(item);
            for (User user : new User[] {w, c}) {
                em.persist(CharacterEquipment.builder().user(user).item(item).slotType(SlotType.HAIR).build());
                em.persist(CharacterGeneration.builder().user(user).createdAt(past)
                        .clientGenerationId(UUID.randomUUID()).build());
                em.persist(LeagueRankSnapshot.builder().userId(user.getId()).rank(1)
                        .createdAt(LocalDate.now(ZoneOffset.UTC)).build());
                em.persist(LeagueWeeklyResult.builder().user(user).weekStartAt(past).previousTierLevel(1)
                        .newTierLevel(2).result(LeagueWeeklyResultType.PROMOTED).focusSeconds(3600)
                        .acknowledgedAt(past).build());
            }

            // 집중 태그 + 그 태그를 가리키는 세션
            DefaultTag tagName = DefaultTag.builder().name("파기태그" + suffix()).build();
            em.persist(tagName);
            UserFocusTag wTag = UserFocusTag.builder().user(w).defaultTag(tagName).build();
            UserFocusTag cTag = UserFocusTag.builder().user(c).defaultTag(tagName).build();
            em.persist(wTag);
            em.persist(cTag);
            FocusSession wSession = FocusSession.builder().user(w).focusTag(wTag).status(FocusSessionStatus.COMPLETED)
                    .startedAt(past).endedAt(past.plusSeconds(600)).build();
            FocusSession cSession = FocusSession.builder().user(c).focusTag(cTag).status(FocusSessionStatus.COMPLETED)
                    .startedAt(past).endedAt(past.plusSeconds(600)).build();
            em.persist(wSession);
            em.persist(cSession);

            // 알림 발송 이력
            UUID otherSubject = UUID.randomUUID();
            em.persist(NotificationSentLog.builder().userId(w.getId()).type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                    .targetUserId(c.getId()).kind("RANK_OVERTAKE").subjectId(UUID.randomUUID()).sentAt(past).build());
            NotificationSentLog friendAboutW = NotificationSentLog.builder().userId(c.getId())
                    .type(NotificationSentLog.TYPE_FRIEND_REQUEST).targetUserId(w.getId())
                    .kind(NotificationSentLog.TYPE_FRIEND_REQUEST).subjectId(UUID.randomUUID()).sentAt(past).build();
            NotificationSentLog overtakeAboutW = NotificationSentLog.builder().userId(c.getId())
                    .type(NotificationSentLog.TYPE_RANK_OVERTAKE).targetUserId(w.getId())
                    .kind(NotificationSentLog.TYPE_RANK_OVERTAKE).subjectId(UUID.randomUUID()).sentAt(past).build();
            // 다형 키 — 다른 종류의 target 은 사용자로 보지 않는다
            NotificationSentLog other = NotificationSentLog.builder().userId(c.getId()).type("CHALLENGE_CREATED")
                    .targetUserId(otherSubject).kind("CHALLENGE_CREATED").subjectId(UUID.randomUUID())
                    .sentAt(past).build();
            em.persist(friendAboutW);
            em.persist(overtakeAboutW);
            em.persist(other);

            // 초대 링크: W 발급(T 가 claim) · C 발급(W 가 claim)
            GroupInviteLink wLink = new GroupInviteLink("w" + suffix(), group.getId(), w.getId());
            GroupInviteLink cLink = new GroupInviteLink("c" + suffix(), group.getId(), c.getId());
            em.persist(wLink);
            em.persist(cLink);
            InviteLinkClick clickOnWLink = new InviteLinkClick(wLink.getId(), "iphash-t", "ios", "ua-t");
            em.persist(clickOnWLink);
            clickOnWLink.markMatched("device-t", "app-t");
            clickOnWLink.claim(t.getId(), w.getId());
            InviteLinkClick wClaimed = new InviteLinkClick(cLink.getId(), "iphash-w", "ios", "ua-w");
            em.persist(wClaimed);
            wClaimed.markMatched("device-w", "app-w");
            wClaimed.claim(w.getId(), c.getId());
            em.flush();

            // 로그인 시도 원장 — 완료된 시도의 digest·고정 서명 재료
            UUID wAttempt = UUID.randomUUID();
            UUID cAttempt = UUID.randomUUID();
            insertCompletedAttempt(wAttempt, w.getId(), "digest-w");
            insertCompletedAttempt(cAttempt, c.getId(), "digest-c");

            return new Seed(wNotice.getId(), cNotice.getId(), friendAboutW.getId(), overtakeAboutW.getId(),
                    other.getId(), otherSubject, wPart.getId(), cPart.getId(), wMember.getId(), cMember.getId(),
                    otherInvite.getId(), otherFriendship.getId(), wSession.getId(), cSession.getId(), cTag.getId(),
                    wLink.getId(), cLink.getId(), clickOnWLink.getId(), wClaimed.getId(), wAttempt, cAttempt);
        });
    }

    private void insertCompletedAttempt(UUID attemptId, UUID userId, String digest) {
        Instant now = Instant.now();
        jdbc.update("insert into login_attempts (attempt_id, status, digest_key_id, credential_digest, provider,"
                        + " credential_kind, terms_version, user_id, session_id, onboarding_complete, token_guest,"
                        + " auth_generation, access_issued_at, access_expires_at, refresh_issued_at,"
                        + " refresh_expires_at, refresh_jti, claimed_at, completed_at, recovery_expires_at) values"
                        + " (?, 'COMPLETED', 'key', ?, 'APPLE', 'id_token', 't1', ?, ?, true, false, 0, ?, ?, ?, ?, ?,"
                        + " ?, ?, ?)",
                attemptId, digest, userId, UUID.randomUUID(), ts(now), ts(now.plusSeconds(3600)), ts(now),
                ts(now.plusSeconds(86400)), UUID.randomUUID(), ts(now), ts(now), ts(now.plusSeconds(300)));
    }

    private Actor actor() {
        var login = auth.guestLogin();
        return new Actor(jwt.extractUserId(login.accessToken()), login.sessionId());
    }

    private Map<String, Object> row(String sql, Object... args) {
        return jdbc.queryForMap(sql, args);
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private UUID uuid(String sql, Object... args) {
        return jdbc.queryForObject(sql, UUID.class, args);
    }

    private static java.sql.Timestamp ts(Instant instant) {
        return java.sql.Timestamp.from(instant);
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 6);
    }

    private static String name() {
        return "파기" + suffix();
    }

    private record Actor(UUID id, UUID session) {
    }
}
