package com.oneorthree.phone.invitelink;

import com.oneorthree.phone.auth.service.JwtProvider;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 초대 링크 통합 테스트 공통 기반 — 픽스처 생성·정리와 HTTP 헬퍼.
 *
 * <p>{@link IntegrationTestBase} 는 {@code @Transactional} 이 아니다(매치 소진처럼 커밋을 전제한
 * 시나리오가 있어서다). 그래서 테스트가 만든 행은 롤백되지 않고, 정리를 빠뜨리면 그대로 다음
 * 테스트의 오염이 된다 — 생성 헬퍼가 만든 것을 추적해 FK 역순으로 지우는 책임을 여기 모은다.
 */
@AutoConfigureMockMvc
public abstract class InviteLinkTestSupport extends IntegrationTestBase {

    protected static final String IPHONE_UA =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
    protected static final String KAKAO_SCRAPER_UA = "facebookexternalhit/1.1; kakaotalk-scrap/1.0;";
    protected static final String CLICK_IP = "1.2.3.4";

    @Autowired
    protected MockMvc mockMvc;
    @Autowired
    protected JwtProvider jwtProvider;
    @Autowired
    protected UserRepository userRepository;
    @Autowired
    protected GroupRepository groupRepository;
    @Autowired
    protected GroupMemberRepository groupMemberRepository;
    @Autowired
    protected GroupInviteLinkRepository inviteLinkRepository;
    @Autowired
    protected InviteLinkClickRepository clickRepository;

    private final List<User> users = new ArrayList<>();
    private final List<Group> groups = new ArrayList<>();
    private final List<GroupMember> members = new ArrayList<>();

    @AfterEach
    void cleanUpInviteFixtures() {
        clickRepository.deleteAll(clickRepository.findAll());
        inviteLinkRepository.deleteAll(inviteLinkRepository.findAll());
        groupMemberRepository.deleteAll(members);
        groupRepository.deleteAll(groups);
        userRepository.deleteAll(users);
        members.clear();
        groups.clear();
        users.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    protected Group newGroup(String name) {
        return saveGroup(Group.builder().name(name).build());
    }

    /** 소프트 삭제된 그룹 — 링크는 살아 있는데 참여할 방이 사라진 상황을 만든다. */
    protected Group newDeletedGroup(String name) {
        return saveGroup(Group.builder().name(name).deletedAt(Instant.now()).build());
    }

    private Group saveGroup(Group group) {
        Group saved = groupRepository.save(group);
        groups.add(saved);
        return saved;
    }

    /** 닉네임에 UUID 를 붙인다 — 유니크 제약이 있는 컬럼이라 테스트끼리 부딪히지 않게. */
    protected User newUser(String nickname) {
        User user = userRepository.save(
                User.builder().nickname(nickname + UUID.randomUUID()).isGuest(false).build());
        users.add(user);
        return user;
    }

    protected GroupMember joinGroup(User user, Group group) {
        GroupMember member = groupMemberRepository.save(
                GroupMember.builder().user(user).group(group).build());
        members.add(member);
        return member;
    }

    protected GroupInviteLink newLink(String slug, Group group, User inviter) {
        return inviteLinkRepository.save(new GroupInviteLink(slug, group.getId(), inviter.getId()));
    }

    // ── HTTP 헬퍼 ────────────────────────────────────────────────────────

    protected String bearer(User user) {
        return "Bearer " + jwtProvider.generateAccessToken(user.getId());
    }

    /** 실제 유입과 같은 경로로 클릭 1건을 만든다(랜딩 GET). */
    protected ResultActions hitLanding(String slug, String ip) throws Exception {
        return mockMvc.perform(get("/l/{slug}", slug)
                        .header("User-Agent", IPHONE_UA)
                        .header("CF-Connecting-IP", ip))
                .andExpect(status().isOk());
    }

    protected InviteLinkClick onlyClickOf(GroupInviteLink link) {
        List<InviteLinkClick> clicks = clickRepository.findByLinkId(link.getId());
        assertThat(clicks).hasSize(1);
        return clicks.get(0);
    }
}
