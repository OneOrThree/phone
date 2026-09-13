package com.oneorthree.phone.outbox.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 내구 이벤트 봉투 — 명령 트랜잭션이 도메인 변경과 <b>같은 트랜잭션에서</b> 적는 행 (A21, V51).
 *
 * <p><b>왜 필요한가.</b> Business API 는 DB 가 없고 쓰기 트랜잭션은 Data API 가 소유한다. 그래서
 * Data 커밋 직후 HTTP 응답이 유실되거나 Business 가 죽으면 <b>도메인 상태만 바뀌고 이벤트는 생기지
 * 않는다</b>. 이건 브로커 발행 실패(A18)보다 앞선 구간이라 발행 주체는 「재발행할 게 있다」는 사실조차
 * 모른다. 친구 요청·챌린지 개설 같은 요청형은 리컨실로도 복구되지 않으므로, 봉투를 커밋과 함께
 * 남기고 발행은 이 행을 읽어서 한다.
 *
 * <p><b>이 엔티티는 불변이다.</b> 한 번 쓰면 고치지 않는다 — 전달 상태는 전부
 * {@link EventOutboxDelivery} 에 있다. 그래서 {@code event_outbox_deliveries} 가 순서 축
 * 세 컬럼을 복제해도 낡을 수 없다.
 */
@Entity
@Table(name = "event_outbox")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class EventOutbox {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /**
     * 결정적 사건 키 — 소비 측 dedup 의 유일한 근거다. UNIQUE 라 같은 키의 재기록은 만들 수 없다.
     *
     * <p>수신자가 여럿인 사건은 <b>수신자별로 펼친</b> 뒤 {@code <사건키>:<userId>} 로 안정적인 키를
     * 준다(㊢) — 봉투에 {@code userId} 가 하나뿐이라 fan-out 을 한 건으로 보내면 수신 측이 대상을
     * 알아낼 방법이 없어 그룹원 푸시가 통째로 누락된다.
     */
    @Column(name = "event_id", nullable = false, length = 200)
    private String eventId;

    /**
     * 스키마 호환용 버전(ⓦ) — 순서용 {@link #version} 과 <b>다른 값</b>이며 둘 다 필수다.
     * additive-only · 소비자 선배포 · 제거는 다음 릴리즈 규칙이 이 값에 걸린다.
     */
    @Column(name = "schema_version", nullable = false)
    private int schemaVersion;

    @Column(nullable = false, length = 100)
    private String type;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    /** 예약 발송 사건의 발송 예정 시각. 즉시 사건은 {@code null}. */
    @Column(name = "scheduled_at")
    private Instant scheduledAt;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /**
     * 렌더 로케일. <b>미보고 유저는 {@code null}</b> 이고 수신 측이 ko 로 폴백한다 — 여기서 ko 를
     * 박으면 「보고받은 ko」와 「모름」이 구분되지 않는다.
     */
    @Column(length = 35)
    private String locale;

    /**
     * 사건 대상의 정규 식별자. 컬렉션 투영의 역순 적용은 <b>{@code (userId, subjectId)} 별 최대
     * version</b> 으로 막는다(A21) — 유저 단위 최대값 하나로 뭉치면 지연 도착한 다른 subject 의
     * 사건이 「오래된 것」으로 폐기된다.
     *
     * <p>uuid 가 아니라 문자열인 이유: 링크 멤버십 전이처럼 복합 키를 정규 문자열로 싣는 자리가 있다.
     */
    @Column(name = "subject_id", length = 200)
    private String subjectId;

    /** 순서 축이자 {@link #version} 을 발급한 aggregate 의 종류. */
    @Column(name = "aggregate_type", nullable = false, length = 60)
    private String aggregateType;

    /** 순서 축의 식별자 — 유저 축은 userId, 링크 멤버십 전이는 {@code "<groupId>:<inviterId>"}. */
    @Column(name = "aggregate_id", nullable = false, length = 200)
    private String aggregateId;

    /**
     * <b>aggregate 행 잠금 아래</b> 발급된 단조 증가 값(㊸). 시퀀스를 그대로 쓰면 안 된다 — 시퀀스는
     * 번호 할당 순서만 보장하고 커밋 순서를 보장하지 않아, 같은 유저의 T1 이 10 을 받고 멈춘 사이
     * T2 가 11 을 커밋·발행한 뒤 T1 이 마지막에 커밋하면 최종 상태는 T1 인데 소비자는 최대값 11 때문에
     * 이벤트 10 을 폐기한다.
     */
    @Column(nullable = false)
    private long version;

    /** 사건별 발송 입력. 소비자는 모르는 필드를 무시한다(ⓦ ⓓ). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> params;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * {@code params} 의 방어 복사본 — 저장된 봉투를 호출부가 뒤에서 고칠 수 없게 한다.
     *
     * @return 순서를 보존한 복사본. 저장 시 {@code null} 이 들어올 수 없으므로 빈 맵은 「필드가 없는
     *     사건」을 뜻한다
     */
    public Map<String, Object> getParams() {
        return params == null ? Map.of() : new LinkedHashMap<>(params);
    }
}
