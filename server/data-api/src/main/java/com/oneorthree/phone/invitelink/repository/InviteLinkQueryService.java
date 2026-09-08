package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/**
 * 초대 링크를 id 로 조회하는 경로를 접는다 (GROMO-1655). 규약은
 * {@code docs/conventions/backend-layering.md} §3.
 *
 * <p><b>던지는 판이 없다.</b> 이 도메인의 id 조회는 둘 다 클릭 기록이 가리키는 링크를 되짚는
 * 자리인데, 그 FK 가 보장하므로 부재는 도달하지 않는 경로다. 그래도 던지지 않는 이유는 링크를
 * 못 찾았을 때 <b>클릭을 소진하지 않고 빠져나가 다음 기회를 남기는</b> 것이 정책이기 때문이다 —
 * 던지면 매칭 배치가 그 클릭 하나에 죽는다.
 *
 * <p>슬러그 조회({@code findBySlug})는 id 조회가 아니라 §3 「옮기지 않는 것」이다.
 *
 * <p><b>트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여한다.
 */
@Service
@RequiredArgsConstructor
public class InviteLinkQueryService {

    private final GroupInviteLinkRepository groupInviteLinkRepository;

    /**
     * 초대 링크 단건 — 락 없음, <b>부재가 정상</b>.
     *
     * @param linkId 조회 대상
     * @return 초대 링크. 없으면 빈 값
     */
    public Optional<GroupInviteLink> findInviteLink(UUID linkId) {
        return groupInviteLinkRepository.findById(linkId);
    }
}
