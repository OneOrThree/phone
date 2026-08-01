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
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 랜딩 통합 테스트 (계약 ② {@code GET /l/{slug}}).
 *
 * <p>랜딩은 <b>무슨 일이 있어도 200 HTML</b> 이어야 한다. 여기 도달하는 건 미설치 유저,
 * 카톡 인앱브라우저, OG 스크레이퍼 셋인데 302 는 뒤의 둘을 망가뜨리고, 500 은 초대를 통째로 잃는다.
 *
 * <p>봇 필터를 함께 잠근다. 카톡에 링크를 붙이면 사람보다 스크레이퍼가 먼저 도달하는데,
 * 그걸 클릭으로 남기면 클릭 수가 부풀 뿐 아니라 <b>스크레이퍼 IP 의 미소진 클릭</b>이 매치 후보로
 * 남아 엉뚱한 설치에 붙는다.
 */
@AutoConfigureMockMvc
class LandingTest extends IntegrationTestBase {

    private static final String IPHONE_UA =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
    private static final String KAKAO_SCRAPER_UA = "facebookexternalhit/1.1; kakaotalk-scrap/1.0;";

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

    private Group group;
    private User inviter;
    private GroupInviteLink link;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        inviter = userRepository.save(
                User.builder().nickname("초대자" + UUID.randomUUID()).isGuest(false).build());
        link = inviteLinkRepository.save(new GroupInviteLink("ab23cd45", group.getId(), inviter.getId()));
    }

    @AfterEach
    void tearDown() {
        clickRepository.deleteAll(clickRepository.findAll());
        inviteLinkRepository.deleteAll(inviteLinkRepository.findAll());
        groupRepository.delete(group);
        userRepository.delete(inviter);
    }

    @Test
    @DisplayName("랜딩은 200 HTML 이고 클릭이 기록된다")
    void servesHtmlAndRecordsClick() throws Exception {
        String body = mockMvc.perform(get("/l/{slug}", link.getSlug())
                        .header("User-Agent", IPHONE_UA)
                        .header("CF-Connecting-IP", "1.2.3.4"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/html"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("스터디");
        assertThat(body).contains("gromo://join?g=" + group.getId() + "&s=" + link.getSlug());

        List<InviteLinkClick> clicks = clickRepository.findByLinkId(link.getId());
        assertThat(clicks).hasSize(1);
        InviteLinkClick click = clicks.get(0);
        assertThat(click.getIpHash()).hasSize(64).matches("[0-9a-f]+");
        // 원본 IP 가 어떤 컬럼에도 남지 않는다
        assertThat(click.getIpHash()).doesNotContain("1.2.3.4");
        assertThat(click.getOs()).isEqualTo("ios");
        assertThat(click.isMatched()).isFalse();
    }

    @Test
    @DisplayName("봇 UA 는 200 이지만 클릭을 기록하지 않는다")
    void doesNotRecordBotClicks() throws Exception {
        mockMvc.perform(get("/l/{slug}", link.getSlug())
                        .header("User-Agent", KAKAO_SCRAPER_UA)
                        .header("CF-Connecting-IP", "1.2.3.4"))
                .andExpect(status().isOk());

        assertThat(clickRepository.findByLinkId(link.getId())).isEmpty();
    }

    @Test
    @DisplayName("없는 slug 도 200 만료 변형이다 — 유입을 설치 기회로 회수한다")
    void unknownSlugStillReturnsHtml() throws Exception {
        String body = mockMvc.perform(get("/l/{slug}", "zzzzzzzz")
                        .header("User-Agent", IPHONE_UA))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/html"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("data-expired=\"true\"");
        // 만료여도 스토어 버튼은 남는다
        assertThat(body).contains("apps.apple.com");
        assertThat(clickRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("그룹명은 HTML 이스케이프된다 — 그룹명이 곧 XSS 입력구다")
    void escapesGroupName() throws Exception {
        Group evil = groupRepository.save(Group.builder().name("<script>alert(1)</script>").build());
        inviteLinkRepository.save(new GroupInviteLink("xssslug1", evil.getId(), inviter.getId()));

        String body = mockMvc.perform(get("/l/{slug}", "xssslug1")
                        .header("User-Agent", IPHONE_UA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("<script>alert(1)</script>");
        assertThat(body).contains("&lt;script&gt;");

        clickRepository.deleteAll(clickRepository.findAll());
        inviteLinkRepository.deleteAll(inviteLinkRepository.findAll());
        groupRepository.delete(evil);
    }
}
