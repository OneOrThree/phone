package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.user.repository.domain.User;
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
        // 닉네임을 그대로 둔다 — 랜딩이 초대자 이름을 어떻게 싣는지가 이 클래스의 관심사다.
        inviter = newUserWithExactNickname("김초대");
        link = newLink("ab23cd45", group, inviter);
    }

    @Test
    @DisplayName("랜딩은 200 HTML 이고 클릭이 기록된다")
    void servesHtmlAndRecordsClick() throws Exception {
        String body = mockMvc.perform(get("/l/{slug}", link.getSlug())
                        .header("User-Agent", IPHONE_UA)
                        .header("X-Real-IP", CLICK_IP))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/html"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("스터디");
        assertThat(body).contains("gromo://join?g=" + group.getId() + "&s=" + link.getSlug());
        // OG 이미지는 환경별 자기 도메인(ci: link.base-url=https://link.test)의 절대 URL 이어야 한다 —
        // 도메인이 하드코딩되면 dev 발급 링크의 미리보기가 미배포 prod 이미지를 가리켜 깨진다.
        assertThat(body).contains("property=\"og:image\" content=\"https://link.test/link/og-invite-v2.png\"");

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
                        .header("X-Real-IP", CLICK_IP))
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
        // OG 제목의 그룹명 자리가 비면 「」 처럼 깨진 미리보기가 퍼진다 — 중립 명칭으로 채워져야 한다.
        // (전역 doesNotContain("「」") 은 안 된다 — WS-5 템플릿의 CSS 주석에 설명용 리터럴이 있다.)
        assertThat(body).contains("「그로모 그룹」");
        // 만료 변형도 미리보기로 퍼진다 — OG 이미지 자리가 비면 안 된다.
        assertThat(body).contains("property=\"og:image\" content=\"https://link.test/link/og-invite-v2.png\"");
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
    @DisplayName("초대자 닉네임이 카드와 미리보기 제목에 실린다")
    void showsInviterName() throws Exception {
        String body = landingBody(link.getSlug());

        assertThat(body).contains("data-inviter=\"true\"");
        assertThat(body).contains("<span class=\"name\">김초대</span>님이 초대했어요");
        // 카톡 미리보기에서 가장 먼저 읽히는 줄 — 초대자가 문장 맨 앞에 와야 한다
        assertThat(body).contains("content=\"김초대님이 gromo 그룹 「스터디」에 초대했어요\"");
        assertThat(body).contains("<title>김초대님이 gromo 그룹 「스터디」에 초대했어요</title>");
    }

    @Test
    @DisplayName("초대자가 탈퇴했으면 초대자 줄을 접는다 — 초대 자체는 그대로 열린다")
    void hidesInviterWhenWithdrawn() throws Exception {
        User withdrawn = newUserWithExactNickname("떠난사람");
        withdrawn.setDeleted(true);
        userRepository.save(withdrawn);
        GroupInviteLink orphanInviter = newLink("gone2345", group, withdrawn);

        String body = landingBody(orphanInviter.getSlug());

        assertThat(body).contains("data-inviter=\"false\"");
        assertThat(body).doesNotContain("떠난사람");
        // 초대자를 몰라도 그룹명·CTA 는 그대로다
        assertThat(body).contains("스터디");
        assertThat(body).contains("content=\"gromo 그룹 「스터디」에 초대했어요\"");
    }

    @Test
    @DisplayName("닉네임이 없는 초대자(게스트)도 초대자 줄을 접는다")
    void hidesInviterWhenNicknameMissing() throws Exception {
        GroupInviteLink guestLink = newLink("guest123", group, newUserWithExactNickname(null));

        String body = landingBody(guestLink.getSlug());

        assertThat(body).contains("data-inviter=\"false\"");
        assertThat(body).contains("content=\"gromo 그룹 「스터디」에 초대했어요\"");
    }

    @Test
    @DisplayName("초대자 닉네임도 속성 안전 이스케이프된다 — og:title 의 content=\"…\" 안에 들어간다")
    void escapesInviterName() throws Exception {
        GroupInviteLink evilLink =
                newLink("xssnick1", group, newUserWithExactNickname("a\"><script>alert(1)</script>"));

        String body = landingBody(evilLink.getSlug());

        assertThat(body).doesNotContain("<script>alert(1)</script>");
        assertThat(body).contains("&lt;script&gt;");
        // 큰따옴표 하나로 content 속성이 닫히면 임의 속성이 주입된다 — 엔티티로 남아야 한다
        assertThat(body).contains("&quot;");
    }

    @Test
    @DisplayName("만료 변형은 초대자를 숨긴다 — 없는 slug 는 초대자도 특정할 수 없다")
    void expiredHidesInviter() throws Exception {
        String body = landingBody("zzzzzzzz");

        assertThat(body).contains("data-expired=\"true\"");
        assertThat(body).contains("data-inviter=\"false\"");
    }

    @Test
    @DisplayName("스토어 링크는 실제 출시 App ID 다 — 플레이스홀더면 '사용할 수 없는 앱'이 뜬다")
    void servesRealStoreUrl() throws Exception {
        String body = landingBody(link.getSlug());

        assertThat(body).contains("data-store=\"ready\"");
        assertThat(body).contains("https://apps.apple.com/kr/app/gromo-grow-motivation/id6774498679");
        assertThat(body).doesNotContain("id0000000000");
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

    @Test
    @DisplayName("카드에 별사탕 히어로가 실린다 — 랜딩이 브랜드의 첫 접점이다")
    void servesHeroImage() throws Exception {
        String body = landingBody(link.getSlug());

        // 루트 상대 경로여야 한다. 랜딩과 같은 오리진에서 서빙되므로 도메인을 박을 이유가 없고,
        // 박으면 dev 발급 링크가 미배포 prod 이미지를 가리킨다.
        assertThat(body).contains("src=\"/link/hero-study-v1.jpg\"");
        // width/height 가 빠지면 이미지가 늦게 그려질 때 아래 문구가 통째로 밀린다(레이아웃 시프트).
        assertThat(body).contains("width=\"640\" height=\"507\"");
        assertThat(body).contains("alt=\"원탁에 둘러앉아 함께 공부하는 별사탕 셋\"");
    }

    @Test
    @DisplayName("만료 변형도 히어로를 남긴다 — 여기까지 온 사람도 설치 후보다")
    void expiredKeepsHeroImage() throws Exception {
        String body = landingBody("zzzzzzzz");

        assertThat(body).contains("data-expired=\"true\"");
        assertThat(body).contains("src=\"/link/hero-study-v1.jpg\"");
    }

    @Test
    @DisplayName("히어로·OG 이미지 파일이 실제로 서빙된다 — 마크업만 고치고 파일을 빠뜨리면 깨진 링크다")
    void servesStaticImageAssets() throws Exception {
        for (String path : new String[]{
                "/link/hero-study-v1.jpg",
                "/link/og-invite-v2.png",
                // v1 은 지우지 않는다 — 이미 뿌려진 링크의 카톡 썸네일 캐시가 이 URL 을 가리킨다
                "/link/og-invite-v1.png"}) {
            byte[] bytes = mockMvc.perform(get(path))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsByteArray();
            assertThat(bytes).isNotEmpty();
        }
    }

    @Test
    @DisplayName("OG 썸네일은 v2 다 — 파일명을 바꿔야 카톡의 URL 단위 썸네일 캐시가 갱신된다")
    void servesRenewedOgCard() throws Exception {
        String body = landingBody(link.getSlug());

        assertThat(body).contains("https://link.test/link/og-invite-v2.png");
        // 같은 이름으로 내용만 갈아끼우면 이미 뿌려진 링크에 옛 이미지가 계속 뜬다.
        // (전역 doesNotContain("og-invite-v1.png") 은 안 된다 — 템플릿 주석이 v1 을 남겨 두는 이유를 적고 있다.)
        assertThat(body).doesNotContain("content=\"https://link.test/link/og-invite-v1.png\"");
        assertThat(body).contains("content=\"혼자 하면 작심삼일, 같이 하면 기록이 남아요.\"");
        assertThat(body).contains("content=\"gromo — 같이 공부하는 별사탕들\"");
    }

    private String landingBody(String slug) throws Exception {
        return mockMvc.perform(get("/l/{slug}", slug).header("User-Agent", IPHONE_UA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }
}
