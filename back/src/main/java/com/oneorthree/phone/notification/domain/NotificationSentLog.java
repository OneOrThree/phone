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

    /**
     * 발송 종류 — 내기 정산 결과(B4). {@code target_user_id} 에 <b>내기 id</b> 를 담아
     * (user_id, type, target_user_id) 조합으로 "이 유저에게 이 내기 결과를 이미 보냈는지"를 판정한다.
     * 08:00·13:00 두 크론이 같은 정산분을 훑어도 이 dedup 때문에 한 번만 나간다.
     */
    public static final String TYPE_BET_RESULT = "BET_RESULT";

    /**
     * 발송 종류 — 스크린타임 창형 챌린지의 창 종료 알림(B4). {@code target_user_id} 에 <b>챌린지 id</b>.
     * 창은 매일 반복되므로 dedup 은 (user_id, type, target_user_id) + <b>당일 sent_at</b> 으로 본다.
     */
    public static final String TYPE_CHALLENGE_WINDOW_END = "CHALLENGE_WINDOW_END";

    /**
     * 발송 종류 — 그룹에 새 챌린지가 등록됐을 때의 그룹원 알림(GROMO-1089).
     * {@code target_user_id} 에 <b>챌린지 id</b> 를 담아 (user_id, type, target_user_id) 조합으로
     * "이 유저에게 이 챌린지 개설 알림을 이미 보냈는지"를 판정한다. 챌린지 개설은 1회성이라
     * 정상 흐름에서는 중복이 없고, 이 dedup 은 이벤트 재발행·재시도에 대한 안전망이다.
     */
    public static final String TYPE_CHALLENGE_CREATED = "CHALLENGE_CREATED";

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private String type;

    // dedup·쿨다운 판정 키. 추월(579)은 대표 라이벌 userId, 내기 결과(B4)는 betId, 창 종료(B4)는
    // challengeId 를 담는다 — 컬럼에 FK 가 없어(V1 baseline) 유저 외 식별자도 그대로 실을 수 있다.
    // type 별로 의미가 다르므로 조회는 항상 type 과 함께 건다. 대상이 없는 발송은 null.
    @Column(name = "target_user_id")
    private UUID targetUserId;

    @Column(name = "sent_at", nullable = false)
    private Instant sentAt;
}
