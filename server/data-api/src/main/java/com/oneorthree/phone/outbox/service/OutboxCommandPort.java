package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.IdempotencyRequest;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;

import java.util.Collection;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 도메인 명령이 쓰는 <b>공개 포트</b> — 내구 이벤트·명령 기반의 전부다 (A21, GROMO-1659/1660 공통).
 *
 * <p>producer 쪽 배선은 이 인터페이스 하나만 본다. 저장 모양(테이블 넷)·발행 경로(Kafka/HTTP)·
 * 리스·백오프는 전부 이 뒤에 있다.
 *
 * <h2>세 가지를 한다</h2>
 * <ol>
 *   <li>{@link #append(OutboxAppendCommand)} — 도메인 변경과 <b>같은 트랜잭션에서</b> 봉투를 적는다.
 *   <li>{@link #allocateVersion(AggregateRef)} — aggregate 행 잠금 아래 순서용 version 을 발급한다.
 *   <li>{@link #runIdempotent} — 명령 결과를 키로 저장하고 재시도에 <b>같은 봉투</b>를 재생한다.
 * </ol>
 *
 * <h2>호출 규약 — 전부 {@code @Transactional} 안에서</h2>
 * 모든 메서드가 {@code Propagation.MANDATORY} 다. 트랜잭션 밖에서 부르면 즉시 예외로 죽는다 —
 * 「커밋과 함께 남는다」가 계약이라, 밖에서 불려 조용히 별도 트랜잭션으로 커밋되면 <b>도메인이
 * 롤백돼도 이벤트만 남는</b> 정확히 반대 방향의 유실이 생긴다.
 *
 * <p><b>외부 호출은 이 포트가 하지 않는다.</b> 실제 발행은 relay 잡이 트랜잭션 밖에서 한다 —
 * 명령 트랜잭션 안에서 브로커·HTTP 를 기다리면 그 지연만큼 DB 잠금이 늘어지고, 실패가 도메인
 * 커밋을 되돌린다.
 */
public interface OutboxCommandPort {

    /**
     * 봉투를 적는다 — <b>호출부의 도메인 트랜잭션과 같은 트랜잭션</b>이어야 한다.
     *
     * <p>{@code version} 은 여기서 {@link #allocateVersion(AggregateRef)} 로 발급되고 요청의 순서 축을
     * 잠근다. 같은 축의 두 명령은 이 지점에서 직렬화된다.
     *
     * <p>같은 {@code eventId} 로 두 번 부르면 UNIQUE 위반으로 실패한다. 결정적 키를 쓰는 사건의
     * 「이미 있으면 그대로 둔다」는 호출부가 판단할 일이다 — 여기서 조용히 삼키면 params 가 달라진
     * 재기록이 소리 없이 무시된다.
     *
     * @param command 적을 봉투와 나갈 대상들
     * @return 저장된 완성 봉투 — {@code eventId}·{@code version} 이 채워져 있어 명령 응답에 그대로
     *     실을 수 있다(㉵)
     */
    EventEnvelope append(OutboxAppendCommand command);

    /**
     * 봉투를 적되 {@code version} 을 <b>도메인 행이 이미 발급한 값</b>으로 쓴다 — {@code aggregate_versions} 를
     * 건드리지 않는다 (GROMO-1953).
     *
     * <p>외양·재생처럼 도메인 행 자체가 잠금 아래 version 을 매기는 축 전용이다. 거기에 발급 축을 하나 더 두면
     * 시계가 둘이 되어 공개 {@code payload.version} 과 봉투 {@code version} 이 어긋난다. 호출부는 그 도메인 행을
     * <b>이 트랜잭션에서 배타 잠근 채</b> 불러야 한다 — 그 잠금이 곧 {@link #append(OutboxAppendCommand)} 의
     * aggregate 잠금 역할이라, 번호 순서가 커밋 순서가 된다.
     *
     * <p>한 축에 두 경로를 섞지 않는다. {@code aggregate_versions} 가 발급하는 축(USER·LINK_MEMBERSHIP 등)에 쓰면
     * 두 번호가 부딪혀 {@code uq_event_outbox_aggregate_version} 에 걸린다.
     *
     * @param command       적을 봉투와 나갈 대상들
     * @param domainVersion 도메인 행이 발급한 단조 증가 값(1부터)
     * @return 저장된 완성 봉투
     */
    EventEnvelope append(OutboxAppendCommand command, long domainVersion);

    /**
     * 순서 축의 <b>현재</b> version 을 행 잠금 아래 읽는다 — 번호를 올리지 않는다(행이 없으면 0).
     *
     * <p>스냅샷 응답이 「이 version 이후 사건만 적용하라」는 경계를 줄 때 쓴다. 잠그는 이유: 잠그지 않고 읽으면
     * 진행 중인 명령이 커밋하기 전 값을 돌려줘, 그 명령의 사건이 경계 아래로 떨어져 버려진다.
     *
     * @param aggregate 순서 축
     * @return 마지막으로 발급된 값. 아직 발급 전이면 0
     */
    long currentVersion(AggregateRef aggregate);

    /**
     * 순서용 version 을 발급한다 — <b>aggregate 행을 배타 잠금</b>한 채로.
     *
     * <p>{@link #append} 가 내부에서 부르므로 보통은 직접 쓸 일이 없다. 한 트랜잭션에서 같은 축의
     * 봉투를 여러 개 적으면 호출마다 다음 번호가 나온다.
     *
     * <p>잠금은 <b>호출한 트랜잭션이 끝날 때까지</b> 유지된다. 그래서 번호 순서가 곧 커밋 순서다 —
     * 시퀀스로는 이 성질을 못 얻는다(㊸).
     *
     * @param aggregate 순서 축
     * @return 새로 발급된 단조 증가 값(1부터)
     */
    long allocateVersion(AggregateRef aggregate);

    /**
     * 여러 USER aggregate 행을 <b>정본 순서로 한 번에</b> 배타 잠금한다 — 번호는 발급하지 않는다 (GROMO-893).
     *
     * <p>한 트랜잭션에서 여러 사용자의 봉투를 적는 fan-out 이 적기 «전»에 부른다. 수신자마다
     * {@link #allocateVersion} 을 루프 순서대로 부르면 순서가 다른 두 트랜잭션이 A→B · B→A 로 교착한다.
     * 이미 이 트랜잭션이 쥔 행은 건너뛴다.
     *
     * @param userIds 잠글 사용자 — 중복·순서 무관
     */
    void lockUserAggregates(Collection<UUID> userIds);

    /**
     * 멱등 키로 명령을 한 번만 실행하고, 재시도에는 저장된 응답을 재생한다.
     *
     * <p>같은 키로 <b>다른 본문</b>이 오면 {@code IDEMPOTENCY_KEY_CONFLICT} 로 거부한다 — 키를 재사용한
     * 별개 명령이 남의 응답을 재생받는 사고를 막는다.
     *
     * <p>선점 INSERT 와 결과 저장이 <b>명령과 같은 트랜잭션</b>이므로, 명령이 롤백되면 멱등 기록도
     * 함께 사라져 다음 시도가 정상적으로 다시 실행된다.
     *
     * @param request      키·주체·본문 지문
     * @param responseType 응답 타입 — 재생 시 저장된 JSON 을 이 타입으로 되살린다
     * @param command      실제 명령. 재생 경로에서는 <b>부르지 않는다</b>
     * @param <T>          응답 타입
     * @return 값과 「재생인가」
     */
    <T> IdempotentOutcome<T> runIdempotent(IdempotencyRequest request, Class<T> responseType, Supplier<T> command);

    /**
     * 탈퇴자 봉투 속 개인정보 한 필드를 null 로 대체한다 — 봉투 불변의 <b>유일한 예외</b>이며 탈퇴 트랜잭션 전용이다
     * (GROMO-1946 · 계정 LLD §4 「outbox 속 name」).
     *
     * <p>다시 나가지 않는 행(전달 완료)과 아직 한 번도 나가지 않은 행만 고친다. 시도했지만 미완료인 행은 같은
     * 본문으로 재전달돼야 하므로 그대로 둔다 — 본문이 바뀐 재전달은 소비자의 {@code eventId} 대조에서 영구 실패가
     * 되고, 고갈 처리가 없는 relay(A18)에서 그 축 전체를 막는다. 판정은
     * {@code EventOutboxDeliveryRepository#eraseParamOfResendSafe} 에 있다.
     *
     * @param userId   봉투 주체 — {@code event_outbox.user_id} 가 이 값인 행만 대상이다
     * @param type     사건 종류
     * @param paramKey 대체할 {@code params} 키
     * @return 고친 봉투 수
     */
    int eraseWithdrawnParam(UUID userId, String type, String paramKey);
}
