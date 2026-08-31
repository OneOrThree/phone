package com.oneorthree.phone.group.api;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
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
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 창형 챌린지 생성의 <b>실 JSON 왕복</b> 검증(GROMO-1225 · GROMO-1406) — 요청 windowStart/End 표기 통일.
 *
 * <p>요청은 신형 {@code "HH:mm:ss"} 와 구앱 ISO Instant 를 이중 수용하고, 저장은 KST 벽시계
 * {@code time}(V35) 그 자체, 응답은 종전 그대로 KST {@code "HH:mm:ss"} 다.
 * 이 경로는 Jackson 바인딩(문자열 파싱 입구)까지 포함해야 계약이 잠기므로 MockMvc 로
 * 실제 와이어 형식을 태운다 — 서비스 단위 테스트(mock 요청)로는 대체되지 않는 커버리지다.
 */
@AutoConfigureMockMvc
class GroupChallengeWindowTimeWireTest extends IntegrationTestBase {

    /** 저장 기대값 — KST 벽시계 time 그 자체(V35, 종전 EPOCH 앵커 Instant 규약 폐기). */
    private static final LocalTime KST_09H = LocalTime.of(9, 0);
    private static final LocalTime KST_12H = LocalTime.of(12, 0);

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

        // 저장: KST 벽시계 time 그대로다 — 날짜부 자체가 없다(V35).
        GroupChallengeWindow saved = groupChallengeWindowRepository.findById(challengeId).orElseThrow();
        assertThat(saved.getWindowStart()).isEqualTo(KST_09H);
        assertThat(saved.getWindowEnd()).isEqualTo(KST_12H);

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

        // 저장: 구형 경로도 timeOfDay(KST 시각)를 경유해 신형과 같은 time 값으로 수렴한다.
        GroupChallengeWindow saved = groupChallengeWindowRepository.findById(challengeId).orElseThrow();
        assertThat(saved.getWindowStart()).isEqualTo(KST_09H);
        assertThat(saved.getWindowEnd()).isEqualTo(KST_12H);

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
    @DisplayName("패턴은 맞지만 값이 범위 밖(\"99:99\") → 같은 400 INVALID_MISSION_PARAMS, 저장 안 함")
    void patternMatchedButOutOfRangeMapsToInvalidMissionParams() throws Exception {
        // 판별 패턴(\d{2}:\d{2})을 통과한 뒤 LocalTime.parse 가 던지는 두 번째 수렴 경로 —
        // 형식 오류가 어느 분기에서 터지든 INVALID_MISSION_PARAMS 하나로 모인다는 계약의 나머지 절반.
        mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "durationMinutes":60,"windowStart":"99:99","windowEnd":"12:00:00"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_MISSION_PARAMS"));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    @DisplayName("자정 걸침 창(22:00~01:00, 시작 > 종료) → 400 INVALID_MISSION_PARAMS — §A6-1 되돌리기(GROMO-1406)")
    void midnightCrossingRejected() throws Exception {
        // 종전(PR #545 시점)에는 시각 보존 저장을 정상으로 고정했던 케이스다. N25 로 정책이 뒤집혀
        // 걸침 창은 생성 자체가 거부된다 — 이 단언을 남겨 두면 다음 사람이 "자정 걸침은 지원 사양"
        // 이라고 읽는다. 심야 챌린지는 22:00~23:59 처럼 자정 앞에서 끊는다.
        mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "durationMinutes":180,"windowStart":"22:00:00","windowEnd":"01:00:00"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_MISSION_PARAMS"));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    @DisplayName("요일 왕복 — repeatDays [MON,WED,FRI] 요청이 응답에 같은 정렬로 돌아오고, 미전송은 매일로 채워진다")
    void repeatDaysRoundTrip() throws Exception {
        // 신앱: 요일 명시 — 마스크로 접혀 저장되고 응답에서 같은 배열로 복원된다(GROMO-1260).
        MvcResult result = mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "repeatDays":["MON","WED","FRI"],
                                 "durationMinutes":60,"windowStart":"09:00:00","windowEnd":"12:00:00"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        createdChallengeIds.add(UUID.fromString(
                JsonPath.read(result.getResponse().getContentAsString(), "$.id")));

        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].repeatDays").value(org.hamcrest.Matchers.contains("MON", "WED", "FRI")))
                .andExpect(jsonPath("$[0].startedAt").isNotEmpty());
    }

    @Test
    @DisplayName("repeatDays 미전송(구앱) → 매일(7요일 전부)로 저장·응답, 빈 배열(신앱 미선택) → 400")
    void repeatDaysLegacyDefaultAndEmptyRejected() throws Exception {
        // 구앱: 필드 미전송 — 서버가 매일(127)로 접는다.
        postWindowChallenge("09:00:00", "12:00:00", 60);
        mockMvc.perform(get("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].repeatDays").value(org.hamcrest.Matchers.contains(
                        "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")));

        // 신앱: 빈 배열 — 기본값 없음 원칙(§A3)대로 400.
        mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "repeatDays":[],
                                 "durationMinutes":60,"windowStart":"14:00:00","windowEnd":"16:00:00"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CHALLENGE_REPEAT_DAYS_REQUIRED"));

        // [null] 원소 — Jackson 이 통과시키는 꼴. 비트 접기 NPE(500)가 아니라 같은 400 으로 수렴해야 한다.
        mockMvc.perform(post("/api/v1/groups/{groupId}/challenges", group.getId())
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"missionCategory":"FOCUS","missionType":"TIME_WINDOW",
                                 "repeatDays":[null],
                                 "durationMinutes":60,"windowStart":"14:00:00","windowEnd":"16:00:00"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CHALLENGE_REPEAT_DAYS_REQUIRED"));
    }
}
