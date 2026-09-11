package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.internal.dto.RealtimeMembershipAuthorizationRequest;
import com.oneorthree.phone.internal.repository.RealtimeMembershipAuthorizationQuery;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** 멤버십 조건을 한 SQL snapshot에서 읽는다. 원격 전송이나 상태 변경을 이 TX에 넣지 않는다. */
@Service
@RequiredArgsConstructor
public class InternalRealtimeMembershipAuthorizationService {
    private final RealtimeMembershipAuthorizationQuery query;

    /**
     * 이전 RR TX의 낡은 snapshot에 합류하지 않는다. 현재 Data의 단일 primary datasource를 사용한다.
     * AT 서명/exp와 실제 프레임 직전 검사는 caller의 책임이며 이 응답은 TTL 자격이 아니다.
     */
    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW, isolation = Isolation.READ_COMMITTED)
    public boolean isAllowed(UUID userId, RealtimeMembershipAuthorizationRequest request) {
        if (userId == null || request == null) {
            throw new IllegalArgumentException("검증된 사용자와 인가 요청이 필요합니다.");
        }
        return query.isAllowed(userId, request.sessionId(), request.authGeneration(), request.islandId());
    }
}
