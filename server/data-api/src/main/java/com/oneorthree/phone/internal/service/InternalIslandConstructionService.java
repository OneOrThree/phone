package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.construction.dto.ConstructionOptionsView;
import com.oneorthree.phone.construction.dto.ConstructionStartedView;
import com.oneorthree.phone.construction.dto.ConstructionTargetView;
import com.oneorthree.phone.construction.service.IslandConstructionService;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

/**
 * 섬 건설 내부 표면의 세션 관문 (GROMO-2207).
 *
 * <p>Business 가 서명된 AT 에서 꺼낸 {@code sid}·{@code gen} 을 사용자 잠금 경계에서 재검사한 뒤 건설
 * 서비스에 넘긴다. Business 의 Redis 거부목록은 로그아웃 커밋 «뒤» 기록되고 장애 때 fail-open 이라 그 창을
 * 여기서 닫는다. 건설(L6)은 auth(L8)를 참조할 수 없어 검사를 이 조합 자리(L10)에 둔다.
 */
@Service
@RequiredArgsConstructor
public class InternalIslandConstructionService {

    private final IslandConstructionService construction;
    private final UserQueryService users;
    private final AuthSessionService sessions;
    private final PlatformTransactionManager transactionManager;

    /**
     * 건설 옵션 조회. 세션 검사는 행 잠금이 필요해 짧은 쓰기 TX 로 먼저 끝내고, 조회는 건설 서비스의 읽기
     * 전용 REPEATABLE READ TX 에서 따로 한다 — 읽기 전용 TX 는 행 잠금을 거절하고, 스냅샷 뒤 잠금은 직렬화
     * 실패가 날 수 있기 때문이다. 두 TX 사이에 로그아웃이 끼어도 조회라 상태는 바뀌지 않는다.
     */
    public ConstructionOptionsView options(UUID islandId, UUID userId, UUID sessionId, long authGeneration) {
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(status -> requireActive(userId, sessionId, authGeneration));
        return construction.options(islandId, userId);
    }

    /** 목표 선택. 세션 검사가 receipt 재생보다 먼저라 폐기된 세션은 성공 receipt 를 받지 못한다. */
    @Transactional
    public ConstructionTargetView setTarget(UUID islandId, UUID userId, UUID sessionId, long authGeneration,
                                            String buildingId, long expectedVersion, UUID idempotencyKey) {
        requireActive(userId, sessionId, authGeneration);
        return construction.setTarget(islandId, userId, buildingId, expectedVersion, idempotencyKey);
    }

    /** 건설 시작. 세션 검사가 receipt 재생·차감보다 먼저다. */
    @Transactional
    public ConstructionStartedView start(UUID islandId, UUID userId, UUID sessionId, long authGeneration,
                                         String buildingId, long expectedVersion, long expectedCostPolicyVersion,
                                         UUID idempotencyKey) {
        requireActive(userId, sessionId, authGeneration);
        return construction.start(islandId, userId, buildingId, expectedVersion, expectedCostPolicyVersion,
                idempotencyKey);
    }

    /** users 행을 잠그고(로그아웃과 같은 순서) 세션을 확인한다. 안쪽 건설 TX 의 같은 잠금은 재진입이다. */
    private void requireActive(UUID userId, UUID sessionId, long authGeneration) {
        sessions.requireActive(users.getCallerForUpdate(userId), sessionId, authGeneration);
    }
}
