package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.dto.LandingView;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.support.InviteLinkGa4Events;
import com.oneorthree.phone.invitelink.support.InviteLinkUrls;
import com.oneorthree.phone.invitelink.support.SlugGenerator;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * 랜딩 판정 단위 테스트 — DB 장애처럼 통합 테스트로 만들 수 없는 상황을 잠근다.
 *
 * <p>랜딩은 <b>무슨 일이 있어도 200 HTML</b> 이라는 계약이 있다({@code LinkPublicController}).
 * 초대자 닉네임은 있으면 좋은 부가 정보인데, 그 조회가 예외를 흘리면 유효한 초대가 통째로 5xx 로 죽는다.
 */
@ExtendWith(MockitoExtension.class)
class InviteLinkServiceTest {

    private static final String SLUG = "ab23cd45";

    @Mock
    private GroupInviteLinkRepository inviteLinkRepository;
    @Mock
    private GroupRepository groupRepository;
    @Mock
    private GroupMemberRepository groupMemberRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private SlugGenerator slugGenerator;
    @Mock
    private InviteLinkUrls inviteLinkUrls;
    @Mock
    private InviteLinkGa4Events ga4Events;
    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    private InviteLinkService inviteLinkService;

    private final UUID groupId = UUID.randomUUID();
    private final UUID inviterId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        inviteLinkService = new InviteLinkService(inviteLinkRepository, groupRepository,
                groupMemberRepository, userRepository, slugGenerator, inviteLinkUrls,
                ga4Events, userActivityEventLogger);
    }

    @Test
    @DisplayName("초대자 조회가 터져도 랜딩은 산다 — 부가 정보가 초대를 죽이면 안 된다")
    void inviterLookupFailureDoesNotBreakLanding() {
        given(inviteLinkRepository.findBySlug(SLUG))
                .willReturn(Optional.of(new GroupInviteLink(SLUG, groupId, inviterId)));
        given(groupRepository.findById(groupId))
                .willReturn(Optional.of(Group.builder().name("스터디").build()));
        given(userRepository.findByIdAndIsDeletedFalse(inviterId))
                .willThrow(new DataAccessResourceFailureException("users 조회 실패"));

        LandingView view = inviteLinkService.resolveLanding(SLUG);

        assertThat(view.isExpired()).isFalse();
        assertThat(view.groupName()).isEqualTo("스터디");
        // 초대자만 비고 초대 자체는 그대로 열린다
        assertThat(view.inviterName()).isNull();
    }
}
