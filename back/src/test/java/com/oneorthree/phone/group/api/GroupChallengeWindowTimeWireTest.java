package com.oneorthree.phone.group.api;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 창형 챌린지 생성의 <b>실 JSON 왕복</b> 검증(GROMO-1225) — 요청 windowStart/End 표기 통일.
 *
 * <p>요청은 신형 {@code "HH:mm:ss"} 와 구앱 ISO Instant 를 이중 수용하고, 저장은 날짜부를
 * EPOCH(1970-01-01, KST)로 고정한 Instant, 응답은 종전 그대로 KST {@code "HH:mm:ss"} 다.
 * 이 경로는 Jackson 바인딩(문자열 파싱 입구)까지 포함해야 계약이 잠기므로 MockMvc 로
 * 실제 와이어 형식을 태운다 — 서비스 단위 테스트(mock 요청)로는 대체되지 않는 커버리지다.
 */
@AutoConfigureMockMvc
class GroupChallengeWindowTimeWireTest extends IntegrationTestBase {

    /** EPOCH 앵커 기대값 — 1970-01-01(KST) + 벽시계 시각. */
    private static final Instant EPOCH_KST_09H = Instant.parse("1970-01-01T09:00:00+09:00");
    private static final Instant EPOCH_KST_12H = Instant.parse("1970-01-01T12:00:00+09:00");

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtProvider jwtProvider;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private GroupRepository groupRepository;
    @Autowired
    private GroupMemberRepository groupMemberRepository;
    @Autowired
    private GroupChallengeRepository groupChallengeRepository;
    @Autowired
    private GroupChallengeWindowRepository groupChallengeWindowRepository;

    private User owner;
    private Group group;
    private GroupMember membership;
    private final List<UUID> createdChallengeIds = new ArrayList<>();

    @BeforeEach
    void setUpFixtures() {
        owner = userRepository.save(User.builder()
                .nickname("창통일" + UUID.randomUUID())
                .isGuest(false)
                .build());
        group = groupRepository.save(Group.builder().name("창표기통일검증").maxMembers(10).build());
        membership = groupMemberRepository.save(GroupMember.builder()
                .user(owner).group(group).role(GroupMemberRole.OWNER).build());
    }

    /** IntegrationTestBase 는 롤백이 없다 — 만든 행을 FK 역순으로 직접 지운다(인바이트 테스트 관례). */
    @AfterEach
    void cleanUpFixtures() {
        for (UUID challengeId : createdChallengeIds) {
            groupChallengeWindowRepository.deleteById(challengeId);
            groupChallengeRepository.deleteById(challengeId);
        }
        createdChallengeIds.clear();
        groupMemberRepository.delete(membership);
        groupRepository.delete(group);
        userRepository.delete(owner);
    }

    private String bearer() {
        return "Bearer " + jwtProvider.generateAccessToken(owner.getId(), owner.isGuest());
    }

    /** 창형 생성 POST → 201 검증 후 챌린지 id 를 회수한다(정리 목록에도 등록). */
    private UUID postWindowChallenge(String windowStart, String windowEnd, int goalMinutes) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "durationMinutes":%d,"windowStart":"%s","windowEnd":"%s"}
                                """.formatted(goalMinutes, windowStart, windowEnd)))
                .andExpect(status().isCreated())
                .andReturn();
        UUID challengeId = UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id"));
        createdChallengeIds.add(challengeId);
        return challengeId;
    }

    @Test
    @DisplayName("신형 \"HH:mm:ss\" 요청 → 201 + EPOCH 앵커 저장 + 응답 \"HH:mm:ss\" 왕복")
    void newFormatRoundTrip() throws Exception {
        UUID challengeId = postWindowChallenge("09:00:00", "12:00:00", 60);

        // 저장: 날짜부는 EPOCH(KST)로 고정된다 — 의미는 KST 벽시계 시각뿐.
        GroupChallengeWindow saved = groupChallengeWindowRepository.findById(challengeId).orElseThrow();
        assertThat(saved.getWindowStartAt()).isEqualTo(EPOCH_KST_09H);
        assertThat(saved.getWindowEndAt()).isEqualTo(EPOCH_KST_12H);

        // 응답: 목록 조회가 같은 시각을 "HH:mm:ss" 로 돌려준다(왕복).
        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].windowStart").value("09:00:00"))
                .andExpect(jsonPath("$[0].windowEnd").value("12:00:00"));
    }

    @Test
    @DisplayName("구형 ISO Instant 요청 → 신형과 동일 저장·동일 응답 (기존 의미 바이트 보존)")
    void legacyIsoInstantConverges() throws Exception {
        // 구앱이 보내던 형식 그대로 — +09:00 오프셋의 진짜 Instant 문자열.
        UUID challengeId = postWindowChallenge("2026-08-05T09:00:00+09:00", "2026-08-05T12:00:00+09:00", 60);

        // 저장: 구형 경로도 timeOfDay(KST 시각)를 경유해 신형과 같은 EPOCH 앵커 Instant 로 수렴한다.
        GroupChallengeWindow saved = groupChallengeWindowRepository.findById(challengeId).orElseThrow();
        assertThat(saved.getWindowStartAt()).isEqualTo(EPOCH_KST_09H);
        assertThat(saved.getWindowEndAt()).isEqualTo(EPOCH_KST_12H);

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].windowStart").value("09:00:00"))
                .andExpect(jsonPath("$[0].windowEnd").value("12:00:00"));
    }

    @Test
    @DisplayName("깨진 형식 → 400 INVALID_MISSION_PARAMS (신규 에러 코드 없음), 저장 안 함")
    void brokenFormatMapsToInvalidMissionParams() throws Exception {
        mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "durationMinutes":60,"windowStart":"morning","windowEnd":"12:00:00"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_MISSION_PARAMS"));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    @DisplayName("자정 걸침 창(시작 > 종료) → 시각이 그대로 보존돼 저장·응답된다")
    void midnightCrossingPreserved() throws Exception {
        UUID challengeId = postWindowChallenge("22:00:00", "01:00:00", 180);

        // 저장: 시작·종료 각각 독립 EPOCH 앵커 — 시각 기준 시작 > 종료(자정 걸침)가 그대로 남는다.
        GroupChallengeWindow saved = groupChallengeWindowRepository.findById(challengeId).orElseThrow();
        assertThat(saved.getWindowStartAt()).isEqualTo(Instant.parse("1970-01-01T22:00:00+09:00"));
        assertThat(saved.getWindowEndAt()).isEqualTo(Instant.parse("1970-01-01T01:00:00+09:00"));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].windowStart").value("22:00:00"))
                .andExpect(jsonPath("$[0].windowEnd").value("01:00:00"));
    }
}
