package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupMember;
import com.oneorthree.phone.domain.group.GroupMemberRole;
import com.oneorthree.phone.domain.group.MissionCategory;
import com.oneorthree.phone.domain.group.MissionType;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.GroupException;
import com.oneorthree.phone.repository.group.GroupMemberRepository;
import com.oneorthree.phone.repository.group.GroupRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.group.CreateGroupRequest;
import com.oneorthree.phone.service.dto.group.CreateGroupResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class GroupServiceTest {

    @InjectMocks
    private GroupService groupService;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    private static final Long USER_ID = 1L;

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    private CreateGroupRequest durationRequest(String password, Integer maxMembers, Integer durationMinutes) {
        return new CreateGroupRequest("스터디룸", password, "설명", maxMembers,
                MissionType.DURATION, MissionCategory.FOCUS, durationMinutes, null, null);
    }

    private CreateGroupRequest timeWindowRequest(Instant windowStart, Instant windowEnd) {
        return new CreateGroupRequest("스터디룸", null, "설명", 5,
                MissionType.TIME_WINDOW, MissionCategory.FOCUS, null, windowStart, windowEnd);
    }

    private User normalUser() {
        return User.builder().isGuest(false).build();
    }

    /** save()가 id가 채워진 엔티티를 반환하도록 흉내낸다 (서비스가 group.getId()를 사용). */
    private void givenSaveReturnsGroupWithId(long id) {
        given(groupRepository.save(any(Group.class)))
                .willReturn(Group.builder().id(id).build());
    }

    // ── 정상 생성 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("정상 생성 → 그룹 저장 + OWNER 멤버 저장 + 8자 코드 반환")
    void createGroupSuccess() {
        // given
        CreateGroupRequest request = durationRequest("1234", null, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(false);
        given(passwordEncoder.encode("1234")).willReturn("hashed-pw");
        givenSaveReturnsGroupWithId(10L);

        // when
        CreateGroupResponse response = groupService.createGroup(USER_ID, request);

        // then
        assertThat(response.groupId()).isEqualTo(10L);
        assertThat(response.code()).hasSize(8);

        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        Group savedGroup = groupCaptor.getValue();
        assertThat(savedGroup.getHostId()).isEqualTo(USER_ID);
        assertThat(savedGroup.getPassword()).isEqualTo("hashed-pw");
        assertThat(savedGroup.getCodeExpiresAt()).isAfter(Instant.now());

        ArgumentCaptor<GroupMember> memberCaptor = ArgumentCaptor.forClass(GroupMember.class);
        verify(groupMemberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(GroupMemberRole.OWNER);
    }

    @Test
    @DisplayName("maxMembers 미지정 → 기본값 10으로 저장")
    void createGroupDefaultsMaxMembers() {
        // given
        CreateGroupRequest request = durationRequest(null, null, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(1L);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        ArgumentCaptor<Group> captor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(captor.capture());
        assertThat(captor.getValue().getMaxMembers()).isEqualTo(10);
    }

    @Test
    @DisplayName("비밀번호 없으면 BCrypt 인코딩을 호출하지 않고 password=null로 저장")
    void createGroupWithoutPassword() {
        // given
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(1L);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(passwordEncoder, never()).encode(anyString());
        ArgumentCaptor<Group> captor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(captor.capture());
        assertThat(captor.getValue().getPassword()).isNull();
    }

    // ── 게스트 / 유저 검증 ────────────────────────────────────────────────

    @Test
    @DisplayName("게스트 계정 → GUEST_FORBIDDEN, 그룹 저장 안 함")
    void createGroupRejectsGuest() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 60)))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("존재하지 않는 유저 → GroupException")
    void createGroupUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 60)))
                .isInstanceOf(GroupException.class);
    }

    // ── 미션 파라미터 검증 ────────────────────────────────────────────────

    @Test
    @DisplayName("DURATION인데 durationMinutes 없음 → INVALID_MISSION_PARAMS")
    void createGroupDurationMissingMinutes() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, null)))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("TIME_WINDOW인데 windowStart/End 없음 → INVALID_MISSION_PARAMS")
    void createGroupTimeWindowMissingRange() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, timeWindowRequest(Instant.now(), null)))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, never()).save(any());
    }

    // ── 참가 코드 생성 ────────────────────────────────────────────────────

    @Test
    @DisplayName("코드 충돌 시 재시도 후 성공")
    void createGroupRetriesOnCodeCollision() {
        // given: 첫 코드는 충돌(이미 존재), 두 번째는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(true, false);
        given(groupRepository.findByCode(anyString())).willReturn(Optional.empty());
        givenSaveReturnsGroupWithId(1L);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(groupRepository, times(2)).existsByCode(anyString());
        verify(groupRepository).save(any(Group.class));
    }

    @Test
    @DisplayName("10회 모두 충돌 → CODE_GENERATION_FAILED, 저장 안 함")
    void createGroupFailsAfterMaxRetries() {
        // given: 항상 충돌
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.existsByCode(anyString())).willReturn(true);
        given(groupRepository.findByCode(anyString())).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, request))
                .isInstanceOf(GroupException.class);
        verify(groupRepository, times(10)).existsByCode(anyString());
        verify(groupRepository, never()).save(any());
    }
}
