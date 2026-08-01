package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.List;
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
@AutoConfigureMockMvc
class InviteLinkIssueTest extends IntegrationTestBase {

    @Autowired
    MockMvc mockMvc;
    @Autowired
    JwtProvider jwtProvider;
    @Autowired
    UserRepository userRepository;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupInviteLinkRepository groupInviteLinkRepository;

    private final List<User> users = new ArrayList<>();
    private final List<GroupMember> members = new ArrayList<>();

    private Group group;
    private User inviter;

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
        inviter = newUser("초대자");
        members.add(groupMemberRepository.save(GroupMember.builder().user(inviter).group(group).build()));
    }

    @AfterEach
    void tearDown() {
        // IntegrationTestBase 는 @Transactional 이 아니다 — 남은 행이 곧 다음 테스트의 오염이다.
        groupInviteLinkRepository.deleteAll(groupInviteLinkRepository.findAll());
        groupMemberRepository.deleteAll(members);
        groupRepository.delete(group);
        userRepository.deleteAll(users);
        members.clear();
        users.clear();
    }

    @Test
    @DisplayName("발급은 멱등이다 — 같은 그룹·같은 유저는 항상 같은 slug 와 URL")
    void issueIsIdempotent() throws Exception {
        String first = issue(group.getId(), inviter, 200);
        String second = issue(group.getId(), inviter, 200);

        String slug = readSlug(first);
        assertThat(readSlug(second)).isEqualTo(slug);
        assertThat(readUrl(first)).isEqualTo("https://link.test/l/" + slug + "?g=" + group.getId());
        assertThat(groupInviteLinkRepository.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("초대자가 다르면 링크도 다르다 — '누가 데려왔나'가 slug 단위로 갈린다")
    void differentInviterGetsDifferentSlug() throws Exception {
        User another = newUser("다른멤버");
        members.add(groupMemberRepository.save(GroupMember.builder().user(another).group(group).build()));

        assertThat(readSlug(issue(group.getId(), inviter, 200)))
                .isNotEqualTo(readSlug(issue(group.getId(), another, 200)));
    }

    @Test
    @DisplayName("비멤버의 발급은 403 NOT_MEMBER")
    void nonMemberIsForbidden() throws Exception {
        User outsider = newUser("외부인");

        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", group.getId())
                        .header("Authorization", bearer(outsider)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));

        assertThat(groupInviteLinkRepository.findAll()).isEmpty();
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
    @DisplayName("토큰 없이는 발급할 수 없다 — 401")
    void requiresAuthentication() throws Exception {
        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", group.getId()))
                .andExpect(status().isUnauthorized());
    }

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    private User newUser(String nickname) {
        User user = userRepository.save(
                User.builder().nickname(nickname + UUID.randomUUID()).isGuest(false).build());
        users.add(user);
        return user;
    }

    private String bearer(User user) {
        return "Bearer " + jwtProvider.generateAccessToken(user.getId());
    }

    private String issue(UUID groupId, User user, int expectedStatus) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", groupId)
                        .header("Authorization", bearer(user)))
                .andExpect(status().is(expectedStatus))
                .andReturn();
        return result.getResponse().getContentAsString();
    }

    private String readSlug(String body) {
        return com.jayway.jsonpath.JsonPath.read(body, "$.slug");
    }

    private String readUrl(String body) {
        return com.jayway.jsonpath.JsonPath.read(body, "$.url");
    }
}
