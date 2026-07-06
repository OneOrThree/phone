package com.oneorthree.phone.notification.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 발송 이력 로그 (GROMO-579 — 순위 추월 푸시의 쿨다운·상한 판정용).
 *
 * <p>실제 발송이 성사된 건만 INSERT 한다. 두 억제 규칙의 판정 소스:
 * <ul>
 *   <li>같은 라이벌 48h 쿨다운 — (user_id, type=RANK_OVERTAKE, target_user_id=대표라이벌) 최근 sent_at 조회,
 *   <li>이번 주 주2회 상한 — (user_id, type=RANK_OVERTAKE) 이번 주(월 00:00 KST~) sent_at 카운트.
 * </ul>
 * type 은 발송 종류 문자열(현재 "RANK_OVERTAKE"). target_user_id 는 대상이 특정 유저인 발송에서만 채운다(추월=대표 라이벌).
 * (user_id, type, sent_at) 인덱스로 위 두 조회를 커버. 리그계열과의 크로스 dedup 은 후속(주석) — 여기선 추월 자체만.
 */
@Entity
@Table(
        name = "notification_sent_logs",
        indexes = @Index(name = "idx_notification_sent_logs_user_type_sent",
                columnList = "user_id, type, sent_at")
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class NotificationSentLog {

    /** 발송 종류 — 순위 추월. */
    public static final String TYPE_RANK_OVERTAKE = "RANK_OVERTAKE";

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private String type;

    // 대상이 특정 유저인 발송에서만 채움 — 추월은 대표 라이벌(같은 라이벌 48h 쿨다운 판정 키). 그 외는 null.
    @Column(name = "target_user_id")
    private UUID targetUserId;

    @Column(name = "sent_at", nullable = false)
    private Instant sentAt;
}
