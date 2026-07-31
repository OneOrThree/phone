package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupSummaryResponse;
import com.oneorthree.phone.group.service.GroupAnnouncementService;
import com.oneorthree.phone.group.service.GroupChallengeService;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 그룹 공개/비공개(isPrivate)의 JSON 키 계약 검증.
 *
 * <p>boolean isXxx 는 Lombok getter(isPrivate())를 Jackson 이 "is" 없이 매핑하므로,
 * @JsonProperty("isPrivate") 로 고정한 키가 요청·응답 양방향에서 실제로 먹는지 확인한다
 * (앱이 보내는/읽는 키가 isPrivate 이라 어긋나면 조용히 공개방이 된다).
 */
@WebMvcTest(controllers = GroupController.class)
class GroupControllerTest {

    private static final UUID LOGIN_USER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000ca");
    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GroupService groupService;

    @MockitoBean
    private GroupAnnouncementService groupAnnouncementService;

    @MockitoBean
    private GroupChallengeService groupChallengeService;

    @MockitoBean
    private GroupMemberService groupMemberService;

    @Test
    @DisplayName("그룹 생성 요청의 isPrivate 키가 서비스까지 그대로 전달된다")
    void createGroupBindsIsPrivate() throws Exception {
        given(groupService.createGroup(any(), any())).willReturn(new CreateGroupResponse(GROUP_ID, "ABCD1234"));

        mockMvc.perform(post("/api/v1/groups")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"스터디룸","maxMembers":5,"isPrivate":true,
                                 "missionType":"DURATION","missionCategory":"FOCUS","durationMinutes":60}
                                """)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated());

        ArgumentCaptor<CreateGroupRequest> captor = ArgumentCaptor.forClass(CreateGroupRequest.class);
        verify(groupService).createGroup(any(), captor.capture());
        assertThat(captor.getValue().isPrivate()).isTrue();
    }

    @Test
    @DisplayName("isPrivate 미전송 → false(공개)로 바인딩된다")
    void createGroupDefaultsIsPrivateToFalse() throws Exception {
        given(groupService.createGroup(any(), any())).willReturn(new CreateGroupResponse(GROUP_ID, "ABCD1234"));

        mockMvc.perform(post("/api/v1/groups")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"스터디룸","maxMembers":5,
                                 "missionType":"DURATION","missionCategory":"FOCUS","durationMinutes":60}
                                """)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isCreated());

        ArgumentCaptor<CreateGroupRequest> captor = ArgumentCaptor.forClass(CreateGroupRequest.class);
        verify(groupService).createGroup(any(), captor.capture());
        assertThat(captor.getValue().isPrivate()).isFalse();
    }

    @Test
    @DisplayName("내 그룹 목록 응답에 isPrivate 키가 실린다")
    void getMyGroupsExposesIsPrivateKey() throws Exception {
        given(groupService.getMyGroups(any())).willReturn(List.of(new GroupSummaryResponse(
                GROUP_ID, "비밀방", "ABCD1234", 1, 5, GroupMemberRole.OWNER, GroupStatus.WAITING, true)));

        mockMvc.perform(get("/api/v1/groups")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].isPrivate").value(true));
    }
}
