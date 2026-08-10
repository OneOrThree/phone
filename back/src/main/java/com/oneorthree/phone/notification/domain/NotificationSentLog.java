package com.oneorthree.phone.notification.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
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
 *
 * <p><b>V45 확장(GROMO-1417, N41)</b> — "실발송 후 기록" 모델은 다중 인스턴스에서 이중 발송을
 * 허용하므로, 내기 사건 알림은 <b>발송 전 선점(클레임)</b> 모델을 쓴다: 사건 유니크 키
 * {@code (user_id, kind, subject_id)} 로 {@code PENDING} 행을 INSERT 해 선점하고
 * (충돌 = 남이 선점), FCM 성사 시 {@code SENT} 로 마킹한다. {@code claimed_at} 은 10분 리스,
 * {@code DEFERRED} 는 조용한 시간 이월(N44), {@code group_id}·{@code slot_at} 은 묶음
 * (유저 × 그룹 × 슬롯) 메타다(N20 — dedup 키와 분리, N41). 종전 서비스가 기록하는 행은
 * {@code kind=type}·{@code subject_id=null} 로 저장돼 사건 유니크와 충돌하지 않는다.
 */
@Entity
@Table(
        name = "notification_sent_logs",
        uniqueConstraints = @UniqueConstraint(name = "uq_notification_sent_logs_user_kind_subject",
                columnNames = {"user_id", "kind", "subject_id"}),
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
     * 발송 종류 — 내기 정산 결과(B4 → GROMO-1417 재편). 사건 단위 클레임 파이프라인이 쓴다:
     * dedup 축은 {@code (user_id, kind, subject_id=회차 id)} 선점 유니크(N41)이고, 정산 커밋
     * 직후 이벤트 + 15분 재훑기 크론이 같은 축을 공유해 이중 발송 없이 즉시성을 얻는다.
     */
    public static final String TYPE_BET_RESULT = "BET_RESULT";

    /**
     * 발송 종류 — 스크린타임 창형 챌린지의 창 종료 알림(B4). {@code target_user_id} 에 <b>챌린지 id</b>.
     * 창은 매일 반복되므로 dedup 은 (user_id, type, target_user_id) + <b>당일 sent_at</b> 으로 본다.
     */
    public static final String TYPE_CHALLENGE_WINDOW_END = "CHALLENGE_WINDOW_END";

    /**
     * 발송 종류 — 창형이 아닌(일 목표형, {@code DURATION}) 챌린지의 하루 마감 알림(GROMO-1088).
     * {@code target_user_id} 에 <b>챌린지 id</b>. 일 목표도 매일 반복이라 dedup 은 창형과 같은
     * (user_id, type, target_user_id) + <b>당일 sent_at</b> 이다.
     *
     * <p>창형이 이 타입을 쓰지 않고 {@link #TYPE_CHALLENGE_WINDOW_END} 로 남는 이유는 앱의 레거시
     * 딥링크 폴백이 그 문자열에 걸려 있기 때문이다(구 바이너리 호환 — 계약 §2).
     */
    public static final String TYPE_CHALLENGE_ENDED = "CHALLENGE_ENDED";

    /**
     * 발송 종류 — 그룹에 새 챌린지가 등록됐을 때의 그룹원 알림(GROMO-1089).
     * {@code target_user_id} 에 <b>챌린지 id</b> 를 담아 (user_id, type, target_user_id) 조합으로
     * "이 유저에게 이 챌린지 개설 알림을 이미 보냈는지"를 판정한다. 챌린지 개설은 1회성이라
     * 정상 흐름에서는 중복이 없고, 이 dedup 은 이벤트 재발행·재시도에 대한 안전망이다.
     */
    public static final String TYPE_CHALLENGE_CREATED = "CHALLENGE_CREATED";

    /**
     * 발송 종류 — 친구 요청 도착(GROMO-1090). {@code user_id} 는 요청을 <b>받은</b> 유저,
     * {@code target_user_id} 에 <b>요청을 보낸 유저 id</b> 를 담는다(행 id 를 담지 않는 이유: 거절 후
     * 재요청이 같은 friendships 행을 되살려서 행 id 로는 "같은 요청"을 식별할 수 없다).
     * dedup 은 (user_id, type, target_user_id) + <b>최근 1분 sent_at</b> — 동시에 처리된 같은 행동만
     * 접고, 별개의 재요청은 통과시키기 위한 폭이다.
     */
    public static final String TYPE_FRIEND_REQUEST = "FRIEND_REQUEST";

    /**
     * 발송 종류 — 보낸 친구 요청이 수락됨(GROMO-1090). {@code user_id} 는 요청을 <b>보냈던</b> 유저,
     * {@code target_user_id} 에 <b>수락한 유저 id</b>. dedup 기준은 요청 알림과 같다.
     */
    public static final String TYPE_FRIEND_ACCEPTED = "FRIEND_ACCEPTED";

    /**
     * 발송 종류 — 회차 무효화 + 환불 통지(GROMO-1417, N48·FR-44-4). 무효화·환불 <b>커밋 직후</b>
     * 사건 단위 파이프라인으로 나간다. {@code subject_id} = <b>회차 id</b>, 사유는 payload
     * {@code data.voidReason}(CHALLENGE_DELETED · INSUFFICIENT_PARTICIPANTS · REFUND_DEADLINE).
     * 삭제된 챌린지의 회차는 결과 모달에서 빠지므로 이 푸시가 유일한 통지 경로다(K3 해소).
     */
    public static final String TYPE_BET_VOID_REFUND = "BET_VOID_REFUND";

    /**
     * 발송 종류 — 회차 참여 모집(GROMO-1417, N40·N20). {@code subject_id} = <b>회차 id</b>.
     * 발송 슬롯은 창형이 <b>참가 마감 −30분</b>, 하루형이 <b>당일 08:00</b>이다 — 하루형의
     * 시작−30분은 전날 23:30 이라 회차 미생성(00:05 개설) + 조용한 시간에 이중으로 막힌다.
     * 조용한 시간에 걸리면 <b>이월하지 않고 버린다</b>(N44 단서 — 07:00 에 도착해봐야 참가 마감이
     * 이미 지나 "참여하세요"가 거짓말이 된다).
     */
    public static final String TYPE_CHALLENGE_SESSION_OPEN = "CHALLENGE_SESSION_OPEN";

    /**
     * 발송 종류 — 정산 직전({@code settle_after} − 15분)의 <b>사일런트</b> 푸시(GROMO-1281, FR-22).
     * data-only {@code {silent:'flush'}} 로 앱의 업로드 큐 flush 를 유도한다. 표시 푸시가 아니라
     * 묶음·조용한 시간 필터를 타지 않지만, 회차당 1회 발송은 사건 클레임({@code subject_id} =
     * 회차 id)으로 보장한다 — 5분 스캔이 15분 창을 3틱 훑기 때문이다.
     */
    public static final String TYPE_BET_SILENT_FLUSH = "BET_SILENT_FLUSH";

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

    /** 실발송 시각 — PENDING/DEFERRED 클레임 행은 아직 발송 전이라 null 이다(V45). */
    @Column(name = "sent_at")
    private Instant sentAt;

    /**
     * 사건 dedup 축의 종류(V45) — 클레임 파이프라인의 유니크 키 {@code (user_id, kind, subject_id)}
     * 첫 축. 종전 서비스 행은 {@link #prePersist()} 가 {@code type} 을 미러링한다.
     */
    @Column(nullable = false)
    private String kind;

    /** 사건 대상 id(V45) — 내기 계열은 회차 id. 종전 서비스 행은 null(유니크에서 서로 충돌하지 않는다). */
    @Column(name = "subject_id")
    private UUID subjectId;

    /** 클레임 상태(V45) — 종전 "실발송 후 기록" 행은 SENT 로 저장된다. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private NotificationSendStatus status = NotificationSendStatus.SENT;

    /** 클레임(선점) 시각(V45) — PENDING 리스 10분의 기준. */
    @Column(name = "claimed_at")
    private Instant claimedAt;

    /** 묶음 메타(V45) — 그룹 id. 묶음 키 (유저 × 그룹 × 슬롯) 의 축이며 dedup 키가 아니다(N41). */
    @Column(name = "group_id")
    private UUID groupId;

    /** 묶음 메타(V45) — 사건이 속한 시간슬롯(원래 슬롯 기준 — 이월돼도 유지, N44). */
    @Column(name = "slot_at")
    private Instant slotAt;

    @PrePersist
    void prePersist() {
        // 종전 서비스(리그·추월·창 종료 등)는 kind/status 를 모른 채 type 만 채운다 — DB NOT NULL 과
        // 사건 파이프라인 조회가 성립하도록 여기서 미러링한다.
        if (kind == null) {
            kind = type;
        }
        if (status == null) {
            status = NotificationSendStatus.SENT;
        }
    }
}
