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
 * 자리인데, 그 FK({@code invite_link_clicks.link_id})가 보장하므로 부재는 도달하지 않는 경로다.
 * 그래도 던지지 않는 이유는 두 호출부의 정책이 각각 그것을 요구하기 때문이다 — 최초 매치는
 * <b>클릭을 소진하지 않고 빠져나가 다음 기회를 남기고</b>, 재생(멱등 경로)은 <b>같은 요청에 같은
 * 결과</b>를 준다. 던지면 각각 어트리뷰션 1건이 유실되고 재시도 계약이 500 으로 깨진다.
 *
 * <p>슬러그 조회({@code findBySlug})는 id 조회가 아니라 §3 「옮기지 않는 것」이다.
 *
 * <p>호출부 둘이 <b>같은 클래스</b>({@code InviteLinkMatchService})라 여러 service 간 갈림은 없다.
 * 계층에 둔 것은 §3·GROMO-1655 의 "조회 계층 밖 id 조회 0건" 목표 때문이다.
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
