package com.oneorthree.phone.invitelink;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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

    @Autowired
    private PlatformTransactionManager transactionManager;

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
    @DisplayName("세대 교체 재발급은 한 번으로 수렴한다 — 늦게 온 쪽은 0행이고 먼저 쓴 슬러그가 남는다 (GROMO-1760)")
    void reissueConvergesToTheFirstWriter() throws Exception {
        String original = JsonPath.read(issue(group.getId(), inviter), "$.slug");
        UUID linkId = inviteLinkRepository.findBySlug(original).orElseThrow().getId();
        long nextEpoch = inviteLinkRepository.findById(linkId).orElseThrow().getIssuanceEpoch() + 1;

        // @Modifying 은 트랜잭션을 열지 않는다(규약 §4) — 서비스처럼 호출마다 짧은 트랜잭션으로 감싼다.
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        int first = tx.execute(status -> inviteLinkRepository.reissueIfStale(linkId, "aaaaaaaa", nextEpoch));
        int second = tx.execute(status -> inviteLinkRepository.reissueIfStale(linkId, "bbbbbbbb", nextEpoch));

        assertThat(first).isEqualTo(1);
        assertThat(second).as("같은 세대로 이미 교체됐으면 덮어쓰지 않는다").isZero();
        assertThat(inviteLinkRepository.findSlugById(linkId)).isEqualTo("aaaaaaaa");
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
    @DisplayName("종료(ENDED)된 그룹도 404 — 아무도 못 들어가는 방의 초대장을 찍어내지 않는다")
    void endedGroupIsNotFound() throws Exception {
        Group ended = newEndedGroup("끝난방");
        joinGroup(inviter, ended);

        mockMvc.perform(post("/api/v1/groups/{groupId}/invite-link", ended.getId())
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
