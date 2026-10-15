package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.common.port.InviteAttribution;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
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
import static org.mockito.BDDMockito.given;

/**
 * 포트 어댑터의 <b>필드 대응</b>을 못박는다 (GROMO-1656).
 *
 * <p><b>왜 이 테스트가 필요한가.</b> 어댑터가 하는 일은 엔티티 3필드를 레코드 3필드로 옮기는 것뿐인데,
 * {@code groupId} 와 {@code inviterId} 가 <b>둘 다 {@code UUID}</b> 다. 둘을 뒤바꿔 써도 컴파일이
 * 통과하고, 호출부인 {@code GroupServiceTest} 는 포트를 목으로 세우므로 <b>거기서도 전부 초록</b>이다.
 *
 * <p>뒤바뀌면 참여 어트리뷰션이 조용히 무너진다 — 참여 그룹과 대조하는 값이 초대자 id 가 되어
 * 정상 초대가 전부 "다른 그룹 링크"로 탈락하고, 셀프 초대 판정은 그룹 id 와 유저 id 를 비교하게 된다.
 * 로그에 slug 가 안 남을 뿐 요청은 성공하므로 운영에서도 드러나지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class InviteAttributionAdapterTest {

    private static final String SLUG = "ABCD1234";
    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID INVITER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000b2");

    @Mock
    private GroupInviteLinkRepository groupInviteLinkRepository;

    @InjectMocks
    private InviteAttributionAdapter inviteAttributionAdapter;

    @Test
    @DisplayName("slug 조회 결과의 groupId·inviterId 가 자리를 지킨다 — 뒤바뀌면 어트리뷰션이 통째로 탈락한다")
    void mapsEntityFieldsToTheirOwnSlots() {
        given(groupInviteLinkRepository.findBySlug(SLUG))
                .willReturn(Optional.of(new GroupInviteLink(SLUG, GROUP_ID, INVITER_ID)));

        Optional<InviteAttribution> found = inviteAttributionAdapter.findBySlug(SLUG);

        assertThat(found).contains(new InviteAttribution(SLUG, GROUP_ID, INVITER_ID));
    }

    @Test
    @DisplayName("없는 slug 는 빈 값 — 호출부가 참여를 막지 않고 어트리뷰션만 버릴 수 있어야 한다")
    void missingSlugYieldsEmpty() {
        given(groupInviteLinkRepository.findBySlug(SLUG)).willReturn(Optional.empty());

        assertThat(inviteAttributionAdapter.findBySlug(SLUG)).isEmpty();
    }
}
