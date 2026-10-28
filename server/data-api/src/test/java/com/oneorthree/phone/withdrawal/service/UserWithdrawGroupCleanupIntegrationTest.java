package com.oneorthree.phone.withdrawal.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import static org.assertj.core.api.Assertions.tuple;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 탈퇴한 주민의 소속·개인정보 정리와 마지막 방장의 섬 종료를 검증한다. */
class UserWithdrawGroupCleanupIntegrationTest extends IntegrationTestBase {

    @Autowired
    AccountWithdrawalService accountWithdrawalService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    UserRepository userRepository;

    /** 테스트 사용자의 초기 개인정보 잔액. */
    private static final int INITIAL_BALANCE = 70;

    private Group group;

    private final List<User> users = new ArrayList<>();

    @BeforeEach
    void setUp() {
        group = groupRepository.save(Group.builder().name("스터디").build());
    }

    @AfterEach
    void tearDown() {
        // 탈퇴는 멤버십 행을 지우지 않고 is_left=true 로 마킹만 하므로, 활성 조회가 아니라
        // findAnyByUserAndGroup 으로 소프트삭제 행까지 지워야 유저 삭제가 FK 를 위반하지 않는다.
        users.forEach(u -> groupMemberRepository.findAnyByUserAndGroup(u, group)
                .ifPresent(groupMemberRepository::delete));
        userRepository.deleteAll(users);
        // Group 은 @Version 낙관락이 있어, withdraw 가 close() 로 버전을 올린 뒤에는 setUp 의
        // detached 인스턴스로 delete 하면 stale 로 터진다 — 재조회해서 지운다.
        groupRepository.findById(group.getId()).ifPresent(groupRepository::delete);

        users.clear();
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    /** 섬 멤버십과 개인정보을 가진 사용자. */
    private User memberUser(String nickname, GroupMemberRole role) {
        User user = userRepository.save(User.builder().nickname(nickname).isGuest(false).build());
        groupMemberRepository.save(GroupMember.builder().user(user).group(group).role(role).build());
        users.add(user);
        return user;
    }

    // ── 시나리오 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("그룹 무관 탈퇴 — 소프트딜리트·PII 파기·개인정보 삭제가 실제 DB 에 커밋된다 (GROMO-801 회귀 방지)")
    void bareWithdrawPersistsSoftDeleteAndPersonalDataRemoval() {
        // 소셜 연동 벌크 DELETE 의 clearAutomatically 가 미flush 변경을 버리면, 탈퇴가 성공한 것처럼
        // 보이는데 user 는 활성 그대로 남는다 — 목 단위 테스트로는 못 잡는 유실이라 실 DB 로 고정한다.
        User user = userRepository.save(User.builder().nickname("무소속").isGuest(false).build());
        users.add(user);

        accountWithdrawalService.withdraw(user.getId());

        User withdrawn = userRepository.findById(user.getId()).orElseThrow();
        assertThat(withdrawn.isDeleted()).isTrue();
        assertThat(withdrawn.getNickname()).isNull();
    }

    @Test
    void memberWithdrawalFreesSlotAndPreservesOtherMembers() {
        User owner = memberUser("방장", GroupMemberRole.OWNER);
        User leaver = memberUser("탈퇴자", GroupMemberRole.MEMBER);
        accountWithdrawalService.withdraw(leaver.getId());
        assertThat(groupMemberRepository.findAnyByUserAndGroup(leaver, group).orElseThrow().isLeft()).isTrue();
        assertThat(groupMemberRepository.findByGroup(group)).extracting(m -> m.getUser().getId())
                .containsExactly(owner.getId());
    }

    @Test
    void soloOwnerWithdrawalClosesIsland() {
        User owner = memberUser("나홀로방장", GroupMemberRole.OWNER);
        accountWithdrawalService.withdraw(owner.getId());
        assertThat(groupRepository.findById(group.getId()).orElseThrow().getStatus()).isEqualTo(GroupStatus.ENDED);
        assertThat(groupMemberRepository.findAnyByUserAndGroup(owner, group).orElseThrow().isLeft()).isTrue();
        assertThat(userRepository.findById(owner.getId()).orElseThrow().isDeleted()).isTrue();
    }
}
