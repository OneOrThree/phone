package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.UserIslandContextRepository;
import com.oneorthree.phone.group.repository.domain.UserIslandContext;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 현재 섬 컨텍스트의 직렬화 경계 (GROMO-1907, island-membership LLD §4).
 *
 * <p>섬 생성·가입·현재 섬 이동·집중 세션 시작이 같은 사용자 축을 동시에 건드릴 때 공유하는 잠금이다.
 * <b>호출측이 이미 users 행을 배타 락({@code UserQueryService#getCallerForUpdate})으로 쥔 뒤에만</b>
 * 불러야 한다 — {@link #lock} 파라미터 타입이 {@link User} 인 것 자체가 그 전제를 문서화한다.
 *
 * <p>users 행 배타 락이 이미 「컨텍스트 첫 생성」 경합까지 막아 주므로(같은 유저의 두 트랜잭션은
 * users 행에서부터 직렬화된다), 이 서비스는 {@code AggregateVersionAllocator} 류의
 * insert-then-relock 이 필요 없다 — 단순 조회 후 없으면 생성이면 충분하다.
 *
 * <p><b>현재 호출부가 없다.</b> GROMO-1907 은 저장소·잠금 경계만 만드는 티켓이라 {@code createGroup}
 * 의 현재 섬 이동 배선은 되돌렸다 — 가드(진행 중 세션 409, LLD §3.1)와 정리(마지막 이탈 시 컨텍스트
 * 해제, LLD §3.6)가 없는 채로 이동만 먼저 들어가면 방치 시 사고가 난다. 이동은 그 가드·정리와 함께
 * GROMO-1759 에서 배선한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class UserIslandContextLockService {

    private final UserIslandContextRepository userIslandContextRepository;

    /**
     * 현재 섬 컨텍스트를 잠그고 읽는다. 첫 소속이면 새로 만든다.
     *
     * @param lockedUser users 행을 배타 락으로 이미 쥔 요청자
     * @return 잠긴 컨텍스트 행 — 없었으면 currentIslandId=null 인 새 행
     */
    public UserIslandContext lock(User lockedUser) {
        return userIslandContextRepository.findByIdForUpdate(lockedUser.getId())
                .orElseGet(() -> userIslandContextRepository.save(UserIslandContext.newFor(lockedUser.getId())));
    }
}
