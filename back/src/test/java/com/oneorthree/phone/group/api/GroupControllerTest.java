package com.oneorthree.phone.group.api;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupDetailResponse;
import com.oneorthree.phone.group.dto.GroupOverviewResponse;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 그룹 API 의 boolean 필드 JSON 키 계약 검증 (isPrivate · isMember).
 *
 * <p>boolean isXxx 는 Lombok getter(isPrivate()/isMember())를 Jackson 이 "is" 없이 매핑하므로,
 * {@code @JsonProperty} 로 고정한 키가 요청·응답 양방향에서 실제로 먹는지 확인한다.
 * 어긋나도 예외가 아니라 <b>조용한 오동작</b>이라 — 모든 방이 공개방이 되고, 링크 프리뷰의
 * '이미 멤버' 분기가 죽는다 — 와이어 레벨로 잠가둔다.
 *
 * <p>키가 <b>있는지</b>만이 아니라 축약 키(member·private)가 <b>없는지</b>도 함께 단정한다.
 * 한 값이 두 키로 나가면 엄격한 스키마 검증·생성형 클라이언트에서 미정의 필드로 실패하거나
 * 서로 다른 두 속성으로 모델링된다.
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
    @DisplayName("isPrivate 명시적 null → 400 (미전송과 구분한다)")
    void createGroupRejectsExplicitNullIsPrivate() throws Exception {
        mockMvc.perform(post("/api/v1/groups")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"스터디룸","maxMembers":5,"isPrivate":null,
                                 "missionType":"DURATION","missionCategory":"FOCUS","durationMinutes":60}
                                """)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                // primitive 기본 coercion 에 맡기면 null 이 조용히 false 가 돼, 비공개로 만들려던 방이
                // 검색 가능한 공개방으로 생성된다(201). 명시적 null 은 클라이언트 결함이므로 거절한다.
                .andExpect(status().isBadRequest());

        verify(groupService, never()).createGroup(any(), any());
    }

    @Test
    @DisplayName("overview 응답의 isMember 키가 고정된다 — member 로 새지 않는다")
    void getGroupOverviewExposesIsMemberKey() throws Exception {
        given(groupService.getGroupOverview(any(), any())).willReturn(GroupOverviewResponse.builder()
                .id(GROUP_ID)
                .name("스터디룸")
                .maxMembers(10)
                .memberCount(3)
                .hasPassword(true)
                .isMember(true)
                .build());

        mockMvc.perform(get("/api/v1/groups/{groupId}/overview", GROUP_ID)
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                // 애노테이션 없이는 이 키가 아예 없고 member 만 나갔다 — 앱의 ov.isMember 분기가 죽는다
                .andExpect(jsonPath("$.isMember").value(true))
                // getter 를 직접 선언해 프로퍼티를 하나로 접었다 — 필드 애노테이션 시절 함께 나가던
                // 축약 키가 사라졌는지 단정한다(회귀하면 한 값이 두 키로 다시 새어나간다)
                .andExpect(jsonPath("$.member").doesNotExist())
                // hasPassword 는 애노테이션 없이도 키가 유지되는지 함께 잠근다
                .andExpect(jsonPath("$.hasPassword").value(true))
                .andExpect(jsonPath("$.memberCount").value(3));
    }

    @Test
    @DisplayName("내 그룹 목록 응답에 isPrivate 키가 실린다 — private 로 새지 않는다")
    void getMyGroupsExposesIsPrivateKey() throws Exception {
        given(groupService.getMyGroups(any())).willReturn(List.of(new GroupSummaryResponse(
                GROUP_ID, "비밀방", "ABCD1234", 1, 5, GroupMemberRole.OWNER, GroupStatus.WAITING, true)));

        mockMvc.perform(get("/api/v1/groups")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].isPrivate").value(true))
                .andExpect(jsonPath("$[0].private").doesNotExist());
    }

    @Test
    @DisplayName("그룹 상세 응답에 isPrivate 키가 실린다 — private 로 새지 않는다")
    void getGroupDetailExposesIsPrivateKey() throws Exception {
        given(groupService.getGroupDetail(any(), any(), any())).willReturn(GroupDetailResponse.builder()
                .id(GROUP_ID)
                .name("비밀방")
                .maxMembers(10)
                .status(GroupStatus.WAITING)
                .isPrivate(true)
                .build());

        mockMvc.perform(get("/api/v1/groups/{groupId}", GROUP_ID)
                        .param("date", "2026-08-01")
                        .requestAttr(AuthAttributes.USER_ID, LOGIN_USER_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isPrivate").value(true))
                .andExpect(jsonPath("$.private").doesNotExist());
    }
}
