package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class GroupAnnouncementRepositoryTest extends RepositoryTestBase {

    @Autowired
    GroupAnnouncementRepository groupAnnouncementRepository;
    @Autowired
    GroupRepository groupRepository;

    @Test
    @DisplayName("공지 조회 → createdAt 내림차순(최신순)으로 반환된다")
    void findByGroupOrderByCreatedAtDesc_sortsByCreatedAtDesc() throws InterruptedException {
        // given: 같은 group 에 공지 3건을 '시간차를 두고' 저장
        //   - @CreationTimestamp 라 저장 순서대로 createdAt 이 증가 → 마지막 저장이 가장 최신
        //   - (시간 해상도 때문에 필요하면 저장 사이에 약간의 텀, 또는 createdAt 직접 세팅)
        // GROMO-674: groups 미션 컬럼 제거 — 미션 정보는 group_challenges 소유라 여기선 불필요
        Group group = Group.builder()
                .name("test")
                .build();
        groupRepository.save(group);

        GroupAnnouncement groupAnnouncement1 = GroupAnnouncement.builder()
                .group(group)
                .title("1")
                .content("1")
                .build();

        GroupAnnouncement groupAnnouncement2 = GroupAnnouncement.builder()
                .group(group)
                .title("2")
                .content("2")
                .build();

        groupAnnouncementRepository.save(groupAnnouncement1);
        Thread.sleep(4);
        groupAnnouncementRepository.save(groupAnnouncement2);
        groupAnnouncementRepository.flush();

        // when: groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group)j
        List<GroupAnnouncement> groupAnnouncements = groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group);

        // then: 최신(2)이 먼저, 오래된(1)이 나중 (createdAt 내림차순)
        assertThat(groupAnnouncements)
                .extracting(GroupAnnouncement::getTitle)
                .containsExactly("2", "1");
        assertThat(groupAnnouncements.get(0).getCreatedAt())
                .isAfter(groupAnnouncements.get(1).getCreatedAt());
    }
}
