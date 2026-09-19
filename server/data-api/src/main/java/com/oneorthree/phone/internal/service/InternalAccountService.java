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
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserService;
import com.oneorthree.phone.user.support.OnboardingCompletion;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 공개 {@code GET|PATCH|DELETE /me} 의 Data 쪽 (GROMO-1801 · 계정 LLD §2.2·§2.3·§2.5).
 *
 * <p>인가 순서는 LLD §1 그대로다 — 사용자 활성(비활성 404 {@code USER_NOT_FOUND}) → 세션·세대(폐기 403
 * {@code SESSION_NOT_ACTIVE}, Business 가 401 로 옮긴다). 탈퇴처럼 둘 다 참이면 404 가 먼저다.
 * 서명·타입·만료는 Business 가 이미 검증했고 sid/gen 은 그 서명된 AT 에서만 온다.
 *
 * <p>catColor 는 Q03 카탈로그(GROMO-1945) 값 또는 미선택 null 이다 — 기본색을 백필하지 않는다.
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

    /**
     * PATCH 스위치(계정 LLD §2.3). GROMO-1945 에서 온보딩 판정(Q03/Q04)과 {@code user.onboarded} producer 를 모든
     * 프로필 writer 에 연결해 기본 열림이다. 끄면 잠금·receipt 보다 앞서 503 이 되는 비상 스위치로 남는다.
     */
    @Value("${account.profile-update-enabled:true}")
    private boolean profileUpdateEnabled;

    /** 활성 계정 projection 한 번. users 를 읽기만 하므로 공유 락이다. */
    @Transactional
    public AccountMeView me(UUID userId, UUID sessionId, long authGeneration) {
        User user = requireSession(users.getCallerForShare(userId), sessionId, authGeneration);
        return new AccountMeView(user.getId(), user.getNickname(), user.getCatColor(),
                userService.linkedProviderNames(user), OnboardingCompletion.isComplete(user));
    }

    /**
     * 이름·고양이 색 변경. 같은 키·같은 본문은 최초 결과를 재생하고 다른 본문은 409 다({@link PublicCommandService}).
     * 재생도 현재 세션을 다시 검사한다 — 로그아웃·탈퇴 뒤에는 receipt 가 있어도 개인 응답을 돌려주지 않는다.
     *
     * <p>완료 false→true 전이면 {@code user.onboarded} 가 프로필·receipt 와 같은 TX 에 적히고 receipt {@code events} 에
     * 실린다. 재생은 본문을 돌리지 않아 사건을 다시 만들지 않는다.
     *
     * <p>스위치가 닫혀 있으면 잠금·receipt 선점·변경보다 앞서 503 {@code PROFILE_UPDATE_UNAVAILABLE} 이다.
     */
    @Transactional
    public AccountProfileView patch(UUID userId, AccountPatchRequest request, UUID sessionId, long authGeneration,
                                    UUID idempotencyKey) {
        if (!profileUpdateEnabled) {
            throw new UserException(UserErrorCode.PROFILE_UPDATE_UNAVAILABLE);
        }
        // 지문은 온 필드만 담는다 — 이름만 보낸 옛 요청의 지문({"name":…})과 같게 유지된다.
        Map<String, Object> fingerprint = new LinkedHashMap<>();
        if (request.name() != null) {
            fingerprint.put("name", request.name());
        }
        if (request.catColor() != null) {
            fingerprint.put("catColor", request.catColor());
        }
        var command = new PublicCommandRequest(userId, OPERATION_PATCH + userId, idempotencyKey, tree(fingerprint));
        var receipt = publicCommands.run(command,
                () -> requireSession(users.getCallerForUpdate(userId), sessionId, authGeneration),
                // 재생 전 활성·세션 재검사는 위 활성 검사가 이미 한다. receipt 는 본인 결과뿐이라 더 볼 권한이 없다.
                ignored -> { },
                () -> {
                    var change = userService.updatePublicProfile(userId, request.name(), request.catColor());
                    User user = change.user();
                    var view = new AccountProfileView(user.getId(), user.getNickname(), user.getCatColor());
                    return new PublicCommandResult(200, tree(view), tree(change.events()));
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
