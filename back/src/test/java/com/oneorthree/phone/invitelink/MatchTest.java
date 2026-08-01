package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * deferred 매치 통합 테스트 (계약 ③ {@code POST /l/match}).
 *
 * <p>클릭 → 설치 → 첫 실행이라는 실제 순서를 그대로 재현한다(랜딩 GET 으로 클릭을 만들고,
 * 같은 IP·OS 로 match 를 호출). 여기서 잠그는 핵심은 <b>소진</b>이다 — 한 클릭이 두 번 매치되면
 * 재설치할 때마다 같은 초대장이 되살아난다.
 */
@AutoConfigureMockMvc
class MatchTest extends IntegrationTestBase {

    private static final String IPHONE_UA =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
    private static final String CLICK_IP = "1.2.3.4";

    @Autowired
    MockMvc mockMvc;
    @Autowired
    UserRepository userRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupInviteLinkRepository inviteLinkRepository;
    @Autowired
    InviteLinkClickRepository clickRepository;
    @Autowired
    JdbcTemplate jdbcTemplate;

    private Group group;
    private User inviter;
    private GroupInviteLink link;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        inviter = userRepository.save(
                User.builder().nickname("초대자" + UUID.randomUUID()).isGuest(false).build());
        link = inviteLinkRepository.save(new GroupInviteLink("mt23cd45", group.getId(), inviter.getId()));
    }

    @AfterEach
    void tearDown() {
        clickRepository.deleteAll(clickRepository.findAll());
        inviteLinkRepository.deleteAll(inviteLinkRepository.findAll());
        groupRepository.delete(group);
        userRepository.delete(inviter);
    }

    @Test
    @DisplayName("같은 IP·OS 의 클릭은 slug 와 groupId 로 복원된다")
    void restoresInviteFromClick() throws Exception {
        clickLanding(CLICK_IP);

        match(CLICK_IP, "d1", "a1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.slug").value(link.getSlug()))
                .andExpect(jsonPath("$.groupId").value(group.getId().toString()));

        List<InviteLinkClick> clicks = clickRepository.findByLinkId(link.getId());
        assertThat(clicks).hasSize(1);
        InviteLinkClick click = clicks.get(0);
        assertThat(click.isMatched()).isTrue();
        assertThat(click.getMatchedAt()).isNotNull();
        assertThat(click.getMatchedDeviceId()).isEqualTo("d1");
        assertThat(click.getAppInstanceId()).isEqualTo("a1");
    }

    @Test
    @DisplayName("소진된 클릭은 재매치되지 않는다 — 재설치로 같은 초대가 되살아나지 않게")
    void consumedClickIsNotRematched() throws Exception {
        clickLanding(CLICK_IP);

        match(CLICK_IP, "d1", "a1").andExpect(jsonPath("$.matched").value(true));
        match(CLICK_IP, "d2", "a2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false))
                .andExpect(jsonPath("$.slug").doesNotExist())
                .andExpect(jsonPath("$.groupId").doesNotExist());
    }

    @Test
    @DisplayName("시간창(3h) 밖의 클릭은 매치되지 않는다")
    void clickOutsideWindowIsIgnored() throws Exception {
        clickLanding(CLICK_IP);
        jdbcTemplate.update("UPDATE invite_link_clicks SET clicked_at = now() - interval '4 hours'");

        match(CLICK_IP, "d1", "a1").andExpect(jsonPath("$.matched").value(false));
    }

    @Test
    @DisplayName("다른 IP 는 매치되지 않는다")
    void differentIpDoesNotMatch() throws Exception {
        clickLanding(CLICK_IP);

        match("9.9.9.9", "d1", "a1").andExpect(jsonPath("$.matched").value(false));
    }

    @Test
    @DisplayName("OS 가 다르면 매치되지 않는다 — fingerprint 의 두 번째 축")
    void differentOsDoesNotMatch() throws Exception {
        clickLanding(CLICK_IP);

        mockMvc.perform(post("/l/match")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("CF-Connecting-IP", CLICK_IP)
                        .content("{\"os\":\"android\",\"deviceId\":\"d1\",\"appInstanceId\":\"a1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false));
    }

    @Test
    @DisplayName("app_instance_id 없이도 매치된다 — GA4 결합만 포기하고 초대는 복원한다")
    void matchesWithoutAppInstanceId() throws Exception {
        clickLanding(CLICK_IP);

        mockMvc.perform(post("/l/match")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("CF-Connecting-IP", CLICK_IP)
                        .content("{\"os\":\"ios\",\"deviceId\":\"d1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true));
    }

    @Test
    @DisplayName("형식이 어긋난 요청은 400 — 컬럼 길이를 넘는 deviceId·미지원 os")
    void rejectsMalformedRequests() throws Exception {
        String longDeviceId = "d".repeat(65);

        mockMvc.perform(post("/l/match")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("CF-Connecting-IP", CLICK_IP)
                        .content("{\"os\":\"ios\",\"deviceId\":\"" + longDeviceId + "\"}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/l/match")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("CF-Connecting-IP", CLICK_IP)
                        .content("{\"os\":\"windows\",\"deviceId\":\"d1\"}"))
                .andExpect(status().isBadRequest());
    }

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    private void clickLanding(String ip) throws Exception {
        mockMvc.perform(get("/l/{slug}", link.getSlug())
                        .header("User-Agent", IPHONE_UA)
                        .header("CF-Connecting-IP", ip))
                .andExpect(status().isOk());
    }

    private org.springframework.test.web.servlet.ResultActions match(
            String ip, String deviceId, String appInstanceId) throws Exception {
        return mockMvc.perform(post("/l/match")
                .contentType(MediaType.APPLICATION_JSON)
                .header("CF-Connecting-IP", ip)
                .content("{\"os\":\"ios\",\"deviceId\":\"" + deviceId
                        + "\",\"appInstanceId\":\"" + appInstanceId + "\"}"));
    }
}
