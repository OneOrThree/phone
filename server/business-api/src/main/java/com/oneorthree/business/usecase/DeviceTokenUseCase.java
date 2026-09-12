package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.exception.CommonErrorCode;
import com.oneorthree.business.common.exception.DomainException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.validation.DeviceOwnershipTokens;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.DeviceSessionCheck;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistration;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistrationResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import java.util.UUID;

/**
 * 기기 토큰 등록·삭제 조합. 기존 앱 계약 {@code PUT/DELETE /api/v1/users/me/device-token} 을 보존한다.
 *
 * <h2>등록 순서</h2>
 * ① 활성 검사(위성 쓰기 전, ⓖ) → ② {@code deviceBootstrap} 이 실렸으면 <b>Data 에 세션 활성 동기
 * 확인</b>(㋤)하고 {@code sessionEpoch} 를 받아 → ③ 알림 서버에 등록. ②를 비동기 폐기에만 맡기면
 * relay 지연 사이에 도착한 지연 등록이 «미사용 1회용» 자격으로 통과해 소유권이 되돌아간다.
 *
 * <p><b>자격이 없어도 ②는 건너뛰지 않는다.</b> 구 앱은 {@code deviceBootstrap} 을 저장하지 않지만 그
 * 앱이 쓰는 AT 에도 서명된 {@code sid} 가 있다 — 그 값으로 세션 활성을 같은 자리에서 확인하고,
 * 확인된 sid 를 {@code legacySessionId} 로 실어 보낸다. 알림 서버는 그 값으로 <b>키가 다른 별도 fence</b>
 * 를 잡는다. 없이 두면 로그아웃한 세션의 AT 가 만료 전까지 <b>다른 새 FCM 토큰</b>을 등록할 수 있고,
 * 그 행은 어느 세션에도 묶여 있지 않아 폐기 relay 가 닿지 못하는 데다 로그아웃은 유저 세대를 올리지
 * 않으므로(㊼) <b>영구히</b> 남는다.
 *
 * <p>반대로 자격을 대신 발급해 주는 것(= 위조)은 하지 않는다 — 그건 소유권 이전까지 열어 현대 앱의
 * CAS 판정을 이 경로로 우회시킨다. 두 축은 <b>함께 싣지 않는다</b>: 자격이 있으면 자격 축으로만 간다.
 *
 * <h2>삭제 순서 — 뒤집으면 안 된다</h2>
 * ① 활성 검사 없음(탈퇴자도 자기 토큰은 지워야 한다) → ② <b>Data outbox 를 먼저 기록</b>(㊲ · ㊿) →
 * ③ 알림 서버에 직접 삭제 → ④ 성공하면 outbox 완료 표시.
 *
 * <p>순서를 뒤집으면(실패 후에야 기록) 그 사이 프로세스가 죽을 때 직접 삭제도 outbox 도 남지 않고,
 * 앱은 이 DELETE 실패를 삼키고 로컬 인증을 지우므로 <b>아무도 재시도하지 않고 이전 계정 푸시가 그
 * 기기로 계속 간다</b>({@code App.tsx:528} 의 {@code .catch(() => {})}).
 *
 * <p><b>②가 실패해도 ③은 시도한다</b>(㋩). Data 장애가 공통 재시도보다 길면 이 순서에서는 직접 삭제를
 * 시도조차 못 한 채 요청이 실패하고, 그때도 앱은 실패를 삼킨다 — 그래서 ②의 실패를 삼키지 않고
 * 로그로 남긴 뒤 ③을 시도하고, <b>둘 다 실패하면 요청을 실패시킨다</b>(앱의 내구 재시도 몫으로 남긴다.
 * 성공한 척하면 그 재시도조차 사라진다).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DeviceTokenUseCase {

    private final ActiveUserGuard activeUserGuard;
    private final DataApiClient dataApiClient;
    private final NotificationApiClient notificationApiClient;

    /**
     * @param deviceBootstrap 앱이 실은 그 로그인 세션의 1회용 자격. <b>없을 수 있다</b> — 현 앱은
     *                        {@code {deviceToken}} 만 보낸다({@code userApi.ts:81-83}). 없으면 AT 의
     *                        {@code sid} 로 세션 활성을 확인하고 그 값을 {@code legacySessionId} 로 실어
     *                        보낸다 — 자격 축은 비운 채, 구 앱 세션 축으로 판정된다(㊟ ②기간의 구 앱 창).
     *                        {@code sid} 도 없는 구 AT 만 확인 없이 내려간다 — 그 토큰은 최대 AT 수명 안에
     *                        모두 만료된다
     * @param ownershipToken  앱이 보관 중인 CAS 값. 없으면 부트스트랩 예외 경로다(㊦)
     * @return 알림 서버가 발급한 새 {@code ownershipToken} — 앱이 다음 요청에 실어 보낸다(㊚)
     */
    public DeviceRegistrationResult register(AccessTokenClaims claims, String deviceToken, String ownershipToken,
            String deviceBootstrap, RequestIdempotencyKeys keys, Deadline deadline) {

        // 상류에 닿기 «전»이다. 깨진 CAS 값은 어느 행에도 맞지 않아 등록이 어차피 409 로 끝나는데,
        // 그 전에 활성 검사·세션 확인으로 Data 를 두 번 두드리고 나서야 알게 된다.
        DeviceOwnershipTokens.requireCanonical(ownershipToken);
        activeUserGuard.requireActive(claims.userId(), deadline);

        Long sessionEpoch = null;
        String legacySessionId = null;
        if (deviceBootstrap != null && !deviceBootstrap.isBlank()) {
            // 확인과 mutation 을 같은 순서 경계에 넣기 위한 fencing 값을 받는다(㋨).
            // 확인만으로는 TOCTOU 가 남는다 — 알림 서버가 자기 tombstone 과 이 값을 원자 대조한다.
            DeviceSessionCheck check =
                    dataApiClient.verifyDeviceSession(claims.userId(), deviceBootstrap, deadline);
            if (check == null) {
                throw new UpstreamContractMismatchException("Data 세션 확인 응답 본문이 없습니다");
            }
            if (!check.active()) {
                // 세션이 끝났다. 토큰이 없는 «소유권 이전» 요청이 여기서 막혀야 로그아웃한 계정의
                // 지연 등록이 B 기기의 토큰을 되찾아가지 못한다.
                log.info("deviceBootstrap 세션 비활성 — 등록 거절");
                throw new DomainException(CommonErrorCode.USER_INACTIVE);
            }
            sessionEpoch = check.sessionEpoch();
        } else if (claims.sessionId() != null) {
            // 자격을 싣지 못하는 구 앱이다. 그래도 «서명된 sid» 는 있으므로 세션 활성만은 같은
            // 동기 경계에서 확인한다 — 이게 없으면 로그아웃한 세션의 AT 가 만료 전까지 «다른 새 FCM
            // 토큰»을 등록할 수 있고, 그 행은 자격에 묶여 있지 않아 세션 폐기 relay 도 닿지 못한다
            // (로그아웃은 유저 세대를 올리지 않는다 ㊼). 즉 로그아웃이 푸시를 끊지 못한다.
            DeviceSessionCheck check =
                    dataApiClient.verifySession(claims.userId(), claims.sessionId(), deadline);
            if (check == null) {
                throw new UpstreamContractMismatchException("Data 세션 확인 응답 본문이 없습니다");
            }
            if (!check.active()) {
                log.info("AT 의 sid 세션 비활성 — 등록 거절");
                throw new DomainException(CommonErrorCode.USER_INACTIVE);
            }
            // 확인된 세션을 «별도 축»으로 실어 보낸다. 자격 해시로 키가 잡힌 세션 tombstone 에는 이
            // 요청을 묶을 수 없으므로(자격이 없다), 알림 서버가 sid 로 키를 잡는 구 앱 fence 를 따로
            // 둔다 — 그래야 이 로그인의 기기를 로그아웃이 실제로 끊는다. epoch 은 그 fence 의 fencing
            // 값이라 함께 보낸다.
            sessionEpoch = check.sessionEpoch();
            legacySessionId = claims.sessionId().toString();
        }

        DeviceRegistration registration = new DeviceRegistration(
                deviceToken, ownershipToken, deviceBootstrap, sessionEpoch, claims.authGeneration(),
                legacySessionId);
        DeviceRegistrationResult result = notificationApiClient.registerDevice(
                claims.userId(), registration, keys.forStep("device-register"), deadline);
        if (result == null) {
            throw new UpstreamContractMismatchException("알림 기기 등록 응답 본문이 없습니다");
        }
        if (!DeviceOwnershipTokens.isCanonical(result.ownershipToken())) {
            throw new UpstreamContractMismatchException("알림 기기 등록 응답에 유효한 ownershipToken이 없습니다");
        }
        revokeIfTheSessionEndedDuringRegistration(
                claims, deviceToken, result, deviceBootstrap, legacySessionId, deadline);
        return result;
    }

    /**
     * 확인과 등록 사이에 그 세션이 끝났으면 <b>방금 등록한 토큰을 즉시 되돌린다</b>.
     *
     * <h2>왜 필요한가</h2>
     * 세션 확인이 성공한 직후 Data 의 세션 행 잠금은 HTTP 응답과 함께 풀리고, 실제 등록은 별도
     * 호출로 나중에 실행된다. 그 사이에 같은 세션의 로그아웃이 커밋되면, 폐기 사건이 알림 서버에
     * <b>아직 도착하지 않은</b> 동안에는 그쪽 {@code session_fences} 에 tombstone 이 없어 등록이
     * 성공한다. 그 상태에서 발송이 끼어들면 <b>로그아웃한 기기로 비공개 알림이 간다</b>.
     *
     * <h2>무엇이 이미 막고 있는가 — 그리고 무엇이 안 막는가</h2>
     * 이 구멍은 <b>영구적이지 않다</b>. 폐기 사건이 도착하면 알림 서버의
     * {@code DeviceService#revokeSession} 이 {@code session_epoch<=epoch} 로 <b>그 창에 등록된 행까지
     * 비활성화</b>하고, tombstone 이 남아 이후 지연 등록도 {@code SESSION_REVOKED} 로 막는다.
     * 남는 것은 <b>등록 커밋부터 폐기 사건 도착까지</b>의 시간이고, 그 길이는 relay 의 전달 지연이
     * 정한다 — 즉 우리가 통제하지 못하는 값이다.
     *
     * <p>그래서 그 창을 <b>relay 를 기다리지 않고</b> Business 가 직접 닫는다. 등록이 끝난 뒤 같은
     * 세션을 한 번 더 확인하고, 그사이 끝났으면 방금 등록한 토큰을 지운다. 창이 「relay 지연」에서
     * 「왕복 한 번」으로 줄어든다.
     *
     * <p><b>완전한 폐쇄는 아니다.</b> 이 재확인과 삭제 사이에도 창이 남는다. 0 으로 만들려면 등록
     * 의도를 Data 의 세션 잠금 «아래»에 내구 기록해 폐기와 한 순서 축에 놓아야 하는데, 그것은 Data
     * 의 새 표면과 알림 서버의 소비 경로가 함께 필요한 별도 작업이다.
     *
     * <p>되돌리기가 실패해도 <b>등록 자체는 실패시키지 않는다.</b> 앱은 이미 새 소유권을 받아야 하고,
     * 못 지운 행은 폐기 사건이 도착할 때 원래대로 정리된다 — 여기서 예외를 올리면 정상 로그인이
     * 실패로 보이면서 정리는 어차피 relay 가 한다.
     *
     * <h2>확인한 축으로 다시 확인한다 — 구 앱 경로도 예외가 아니다</h2>
     * 이 창은 <b>자격 경로만의 것이 아니다</b>. {@code sid} 로 판정한 구 앱 요청도 {@code verifySession()}
     * 을 통과한 직후 로그아웃될 수 있고, 그쪽은 자격 해시가 아니라 sid 로 키가 잡힌 fence 를 쓰므로
     * 폐기 relay 가 닿기 전까지는 등록이 그대로 살아 있다 — 같은 「로그아웃한 기기로 비공개 알림」이다.
     * 그래서 <b>등록 전에 확인한 그 축</b>으로 재확인한다: 자격이 있었으면 {@code verifyDeviceSession},
     * 구 앱이었으면 {@code verifySession}. 어느 축으로도 확인하지 않은 요청(자격도 sid 도 없는 구 AT)만
     * 재확인 없이 지나간다 — 확인한 적이 없으니 되돌릴 판정 기준도 없다.
     *
     * @param legacySessionId 등록 전에 {@code sid} 축으로 판정했을 때만 채워진다. 두 축은 함께 실리지
     *                        않으므로(자격이 있으면 자격 축으로만 간다) 이 값의 유무가 곧 재확인 축이다
     */
    private void revokeIfTheSessionEndedDuringRegistration(AccessTokenClaims claims, String deviceToken,
            DeviceRegistrationResult result, String deviceBootstrap, String legacySessionId, Deadline deadline) {
        boolean checkedByBootstrap = deviceBootstrap != null && !deviceBootstrap.isBlank();
        boolean checkedByLegacySid = legacySessionId != null;
        if (!checkedByBootstrap && !checkedByLegacySid) {
            return;
        }
        try {
            DeviceSessionCheck after = checkedByBootstrap
                    ? dataApiClient.verifyDeviceSession(claims.userId(), deviceBootstrap, deadline)
                    : dataApiClient.verifySession(claims.userId(), claims.sessionId(), deadline);
            if (after == null) {
                throw new UpstreamContractMismatchException("Data 등록 후 세션 확인 응답 본문이 없습니다");
            }
            if (after.active()) {
                return;
            }
            log.warn("등록 중 세션이 끝났다 — 방금 등록한 기기 토큰을 되돌린다. userId={}", claims.userId());
            notificationApiClient.deleteDevice(claims.userId(), deviceToken, result.ownershipToken(),
                    claims.authGeneration(), RequestIdempotencyKeys.from(null).forStep("device-register-undo"),
                    deadline);
        } catch (RuntimeException e) {
            // 판정 불가는 세션 폐기 증거가 아니다. 등록 응답을 보존하고 기기를 임의로 지우지 않는다.
            // 실제 폐기 뒤 되돌리기만 실패한 경우는 내구 폐기 사건이 도착하면 정리된다.
            log.warn("등록 후 세션 재확인·되돌리기 실패 — 확인된 등록 응답을 보존한다", e);
        }
    }

    /**
     * 기기 토큰 삭제 — outbox 를 <b>먼저</b> 기록하고 직접 삭제를 시도한다.
     *
     * @param deviceToken    {@code X-Device-Token} 으로 받은 대상 토큰(㊪). 토큰·CAS가 모두 없으면
     *                       검증한 AT의 sid를 Data에서 해석해 해당 세션의 기기만 지운다.
     *                       sid도 없으면 성공 no-op이며 사용자 전체 삭제로 넓히지 않는다.
     * @param ownershipToken {@code X-Device-Ownership} 으로 받은 CAS 값(㊟). 값이 있으면 <b>정규
     *                       UUID 표기</b>여야 한다 — 형식이 깨진 값은 내구 기록 전에 400 으로
     *                       거절한다({@link DeviceOwnershipTokens})
     */
    public void delete(AccessTokenClaims claims, String deviceToken, String ownershipToken,
            RequestIdempotencyKeys keys, Deadline deadline) {

        // ⚠️ 내구 기록(②)보다 «앞»이다. 형식이 깨진 CAS 값이 outbox 봉투에 실리면 알림 서버가 그
        // 봉투를 계속 실패시키고, relay 는 고갈 처리가 없어(A18) 순서 축이 같은 «그 유저의 뒤
        // 이벤트 전부»가 막힌다 — 세션 폐기·탈퇴 tombstone 까지 함께 멈춘다. 깨진 값을 null 로
        // 접어 통과시키지도 않는다: 그건 CAS 없는 넓은 삭제이고, 그 사이 재등록된 지금 기기까지
        // 지운다(㊚).
        DeviceOwnershipTokens.requireCanonical(ownershipToken);

        UUID sessionId = (deviceToken == null || deviceToken.isBlank()) && ownershipToken == null
                ? claims.sessionId() : null;

        DurableCommandAck recorded = null;
        RuntimeException outboxFailure = null;
        try {
            recorded = sessionId == null
                    ? dataApiClient.recordDeviceTokenDeletion(claims.userId(), deviceToken, ownershipToken,
                            claims.authGeneration(), keys.forStep("device-delete-outbox"), deadline)
                    : dataApiClient.recordDeviceTokenDeletion(claims.userId(), deviceToken, ownershipToken,
                            claims.authGeneration(), sessionId, keys.forStep("device-delete-outbox"), deadline);
        } catch (RuntimeException e) {
            if (sessionId != null) {
                log.warn("세션 범위 조회·삭제 outbox 기록 실패 — 범위 없는 직접 삭제로 대체하지 않는다", e);
                throw new UpstreamUnavailableException("기기 삭제의 세션 범위를 확인하지 못했습니다", e);
            }
            // ㋩: 여기서 멈추면 직접 삭제를 «시도조차» 못 한다. 삼키지 말고 남겨 두고 ③을 시도한다.
            outboxFailure = e;
            log.error("기기 토큰 삭제 outbox 기록 실패 — 직접 삭제를 계속 시도한다", e);
        }

        String bootstrapHash = null;
        if (sessionId != null) {
            // Data가 장애이거나 아직 구 응답 계약이면 범위 없는 직접 삭제로 대체하지 않는다.
            if (recorded == null || recorded.params() == null
                    || !sessionId.toString().equals(recorded.params().get("sessionId"))) {
                throw new UpstreamUnavailableException("기기 삭제의 세션 범위를 확인하지 못했습니다", outboxFailure);
            }
            bootstrapHash = (String) recorded.params().get("bootstrapNonceHash");
        }
        try {
            if (sessionId == null) {
                notificationApiClient.deleteDevice(claims.userId(), deviceToken, ownershipToken,
                        claims.authGeneration(), keys.forStep("device-delete"), deadline);
            } else {
                notificationApiClient.deleteDevice(claims.userId(), deviceToken, ownershipToken,
                        claims.authGeneration(), sessionId, bootstrapHash, keys.forStep("device-delete"), deadline);
            }
        } catch (RuntimeException e) {
            if (outboxFailure != null) {
                // 둘 다 실패했다 — 남은 재시도 주체는 앱뿐이다. 성공한 척하면 그 재시도조차 사라진다.
                log.error("기기 토큰 삭제 outbox·직접 삭제 모두 실패", e);
                throw new UpstreamUnavailableException("기기 토큰 삭제를 어느 경로로도 기록하지 못했다", e);
            }
            // outbox 는 남았다 — relay 가 이어받는다. 앱에는 성공으로 보이지 않게 실패를 올린다:
            // 앱이 성공으로 알면 다음 변경까지 재시도하지 않고, 그동안 푸시는 계속 간다.
            log.warn("기기 토큰 직접 삭제 실패 — outbox relay 가 이어받는다", e);
            throw e;
        }

        if (recorded != null) {
            markDeliveredQuietly(claims, recorded, deadline);
        }
    }

    /**
     * 완료 표시 실패는 사용자 요청을 실패시키지 않는다 — 이미 삭제는 반영됐고, relay 가 한 번 더 보낼
     * 뿐이며 알림 서버의 멱등이 그것을 흡수한다. 여기서 예외를 올리면 성공한 삭제가 오류로 보인다.
     */
    private void markDeliveredQuietly(AccessTokenClaims claims, DurableCommandAck recorded, Deadline deadline) {
        try {
            dataApiClient.markCommandDelivered(claims.userId(), recorded.commandId(), deadline);
        } catch (RuntimeException e) {
            log.warn("삭제 outbox 완료 표시 실패 — relay 가 한 번 더 보낸다. commandId={}",
                    recorded.commandId(), e);
        }
    }
}
