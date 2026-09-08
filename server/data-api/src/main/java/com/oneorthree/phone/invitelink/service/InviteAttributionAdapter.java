package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.common.port.InviteAttribution;
import com.oneorthree.phone.common.port.InviteAttributionPort;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

/**
 * {@link InviteAttributionPort} 의 invitelink 쪽 구현 (GROMO-1656).
 *
 * <p>기존에 {@code GroupService} 가 {@code GroupInviteLinkRepository} 를 직접 주입해 하던 조회를
 * 그대로 옮겨 온 것이다 — 쿼리도 필터도 바뀌지 않았고, 대조(그룹 일치·셀프 초대 배제)는
 * 여전히 호출측인 참여 경로에 남는다. 이 어댑터는 "slug 로 링크를 찾는" 한 걸음만 맡는다.
 */
@Component
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InviteAttributionAdapter implements InviteAttributionPort {

    private final GroupInviteLinkRepository groupInviteLinkRepository;

    @Override
    public Optional<InviteAttribution> findBySlug(String slug) {
        return groupInviteLinkRepository.findBySlug(slug)
                .map(link -> new InviteAttribution(link.getSlug(), link.getGroupId(), link.getInviterId()));
    }
}
