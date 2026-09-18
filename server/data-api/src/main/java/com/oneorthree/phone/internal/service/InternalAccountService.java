package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.repository.domain.AuthSession;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.internal.dto.AccountMeView;
import com.oneorthree.phone.internal.dto.AccountPatchRequest;
import com.oneorthree.phone.internal.dto.AccountProfileView;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserService;
import com.oneorthree.phone.user.support.OnboardingCompletion;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 공개 {@code GET|PATCH|DELETE /me} 의 Data 쪽 (GROMO-1801 · 계정 LLD §2.2·§2.3·§2.5).
 *
 * <p>인가 순서는 LLD §1 그대로다 — 사용자 활성(비활성 404 {@code USER_NOT_FOUND}) → 세션·세대(폐기 403
 * {@code SESSION_NOT_ACTIVE}, Business 가 401 로 옮긴다). 탈퇴처럼 둘 다 참이면 404 가 먼저다.
 * 서명·타입·만료는 Business 가 이미 검증했고 sid/gen 은 그 서명된 AT 에서만 온다.
 *
 * <p>catColor 는 Q03 미결이라 컬럼이 없다 — 응답은 항상 null 이고 백필하지 않는다.
 */
@Service
@RequiredArgsConstructor
public class InternalAccountService {

    /** 공개 명령 receipt 의 작업 범위 — method + 공개 경로 + 주체. */
    private static final String OPERATION_PATCH = "PATCH:/me:";

    private final UserQueryService users;
    private final UserService userService;
    private final AuthSessionService sessions;
    private final PublicCommandService publicCommands;
    private final AccountWithdrawalService withdrawal;

    /** 활성 계정 projection 한 번. users 를 읽기만 하므로 공유 락이다. */
    @Transactional
    public AccountMeView me(UUID userId, UUID sessionId, long authGeneration) {
        User user = requireSession(users.getCallerForShare(userId), sessionId, authGeneration);
        return new AccountMeView(user.getId(), user.getNickname(), null,
                userService.linkedProviderNames(user), OnboardingCompletion.isComplete(user));
    }

    /**
     * 이름 변경. 같은 키·같은 본문은 최초 결과를 재생하고 다른 본문은 409 다({@link PublicCommandService}).
     * 재생도 현재 세션을 다시 검사한다 — 로그아웃·탈퇴 뒤에는 receipt 가 있어도 개인 응답을 돌려주지 않는다.
     *
     * <p>ponytail: {@code user.onboarded} 전이 사건은 내지 않는다. Q04 판정이 미결이고 소비자 계약도 없다 —
     * 판정 확정 때 변경 전·후 {@code OnboardingCompletion} 비교를 이 command 안에 넣는다.
     */
    @Transactional
    public AccountProfileView patch(UUID userId, AccountPatchRequest request, UUID sessionId, long authGeneration,
                                    UUID idempotencyKey) {
        var command = new PublicCommandRequest(userId, OPERATION_PATCH + userId, idempotencyKey,
                tree(Map.of("name", request.name())));
        var receipt = publicCommands.run(command,
                () -> requireSession(users.getCallerForUpdate(userId), sessionId, authGeneration),
                // 재생 전 활성·세션 재검사는 위 활성 검사가 이미 한다. receipt 는 본인 결과뿐이라 더 볼 권한이 없다.
                ignored -> { },
                () -> {
                    User user = userService.renameForPublicProfile(userId, request.name());
                    AccountProfileView view = new AccountProfileView(user.getId(), user.getNickname(), null);
                    return new PublicCommandResult(200, tree(view), tree(List.of()));
                }).value();
        try {
            return OutboxEnvelopeCodec.fromJson(receipt.data().toString(), AccountProfileView.class);
        } catch (JsonProcessingException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }

    /**
     * 탈퇴 — 기존 {@link AccountWithdrawalService#withdraw} 단일 TX 에 그대로 합류한다. 방장이면 400
     * {@code HOST_WITHDRAW} 로 전체 롤백된다. 같은 명령의 재시도는 이미 비활성이라 404 이고, 앱은 그것을
     * 탈퇴 확정으로 읽는다(LLD §2.5) — 그래서 receipt 를 두지 않는다.
     */
    @Transactional
    public void withdraw(UUID userId, UUID sessionId, long authGeneration) {
        requireSession(users.getCallerForUpdate(userId), sessionId, authGeneration);
        withdrawal.withdraw(userId);
    }

    private User requireSession(User user, UUID sessionId, long authGeneration) {
        if (authGeneration != user.getAuthGeneration()
                || sessions.verifySession(user.getId(), sessionId).filter(AuthSession::isActive).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
        return user;
    }

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("계정 명령 직렬화 실패", e);
        }
    }
}
