package com.oneorthree.phone.invitelink;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.user.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 링크 발급 API 통합 테스트 (계약 ① {@code POST /api/v1/groups/{groupId}/invite-link}).
 *
 * <p>여기서 잠그는 건 셋이다 — <b>멱등</b>(같은 사람이 같은 방을 몇 번 공유해도 링크는 하나여야
 * 어트리뷰션이 한 줄기로 모인다), <b>권한</b>(비멤버가 남의 방 초대장을 찍어낼 수 없다),
 * 그리고 <b>URL 형식</b>(앱·랜딩·AASA 가 전부 이 형식을 전제로 동작한다).
 */
class InviteLinkIssueTest extends InviteLinkTestSupport {

    private Group group;
    private User inviter;

    @BeforeEach
    void setUp() {
        group = newGroup("스터디");
        inviter = newUser("초대자");
        joinGroup(inviter, group);
    }

    @Test
    @DisplayName("발급은 멱등이다 — 같은 그룹·같은 유저는 항상 같은 slug 와 URL")
    void issueIsIdempotent() throws Exception {
        String first = issue(group.getId(), inviter);
        String second = issue(group.getId(), inviter);

        String slug = JsonPath.read(first, "$.slug");
        assertThat(JsonPath.<String>read(second, "$.slug")).isEqualTo(slug);
        assertThat(JsonPath.<String>read(first, "$.url"))
                .isEqualTo("https://link.test/l/" + slug + "?g=" + group.getId());
        assertThat(inviteLinkRepository.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("초대자가 다르면 링크도 다르다 — '누가 데려왔나'가 slug 단위로 갈린다")
    void differentInviterGetsDifferentSlug() throws Exception {
        User another = newUser("다른멤버");
        joinGroup(another, group);

        assertThat(JsonPath.<String>read(issue(group.getId(), inviter), "$.slug"))
                .isNotEqualTo(JsonPath.<String>read(issue(group.getId(), another), "$.slug"));
    }

    @Test
    @DisplayName("비멤버의 발급은 403 NOT_MEMBER")
    void nonMemberIsForbidden() throws Exception {
        User outsider = newUser("외부인");

        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", group.getId())
                        .header("Authorization", bearer(outsider)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));

        assertThat(inviteLinkRepository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("없는 그룹은 404 GROUP_NOT_FOUND")
    void unknownGroupIsNotFound() throws Exception {
        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", UUID.randomUUID())
                        .header("Authorization", bearer(inviter)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    @DisplayName("삭제된 그룹도 404 — 랜딩의 만료 판정과 기준을 맞춘다")
    void deletedGroupIsNotFound() throws Exception {
        Group deleted = newDeletedGroup("사라진방");
        joinGroup(inviter, deleted);

        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", deleted.getId())
                        .header("Authorization", bearer(inviter)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
    }

    @Test
    @DisplayName("토큰 없이는 발급할 수 없다 — 401")
    void requiresAuthentication() throws Exception {
        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", group.getId()))
                .andExpect(status().isUnauthorized());
    }

    private String issue(UUID groupId, User user) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", groupId)
                        .header("Authorization", bearer(user)))
                .andExpect(status().isOk())
                .andReturn();
        return result.getResponse().getContentAsString();
    }
}
