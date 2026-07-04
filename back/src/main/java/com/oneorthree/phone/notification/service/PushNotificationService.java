package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.common.port.PushSendResult;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;

/**
 * 발송 공통 규칙 필터 체인 (GROMO-528 커밋③) — apns.md §2.
 * 트리거(커밋④, 후속 578/579)가 공용으로 사용.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PushNotificationService {

    /** 심야 미설정/비활성 유저에게 적용하는 기본 금지 구간 — 21:00~09:00 (apns.md §2). */
    static final LocalTime DEFAULT_QUIET_START = LocalTime.of(21, 0);
    static final LocalTime DEFAULT_QUIET_END = LocalTime.of(9, 0);

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final PushNotificationPort pushNotificationPort;

    /**
     * 필터 체인 통과 시에만 발송한다.
     * settings 는 호출측이 findAllById 로 일괄 로드해 전달 (유저별 단건 조회 N+1 금지),
     * null 허용 — row 부재 시 기본값(알림 on·심야 off)으로 취급.
     * INVALID_TOKEN 시 토큰을 정리하므로 호출측은 쓰기 @Transactional 안에서 불러야 한다.
     */
    public void sendIfAllowed(User user, UserNotificationSettings settings,
                              PushMessage message, Instant now) {
        // 1. 알림 꺼짐 → 스킵 (settings null = 기본값 허용)
        if (settings != null && !settings.isNotificationEnabled()) {
            return;
        }
        // 2. 토큰 없음(알림 권한 미허용/해제) → 스킵
        if (user.getDeviceToken() == null) {
            return;
        }
        // 3. Quiet hours → 스킵 + info 로그 (지연 발송 하지 않음 — 스펙 확정)
        if (isQuietHours(settings, now)) {
            log.info("Quiet hours 스킵 — userId={}, title={}", user.getId(), message.title());
            return;
        }
        // 4. 발송 — 한 유저 실패가 배치 루프를 중단시키지 않게 예외 격리
        try {
            PushSendResult result = pushNotificationPort.send(user.getDeviceToken(), message);
            if (result == PushSendResult.INVALID_TOKEN) {
                // 무효 토큰 정리 — 다음 발송부터 필터 2 에서 컷 (더티체킹 반영)
                user.setDeviceToken(null);
                log.info("무효 토큰 정리 — userId={}", user.getId());
            } else if (result == PushSendResult.FAILED) {
                log.warn("푸시 발송 실패 — userId={}, title={}", user.getId(), message.title());
            }
        } catch (Exception e) {
            log.warn("푸시 발송 중 예외 — userId={}", user.getId(), e);
        }
    }

    /**
     * Quiet hours 판정 — 구간은 [start, end) (시작 포함·종료 미포함: 21:00 정각 = 금지, 09:00 정각 = 허용).
     * nightModeEnabled == true 이고 시각이 모두 설정된 유저만 유저 구간, 그 외는 기본 21:00–09:00.
     * 판정 시각은 KST 고정 (412/519 리그 도메인과 통일).
     */
    static boolean isQuietHours(UserNotificationSettings settings, Instant now) {
        LocalTime start = DEFAULT_QUIET_START;
        LocalTime end = DEFAULT_QUIET_END;
        if (settings != null && settings.isNightModeEnabled()
                && settings.getNightStartTime() != null && settings.getNightEndTime() != null) {
            start = settings.getNightStartTime();
            end = settings.getNightEndTime();
        }
        // start == end 는 빈 구간 — 퇴화 설정 방어(항상 발송 허용)
        if (start.equals(end)) {
            return false;
        }
        LocalTime t = now.atZone(KST).toLocalTime();
        if (start.isBefore(end)) {
            // 자정을 안 걸치는 구간 (예: 13:00–15:00)
            return !t.isBefore(start) && t.isBefore(end);
        }
        // 자정을 걸치는 구간 (예: 21:00–09:00)
        return !t.isBefore(start) || t.isBefore(end);
    }
}
