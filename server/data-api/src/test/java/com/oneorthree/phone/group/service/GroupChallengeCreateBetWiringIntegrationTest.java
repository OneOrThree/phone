package com.oneorthree.phone.group.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 챌린지 생성 시 내기 배선(GROMO-1410 ② · N35) 통합 테스트 — {@code bet:{enabled,stake}} 요청이
 * 설정 생성 + 당일 회차 개설(활성 요일 + 참가 가능 시각일 때)로 이어지는지, 무효 stake 가 생성째
 * 롤백되는지를 실 DB 로 고정한다.
 *
 * <p>요청 DTO 는 와이어 계약({@code bet:{enabled,stake}}) 그대로 JSON 역직렬화로 만든다 — 세터 없는
 * DTO 를 리플렉션으로 채우면 계약 표기가 테스트에서 안 보인다.
 */
class GroupChallengeCreateBetWiringIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupChallengeService groupChallengeService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupChallengeRepository groupChallengeRepository;
    @Autowired
    GroupChallengeDurationRepository groupChallengeDurationRepository;
    @Autowired
    GroupChallengeWindowRepository groupChallengeWindowRepository;
    @Autowired
    GroupChallengeBetRepository groupChallengeBetRepository;
    @Autowired
    GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    JdbcTemplate jdbcTemplate;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int STAKE = 300;

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
    private final List<UUID> createdChallengeIds = new ArrayList<>();

    private Group group;
    private User owner;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        owner = userRepository.save(User.builder().nickname("방장").isGuest(false).build());
        groupMemberRepository.save(GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build());
    }

    @AfterEach
    void tearDown() {
        jdbcTemplate.update("DELETE FROM group_challenge_bet_sessions WHERE group_id = ?", group.getId());
        jdbcTemplate.update("DELETE FROM group_challenge_bets WHERE group_id = ?", group.getId());
        createdChallengeIds.forEach(id -> {
            groupChallengeDurationRepository.findById(id).ifPresent(groupChallengeDurationRepository::delete);
            groupChallengeWindowRepository.findById(id).ifPresent(groupChallengeWindowRepository::delete);
            groupChallengeRepository.findById(id).ifPresent(groupChallengeRepository::delete);
        });
        groupMemberRepository.findAnyByUserAndGroup(owner, group).ifPresent(groupMemberRepository::delete);
        userRepository.delete(owner);
        groupRepository.delete(group);
        createdChallengeIds.clear();
    }

    private CreateChallengeRequest request(String json) {
        try {
            return objectMapper.readValue(json, CreateChallengeRequest.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static LocalDate today() {
        return LocalDate.now(KST);
    }

    @Test
    @DisplayName("내기 켠 하루형 생성 — 설정이 만들어지고 당일 회차가 함께 개설된다 (N35: 하루형은 종일 참가 가능)")
    void createWithBetOpensTodaySession() {
        CreateChallengeResponse response = groupChallengeService.createChallenge(group.getId(),
                owner.getId(), request("""
                        {"missionCategory":"FOCUS","missionType":"DURATION","durationMinutes":120,
                         "bet":{"enabled":true,"stake":%d}}""".formatted(STAKE)));
        createdChallengeIds.add(response.getId());

        GroupChallengeBet config = groupChallengeBetRepository.findByChallengeId(response.getId())
                .orElseThrow();
        assertThat(config.getStake()).isEqualTo(STAKE);
        assertThat(config.isEnabled()).isTrue();
        GroupChallengeBetSession session = groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(config.getId(), today()).orElseThrow();
        assertThat(session.isOpen()).isTrue();
        assertThat(session.getStake()).isEqualTo(STAKE);
        assertThat(session.getGoalMinutes()).isEqualTo(120);
        // 개설만 하고 참가는 시키지 않는다 — v2 에서 생성은 참가가 아니다(N14).
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM group_challenge_bet_participants WHERE session_id = ?",
                Long.class, session.getId())).isZero();
    }

    @Test
    @DisplayName("bet 미전송·enabled=false 생성 — 설정도 회차도 만들지 않는다")
    void createWithoutBetLeavesNoConfig() {
        CreateChallengeResponse noBet = groupChallengeService.createChallenge(group.getId(),
                owner.getId(), request("""
                        {"missionCategory":"FOCUS","missionType":"DURATION","durationMinutes":120}"""));
        createdChallengeIds.add(noBet.getId());
        assertThat(groupChallengeBetRepository.findByChallengeId(noBet.getId())).isEmpty();

        CreateChallengeResponse disabled = groupChallengeService.createChallenge(group.getId(),
                owner.getId(), request("""
                        {"missionCategory":"SCREEN_TIME","missionType":"DURATION","durationMinutes":120,
                         "bet":{"enabled":false,"stake":300}}"""));
        createdChallengeIds.add(disabled.getId());
        assertThat(groupChallengeBetRepository.findByChallengeId(disabled.getId())).isEmpty();
    }

    @Test
    @DisplayName("무효 stake — BET_INVALID_STAKE 로 챌린지 생성째 롤백된다 (같은 트랜잭션)")
    void invalidStakeRollsBackChallengeCreation() {
        for (int invalidStake : new int[] {0, 3_001}) {
            assertThatThrownBy(() -> groupChallengeService.createChallenge(group.getId(),
                    owner.getId(), request("""
                            {"missionCategory":"FOCUS","missionType":"DURATION","durationMinutes":120,
                             "bet":{"enabled":true,"stake":%d}}""".formatted(invalidStake))))
                    .isInstanceOf(GroupException.class)
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.BET_INVALID_STAKE);
        }
        assertThat(groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group))
                .isEmpty();
    }

    @Test
    @DisplayName("창 시작이 지난 창형 생성 — 설정만 만들고 당일 회차는 열지 않는다 (N35: 다음 활성일부터)")
    void startedWindowCreationSkipsTodaySession() {
        // 창 00:00~00:15 — 실행 시각과 무관하게 오늘 창 시작이 항상 지나 있다.
        CreateChallengeResponse response = groupChallengeService.createChallenge(group.getId(),
                owner.getId(), request("""
                        {"missionCategory":"FOCUS","missionType":"TIME_WINDOW","durationMinutes":15,
                         "windowStart":"00:00:00","windowEnd":"00:15:00",
                         "bet":{"enabled":true,"stake":%d}}""".formatted(STAKE)));
        createdChallengeIds.add(response.getId());

        GroupChallengeBet config = groupChallengeBetRepository.findByChallengeId(response.getId())
                .orElseThrow();
        assertThat(groupChallengeBetSessionRepository
                .findByBetIdAndSessionDate(config.getId(), today())).isEmpty();
    }
}
