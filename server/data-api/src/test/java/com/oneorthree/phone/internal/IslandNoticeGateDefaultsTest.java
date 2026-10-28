package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.service.IslandNoticeService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 게시판의 <b>기본 시설 게이트</b> 검증 (GROMO-1771) — {@code construction.facility-gates.enforce} 를 건드리지
 * 않은 배포 그대로다. 시설 게이트가 꺼져 있어 게시판이 없는 섬도 읽힌다(적립 경로 배포 전 종전 동작 보존).
 * 쓰기 스위치({@code island-board.writes-enabled})는 2026-10-27(티켓 2535)에 걷었다.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandNoticeGateDefaultsTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandNoticeService notices;
    @Autowired
    GroupAnnouncementRepository announcements;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;

    @Test
    @DisplayName("조회는 열려 있고, 게이트 OFF 라 게시판이 없는 섬도 주민은 읽는다")
    void readsWorkWithoutBoardWhenGateIsOff() {
        UUID owner = user();
        UUID islandId = island(owner);
        announcements.save(GroupAnnouncement.builder().group(groups.findById(islandId).orElseThrow())
                .user(users.findById(owner).orElseThrow()).title("보존 공지").content("본문").build());

        IslandNoticeViews.Page page = notices.list(islandId, owner, null, null, 30);
        assertThat(page.items()).singleElement().satisfies(item -> {
            assertThat(item.title()).isEqualTo("보존 공지");
            assertThat(item.commentCount()).isZero();
        });
        IslandNoticeViews.Detail detail = notices.detail(islandId, page.items().get(0).id(), owner, null, null, 30);
        assertThat(detail.body()).isEqualTo("본문");
        assertThat(detail.version()).isZero();
        assertThat(detail.comments()).isEmpty();
    }

    private UUID user() {
        return users.save(User.builder().nickname("방장-" + UUID.randomUUID().toString().substring(0, 8)).build())
                .getId();
    }

    private UUID island(UUID owner) {
        Group island = groups.save(Group.builder().name("기본섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(users.findById(owner).orElseThrow()).group(island)
                .role(GroupMemberRole.OWNER).build());
        return island.getId();
    }
}
