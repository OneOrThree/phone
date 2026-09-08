package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 초대 링크 조회 계층 (GROMO-1655).
 *
 * <p>여기서 지킬 계약은 <b>던지지 않는다</b>는 것 하나다. 링크를 못 찾았을 때 던지면 매칭 배치가
 * 그 클릭 하나에 죽고, 정책은 반대다 — 클릭을 소진하지 않고 빠져나가 다음 기회를 남긴다.
 * 슬러그 조회({@code findBySlug})는 id 조회가 아니라 계층 밖이라는 것도 함께 못박는다.
 */
@ExtendWith(MockitoExtension.class)
class InviteLinkQueryServiceTest {

    private static final UUID LINK_ID = UUID.randomUUID();

    @Mock
    private GroupInviteLinkRepository groupInviteLinkRepository;

    @InjectMocks
    private InviteLinkQueryService inviteLinkQueryService;

    @Mock
    private GroupInviteLink link;

    @Test
    @DisplayName("링크가 없어도 던지지 않는다 — 던지면 매칭 배치가 클릭 하나에 죽는다")
    void findInviteLinkDoesNotThrowWhenAbsent() {
        given(groupInviteLinkRepository.findById(LINK_ID)).willReturn(Optional.empty());

        assertThatCode(() -> inviteLinkQueryService.findInviteLink(LINK_ID)).doesNotThrowAnyException();
        assertThat(inviteLinkQueryService.findInviteLink(LINK_ID)).isEmpty();
    }

    @Test
    @DisplayName("링크가 있으면 담아 준다 — id 조회를 쓰고 슬러그 조회로 새지 않는다")
    void findInviteLinkReturnsLinkAndUsesIdLookup() {
        given(groupInviteLinkRepository.findById(LINK_ID)).willReturn(Optional.of(link));

        assertThat(inviteLinkQueryService.findInviteLink(LINK_ID)).contains(link);
        verify(groupInviteLinkRepository).findById(LINK_ID);
        verify(groupInviteLinkRepository, never()).findBySlug(any());
    }
}
