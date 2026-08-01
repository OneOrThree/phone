package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

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
class LandingTest extends InviteLinkTestSupport {

    private Group group;
    private User inviter;
    private GroupInviteLink link;

    @BeforeEach
    void setUp() {
        group = newGroup("스터디");
        inviter = newUser("초대자");
        link = newLink("ab23cd45", group, inviter);
    }

    @Test
    @DisplayName("랜딩은 200 HTML 이고 클릭이 기록된다")
    void servesHtmlAndRecordsClick() throws Exception {
        String body = mockMvc.perform(get("/l/{slug}", link.getSlug())
                        .header("User-Agent", IPHONE_UA)
                        .header("CF-Connecting-IP", CLICK_IP))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/html"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("스터디");
        assertThat(body).contains("gromo://join?g=" + group.getId() + "&s=" + link.getSlug());

        InviteLinkClick click = onlyClickOf(link);
        assertThat(click.getIpHash()).hasSize(64).matches("[0-9a-f]+");
        // 원본 IP 가 어떤 컬럼에도 남지 않는다
        assertThat(click.getIpHash()).doesNotContain(CLICK_IP);
        assertThat(click.getOs()).isEqualTo("ios");
        assertThat(click.isMatched()).isFalse();
    }

    @Test
    @DisplayName("봇 UA 는 200 이지만 클릭을 기록하지 않는다")
    void doesNotRecordBotClicks() throws Exception {
        mockMvc.perform(get("/l/{slug}", link.getSlug())
                        .header("User-Agent", KAKAO_SCRAPER_UA)
                        .header("CF-Connecting-IP", CLICK_IP))
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
        assertThat(body).contains("만료된 초대예요");
        // 만료여도 스토어 버튼은 남는다 — 여기까지 온 사람은 이미 설치 의향이 있는 유입이다
        assertThat(body).contains("apps.apple.com");
        // OG 제목의 그룹명 자리가 비면 「」 처럼 깨진 미리보기가 퍼진다 — 중립 명칭으로 채워져야 한다
        assertThat(body).doesNotContain("「」");
        assertThat(body).contains("그로모 그룹");
        assertThat(clickRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("그룹이 삭제됐으면 만료로 다룬다 — 참여시킬 곳이 없다")
    void deletedGroupIsExpired() throws Exception {
        GroupInviteLink orphan = newLink("gone1234", newDeletedGroup("사라진방"), inviter);

        String body = mockMvc.perform(get("/l/{slug}", orphan.getSlug())
                        .header("User-Agent", IPHONE_UA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("data-expired=\"true\"");
        assertThat(clickRepository.findByLinkId(orphan.getId())).isEmpty();
    }

    @Test
    @DisplayName("그룹이 종료(ENDED)돼도 만료로 다룬다 — 방은 남아 있지만 아무도 못 들어간다")
    void endedGroupIsExpired() throws Exception {
        GroupInviteLink stale = newLink("ended123", newEndedGroup("끝난방"), inviter);

        String body = mockMvc.perform(get("/l/{slug}", stale.getSlug())
                        .header("User-Agent", IPHONE_UA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("data-expired=\"true\"");
        assertThat(clickRepository.findByLinkId(stale.getId())).isEmpty();
    }

    @Test
    @DisplayName("그룹명은 HTML 이스케이프된다 — 그룹명이 곧 XSS 입력구다")
    void escapesGroupName() throws Exception {
        Group evil = newGroup("<script>alert(1)</script>");
        GroupInviteLink evilLink = newLink("xssslug1", evil, inviter);

        String body = mockMvc.perform(get("/l/{slug}", evilLink.getSlug())
                        .header("User-Agent", IPHONE_UA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("<script>alert(1)</script>");
        assertThat(body).contains("&lt;script&gt;");
    }
}
