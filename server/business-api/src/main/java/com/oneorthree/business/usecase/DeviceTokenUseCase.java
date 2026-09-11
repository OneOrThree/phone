package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.exception.CommonErrorCode;
import com.oneorthree.business.common.exception.DomainException;
import com.oneorthree.business.common.exception.UpstreamUnavailableException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.DeviceSessionCheck;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import com.oneorthree.business.upstream.notification.NotificationApiClient;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistration;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistrationResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 기기 토큰 등록·삭제 조합. 기존 앱 계약 {@code PUT/DELETE /api/v1/users/me/device-token} 을 보존한다.
 *
 * <h2>등록 순서</h2>
 * ① 활성 검사(위성 쓰기 전, ⓖ) → ② {@code deviceBootstrap} 이 실렸으면 <b>Data 에 세션 활성 동기
 * 확인</b>(㋤)하고 {@code sessionEpoch} 를 받아 → ③ 알림 서버에 등록. ②를 비동기 폐기에만 맡기면
 * relay 지연 사이에 도착한 지연 등록이 «미사용 1회용» 자격으로 통과해 소유권이 되돌아간다.
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
     *                        {@code {deviceToken}} 만 보낸다({@code userApi.ts:81-83}). 없으면 세션 확인을
     *                        건너뛰고 알림 서버가 롤아웃 단계에 따라 판정한다(㊟ ②기간의 「검사 없이 수락」)
     * @param ownershipToken  앱이 보관 중인 CAS 값. 없으면 부트스트랩 예외 경로다(㊦)
     * @return 알림 서버가 발급한 새 {@code ownershipToken} — 앱이 다음 요청에 실어 보낸다(㊚)
     */
    public DeviceRegistrationResult register(AccessTokenClaims claims, String deviceToken, String ownershipToken,
            String deviceBootstrap, RequestIdempotencyKeys keys, Deadline deadline) {

        activeUserGuard.requireActive(claims.userId(), deadline);

        Long sessionEpoch = null;
        if (deviceBootstrap != null && !deviceBootstrap.isBlank()) {
            // 확인과 mutation 을 같은 순서 경계에 넣기 위한 fencing 값을 받는다(㋨).
            // 확인만으로는 TOCTOU 가 남는다 — 알림 서버가 자기 tombstone 과 이 값을 원자 대조한다.
            DeviceSessionCheck check =
                    dataApiClient.verifyDeviceSession(claims.userId(), deviceBootstrap, deadline);
            if (check == null || !check.active()) {
                // 세션이 끝났다. 토큰이 없는 «소유권 이전» 요청이 여기서 막혀야 로그아웃한 계정의
                // 지연 등록이 B 기기의 토큰을 되찾아가지 못한다.
                log.info("deviceBootstrap 세션 비활성 — 등록 거절");
                throw new DomainException(CommonErrorCode.USER_INACTIVE);
            }
            sessionEpoch = check.sessionEpoch();
        }

        DeviceRegistration registration = new DeviceRegistration(
                deviceToken, ownershipToken, deviceBootstrap, sessionEpoch, claims.authGeneration());
        return notificationApiClient.registerDevice(
                claims.userId(), registration, keys.forStep("device-register"), deadline);
    }

    /**
     * 기기 토큰 삭제 — outbox 를 <b>먼저</b> 기록하고 직접 삭제를 시도한다.
     *
     * @param deviceToken    {@code X-Device-Token} 으로 받은 대상 토큰(㊪). <b>없으면 outbox 를 계약대로
     *                       만들 수 없다</b> — 그래도 요청을 거절하지 않는다(구 앱엔 본문이 없다). 알림
     *                       서버가 유저 단위 삭제로 처리하고, 그 기간의 경합을 인정한다
     * @param ownershipToken {@code X-Device-Ownership} 으로 받은 CAS 값(㊟)
     */
    public void delete(AccessTokenClaims claims, String deviceToken, String ownershipToken,
            RequestIdempotencyKeys keys, Deadline deadline) {

        DurableCommandAck recorded = null;
        RuntimeException outboxFailure = null;
        try {
            recorded = dataApiClient.recordDeviceTokenDeletion(claims.userId(), deviceToken, ownershipToken,
                    claims.authGeneration(), keys.forStep("device-delete-outbox"), deadline);
        } catch (RuntimeException e) {
            // ㋩: 여기서 멈추면 직접 삭제를 «시도조차» 못 한다. 삼키지 말고 남겨 두고 ③을 시도한다.
            outboxFailure = e;
            log.error("기기 토큰 삭제 outbox 기록 실패 — 직접 삭제를 계속 시도한다", e);
        }

        try {
            notificationApiClient.deleteDevice(claims.userId(), deviceToken, ownershipToken,
                    claims.authGeneration(), keys.forStep("device-delete"), deadline);
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
