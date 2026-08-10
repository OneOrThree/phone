package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.common.port.PushSendResult;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * 발송 공통 규칙 필터 체인 (GROMO-528 커밋③) — apns.md §2.
 * 트리거(커밋④, 후속 578/579)가 공용으로 사용.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PushNotificationService {

    /**
     * 심야 미설정/비활성 유저에게 적용하는 기본 금지 구간 — 23:00~07:00 KST.
     * 공격형 카탈로그(GROMO-819) 수용을 위해 21:00~09:00 에서 조정(GROMO-840):
     * 21:00(오늘 미집중)·22:00(마감 2h·스트릭)·07:00(결과·새 리그) 발송이 이 창 밖이라 통과한다.
     */
    static final LocalTime DEFAULT_QUIET_START = LocalTime.of(23, 0);
    static final LocalTime DEFAULT_QUIET_END = LocalTime.of(7, 0);

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final PushNotificationPort pushNotificationPort;
    private final UserRepository userRepository;
    private final EntityManager entityManager;

    /**
     * 필터 체인 통과 시에만 발송한다.
     * settings 는 호출측이 findAllById 로 일괄 로드해 전달 (유저별 단건 조회 N+1 금지),
     * null 허용 — row 부재 시 기본값(알림 on·심야 off)으로 취급.
     * INVALID_TOKEN 시 토큰을 정리하므로 호출측은 쓰기 @Transactional 안에서 불러야 한다.
     *
     * @return 실제 발송이 성사(FCM SENT)되면 true. 필터 스킵(알림 off·토큰 없음·quiet hours)·
     *     무효 토큰·실패·예외는 모두 false. 순위 추월(579)이 이 반환값으로 "발송되면 sent_log INSERT" 를
     *     정확히 판정한다(quiet hours 스킵을 발송으로 오기록하지 않기 위함). ①②④⑥ 는 반환값을 무시.
     */
    public boolean sendIfAllowed(User user, UserNotificationSettings settings,
                                 PushMessage message, Instant now) {
        // 1. 알림 꺼짐 → 스킵 (settings null = 기본값 허용)
        if (settings != null && !settings.isNotificationEnabled()) {
            return false;
        }
        // 2. 토큰 없음(알림 권한 미허용/해제) → 스킵
        if (user.getDeviceToken() == null) {
            return false;
        }
        // 3. Quiet hours → 스킵 + info 로그 (지연 발송 하지 않음 — 스펙 확정)
        if (isQuietHours(settings, now)) {
            log.info("Quiet hours 스킵 — userId={}, title={}", user.getId(), message.title());
            return false;
        }
        // 4. 발송 — 한 유저 실패가 배치 루프를 중단시키지 않게 예외 격리
        return deliver(user, message);
    }

    /**
     * 사일런트(data-only) 발송(GROMO-1281, FR-22) — <b>표시 필터를 타지 않는다</b>. 알림 설정
     * off·quiet hours 는 "표시"에 대한 약속이지 앱 백그라운드 기동과 무관하고(HLD §6 — 사일런트는
     * 조용한 시간 예외), 심야 창의 업로드 flush 가 바로 이 예외에 기대기 때문이다. 토큰 검사와
     * 무효 토큰 정리는 표시 발송과 동일하다 — 쓰기 @Transactional 안에서 부를 것.
     *
     * @return 실제 발송이 성사(FCM SENT)되면 true — 호출측이 이 값으로 클레임 SENT/반납을 가른다
     */
    public boolean sendSilentPush(User user, PushMessage message) {
        if (user.getDeviceToken() == null) {
            return false;
        }
        return deliver(user, message);
    }

    /** 발송 + 무효 토큰 정리 공통부 — 표시(sendIfAllowed)와 사일런트가 같은 규칙을 쓴다. */
    private boolean deliver(User user, PushMessage message) {
        try {
            // 실제로 FCM 에 보낸 토큰을 붙잡아 둔다 — 정리 조건에 이 값을 그대로 쓴다.
            String sentToken = user.getDeviceToken();
            PushSendResult result = pushNotificationPort.send(sentToken, message);
            if (result == PushSendResult.INVALID_TOKEN) {
                // 무효 토큰 정리 — 다음 발송부터 필터 2 에서 컷.
                // 더티체킹이 아니라 조건부 컬럼 UPDATE 를 쓴다: User 에 @Version·@DynamicUpdate 가 없어
                // 더티체킹 UPDATE 는 전체 컬럼을 옛 스냅샷으로 덮어쓰고, 그사이 탈퇴가 먼저 커밋됐다면
                // is_deleted 와 파기된 PII 까지 되살린다(GROMO-1090 @codex 리뷰 P1).
                int cleared = userRepository.clearDeviceToken(user.getId(), sentToken);
                // 같은 트랜잭션에서 이 유저가 또 대상이 되면(내기 여러 건·동시 종료된 챌린지 여러 건)
                // 인메모리 토큰이 남아 필터 2 를 계속 통과해, 이미 지운 토큰으로 FCM 을 반복 호출한다.
                // 그래서 인메모리도 맞추되 **detach 후에** 바꾼다 — 관리 상태에서 바꾸면 방금 피한
                // 전체 컬럼 더티체킹 UPDATE 가 그대로 되살아난다. 이 경로 뒤에 user 를 변경하는 호출부는 없다.
                entityManager.detach(user);
                user.setDeviceToken(null);
                log.info("무효 토큰 정리 — userId={}, updated={}", user.getId(), cleared);
                return false;
            } else if (result == PushSendResult.FAILED) {
                log.warn("푸시 발송 실패 — userId={}, title={}", user.getId(), message.title());
                return false;
            }
            return true;
        } catch (Exception e) {
            log.warn("푸시 발송 중 예외 — userId={}", user.getId(), e);
            return false;
        }
    }

    /**
     * Quiet hours 판정 — 구간은 [start, end) (시작 포함·종료 미포함: 23:00 정각 = 금지, 07:00 정각 = 허용).
     * nightModeEnabled == true 이고 시각이 모두 설정된 유저만 유저 구간, 그 외는 기본 23:00–07:00.
     * 판정 시각은 KST 고정 (412/519 리그 도메인과 통일).
     */
    static boolean isQuietHours(UserNotificationSettings settings, Instant now) {
        LocalTime start = quietStartOf(settings);
        LocalTime end = quietEndOf(settings);
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

    /**
     * 지금 걸린 조용한 시간이 <b>끝나는 시각</b>(GROMO-1417 · N44) — 이월 클레임의
     * {@code next_attempt_at} 이 된다. 구간이 {@code [start, end)} 라 종료 시각 정각은 이미 발송
     * 허용이므로 그 시각을 그대로 돌려준다.
     *
     * <p>구간은 유저 설정({@code nightStartTime}·{@code nightEndTime})이라 임의의 {@code HH:mm}
     * 이다 — "조용한 시간 = 07:00 종료"로 가정하면 09:00 종료 유저의 이월분이 07:00 에 깨어나
     * 다시 조용한 시간에 걸린다(그리고 그 뒤로 매 틱 반복된다).
     *
     * @return {@code now} <b>이후</b>의 가장 이른 종료 시각. 퇴화 구간(start == end, 조용한 시간
     *     없음)이면 {@code now} — 호출측이 조용한 시간일 때만 부르므로 도달하지 않는 방어값이다.
     */
    static Instant quietHoursEndAfter(UserNotificationSettings settings, Instant now) {
        LocalTime start = quietStartOf(settings);
        LocalTime end = quietEndOf(settings);
        if (start.equals(end)) {
            return now;
        }
        ZonedDateTime candidate = now.atZone(KST).toLocalDate().atTime(end).atZone(KST);
        if (!candidate.toInstant().isAfter(now)) {
            // 종료 시각이 오늘 이미 지났다 = 자정을 걸치는 구간의 앞쪽(예: 23:30 에 07:00 종료).
            candidate = candidate.plusDays(1);
        }
        return candidate.toInstant();
    }

    /** 조용한 시간 시작 — 유저 설정이 온전할 때만 유저 값, 그 외는 기본 23:00. */
    private static LocalTime quietStartOf(UserNotificationSettings settings) {
        return hasCustomQuietHours(settings) ? settings.getNightStartTime() : DEFAULT_QUIET_START;
    }

    /** 조용한 시간 종료 — 유저 설정이 온전할 때만 유저 값, 그 외는 기본 07:00. */
    private static LocalTime quietEndOf(UserNotificationSettings settings) {
        return hasCustomQuietHours(settings) ? settings.getNightEndTime() : DEFAULT_QUIET_END;
    }

    private static boolean hasCustomQuietHours(UserNotificationSettings settings) {
        return settings != null && settings.isNightModeEnabled()
                && settings.getNightStartTime() != null && settings.getNightEndTime() != null;
    }
}
