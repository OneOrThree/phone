package com.oneorthree.phone.outbox.repository.domain;

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
import java.util.UUID;

/**
 * 명령 멱등 기록 — 첫 응답이 유실된 재시도에 <b>같은 봉투</b>를 재생한다 (A21 · ㊼, V51).
 *
 * <p>키의 소유자는 앱이다. {@code eventId} 를 「결정적」이라 불러도 호출자는 첫 응답을 받기 전엔 그
 * 값을 모르므로, Data 커밋 직후 응답이 유실돼 같은 {@code POST} 가 다시 오면 두 번째 트랜잭션이
 * <b>새 도메인 객체와 새 outbox 행</b>을 만든다. 그래서 앱이 재시도 간 보존하는 키를 헤더로 보내고
 * Data 가 결과와 함께 UNIQUE 로 저장해 재시도에 저장된 응답을 그대로 재생한다.
 *
 * <p><b>{@code requestFingerprint} 는 멱등 키가 아니다.</b> 계약 §3 이 요청 본문 해시를 영구 멱등
 * 키로 쓰는 것을 금지한다 — 별개의 정상 명령이 같은 본문이라는 이유로 접히기 때문이다. 이 값은
 * 「같은 키로 <b>다른</b> 본문이 왔다」를 거부하기 위한 검사값일 뿐이다.
 */
@Entity
@Table(name = "command_idempotency")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class CommandIdempotency {

    @Id
    @Column(name = "idempotency_key", nullable = false, length = 200)
    private String idempotencyKey;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "command_type", nullable = false, length = 100)
    private String commandType;

    @Column(name = "request_fingerprint", nullable = false, length = 64)
    private String requestFingerprint;

    /**
     * 재생할 응답. 명령 트랜잭션과 같은 트랜잭션에서 채워지므로 <b>커밋된 행 = 응답 있음</b> 이다 —
     * 그래서 재생 경로는 「응답이 아직 없는 커밋된 행」을 만날 수 없다.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "response_body")
    private String responseBody;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * 명령 실행 결과를 채운다 — 선점 INSERT 와 같은 트랜잭션 안에서만 부른다.
     *
     * @param body 재생할 응답 JSON
     */
    public void completeWith(String body) {
        this.responseBody = body;
    }
}
