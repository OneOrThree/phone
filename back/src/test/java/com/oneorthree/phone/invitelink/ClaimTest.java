package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * claim 통합 테스트 (계약 ④ {@code POST /api/v1/invite-links/claim}).
 *
 * <p>claim 은 "이 초대로 들어온 사람이 누구인가"를 확정하는 <b>결정론</b> 구간이다. 그래서
 * 최초 1회만 기록하고(뒤늦은 다른 유저의 claim 이 앞사람을 덮으면 어트리뷰션이 뒤집힌다),
 * 초대자 본인의 claim 은 무시한다(셀프 초대로 보상을 파먹는 경로를 미리 막는다).
 */
class ClaimTest extends InviteLinkTestSupport {

    private Group group;
    private User inviter;
    private GroupInviteLink link;

    @BeforeEach
    void setUp() {
        group = newGroup("스터디");
        inviter = newUser("초대자");
        link = newLink("cl23cd45", group, inviter);
    }

    @Test
    @DisplayName("claim 은 최초 1회만 기록된다 — 뒤늦은 다른 유저가 덮어쓰지 못한다")
    void firstClaimWins() throws Exception {
        matchedClick();
        User joiner = newUser("가입자");
        User latecomer = newUser("나중사람");

        claim(joiner).andExpect(status().isOk());
        assertThat(onlyClickOf(link).getClaimedUserId()).isEqualTo(joiner.getId());
        assertThat(onlyClickOf(link).getClaimedAt()).isNotNull();

        claim(latecomer).andExpect(status().isOk());
        assertThat(onlyClickOf(link).getClaimedUserId()).isEqualTo(joiner.getId());
    }

    @Test
    @DisplayName("초대자 본인의 claim 은 무시된다 — 셀프 초대 방지")
    void selfClaimIsIgnored() throws Exception {
        matchedClick();

        claim(inviter).andExpect(status().isOk());

        assertThat(onlyClickOf(link).getClaimedUserId()).isNull();
    }

    @Test
    @DisplayName("붙일 클릭이 없어도 200 — 링크 직행(UL) 유저는 클릭 행이 없다")
    void claimWithoutClickIsNoop() throws Exception {
        claim(newUser("직행유저")).andExpect(status().isOk());

        assertThat(clickRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("없는 slug 는 404 SLUG_NOT_FOUND")
    void unknownSlugIsNotFound() throws Exception {
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(newUser("가입자")))
                        .content("{\"slug\":\"zzzzzzzz\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SLUG_NOT_FOUND"));
    }

    @Test
    @DisplayName("토큰 없이는 claim 할 수 없다 — 401")
    void requiresAuthentication() throws Exception {
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"" + link.getSlug() + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    /** 랜딩 클릭 → 매치까지 진행된 상태(= claim 대상이 존재하는 상태)를 만든다. */
    private void matchedClick() throws Exception {
        hitLanding(link.getSlug(), CLICK_IP);
        mockMvc.perform(post("/l/match")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("CF-Connecting-IP", CLICK_IP)
                        .content("{\"os\":\"ios\",\"deviceId\":\"d1\",\"appInstanceId\":\"a1\"}"))
                .andExpect(jsonPath("$.matched").value(true));
    }

    private ResultActions claim(User user) throws Exception {
        return mockMvc.perform(post("/api/v1/invite-links/claim")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(user))
                .content("{\"slug\":\"" + link.getSlug() + "\"}"));
    }
}
