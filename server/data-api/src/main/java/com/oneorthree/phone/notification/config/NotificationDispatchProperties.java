package com.oneorthree.phone.notification.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Data 의 알림 <b>출력 경로</b> 선택 — 기본값은 구 경로다 (계약 §5 · 1661 전환 전 공존).
 *
 * <h2>왜 기본이 {@code LEGACY} 인가</h2>
 * 이 코드가 들어가는 시점에 알림 서버는 아직 이 사건들을 소비하지 않는다. 기본을 {@code OUTBOX}
 * 로 두면 배포되는 순간 <b>모든 알림이 아무도 읽지 않는 토픽으로 사라진다</b> — 실패 신호도 없이
 * 조용히 멈춘다. 그래서 새 경로는 «켜야 켜지는» 쪽으로만 열린다.
 *
 * <h2>이 값은 「끄기 스위치」가 아니다</h2>
 * {@code OUTBOX} 로 올린 뒤 문제가 생겼다고 {@code LEGACY} 로 되돌리면, 그사이 알림 DB 에만
 * 쌓인 발송 이력을 Data 가 모르므로 <b>이미 나간 알림이 다시 나간다</b>(계약 §7 — 「kind 플래그만
 * legacy 로 되돌려 두 DB 발송 이력의 차이를 무시하지 않는다」). 되돌림은 이관 절차의 일부이지
 * 설정 한 줄이 아니다.
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "notification.dispatch")
public class NotificationDispatchProperties {

    /** 출력 경로. 기본 {@link Mode#LEGACY}. */
    private Mode mode = Mode.LEGACY;

    /** 출력 경로의 두 상태. */
    public enum Mode {

        /** 구 경로 — Data 가 직접 FCM 을 부르고 {@code notification_sent_logs} 로 dedup 한다. */
        LEGACY,

        /**
         * 신 경로 — Data 는 판정만 하고 결정적 사건 키 + 렌더 입력을 outbox 에 적는다.
         * claim/render/send/flush 는 알림 서버가 소유한다.
         */
        OUTBOX
    }

    /** @return 신 경로인가 */
    public boolean isOutboxMode() {
        return mode == Mode.OUTBOX;
    }
}
