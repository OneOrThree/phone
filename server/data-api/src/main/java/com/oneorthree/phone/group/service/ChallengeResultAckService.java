package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.dto.ChallengeResultClaimResponse;
import com.oneorthree.phone.group.exception.ChallengeResultClaimHeldException;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository.ClaimStateView;
import com.oneorthree.phone.group.event.BetResultAcknowledgedEvent;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.fasterxml.uuid.Generators;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * 결과 모달의 <b>표시 선점(claim)과 확인 표시(ack)</b> — 쓰기 축 (GROMO-1577 · policy N58·B17 ·
 * IA §4.3). 조회 축({@link GroupBetQueryService})과 분리한 이유는 여기가 순수 읽기가 아니라
 * <b>조건부 원자 UPDATE 로 경쟁을 판정하는</b> 경로이고, 그 규율(무엇을 같은 UPDATE 조건에 넣는가)이
 * 이 클래스의 존재 이유 전부이기 때문이다.
 *
 * <p><b>선점과 확인은 다른 상태다 — 하나로 합치면 어느 쪽으로도 샌다(IA §4.3).</b>
 * <ul>
 *   <li><b>노출 먼저, ack 나중</b>만 두면 {@code acknowledged_at IS NULL} 원자 UPDATE 가 쓰기 하나를
 *       막을 뿐 이미 뜬 모달 둘을 되돌리지 못한다 — 서버 가드를 두고도 결과가 두 번 보인다.</li>
 *   <li><b>ack 먼저, 노출 나중</b>이면 CAS 성공 직후 렌더가 중단될 때 서버에는 확인된 것으로 남아
 *       <b>어느 기기에서도 다시 못 본다</b>. ack 는 되돌릴 수 없어 이쪽이 더 나쁘다.</li>
 * </ul>
 * 그래서 만료가 있는 <b>선점</b>(이 클래스의 {@code claimDisplay})으로 렌더할 기기를 하나로 좁히고,
 * <b>확인</b>은 노출이 실제로 일어난 뒤에 한다.
 *
 * <p><b>선점 성공은 시간이 지나면 무효가 된다</b> — 그래서 {@code claimDisplay} 는 토큰을 함께 받으면
 * <b>렌더 직전 재검증 + 리스 연장</b>으로 동작한다(같은 쓰기 하나). 정지됐다 깨어난 기기가 낡은
 * 성공 응답만 믿고 모달을 띄우는 경로를 여기서 막는다.
 *
 * <p><b>둘 다 {@code acknowledged_at IS NULL} 을 같은 UPDATE 조건에 넣는다</b>(B17) — 두 기기가 함께
 * {@code acknowledged=false} 를 조회한 뒤 A 가 {@code claim → 노출 → ack} 를 끝내도 B 의 메모리에는
 * 미확인 DTO 가 남아 나중에 claim 을 부를 수 있다. 선점에서 ack 여부를 보지 않으면 B 가 <b>유효한
 * 새 선점</b>을 받아 같은 결과를 다시 렌더한다. IA §4.3 이 수용한 것은 ack 가 <b>실패</b>했을 때의
 * 좁은 창이지 성공한 뒤의 중복이 아니다.
 */
@Service
@RequiredArgsConstructor
public class ChallengeResultAckService {

    /**
     * 표시 선점(lease) 수명 — <b>2분</b>(계약 V1). 알림 클레임의 10분
     * ({@code BetEventNotificationService.CLAIM_LEASE})은 <b>워커</b> 축이라 죽은 배치를 회수하는 데
     * 그만큼 걸려도 사람이 기다리지 않지만, 결과 모달은 <b>사람이 보는 것</b>이라 선점한 기기가
     * 렌더 전에 죽으면 다른 기기가 빨리 회수해야 한다. 반대로 렌더~ack 왕복(수 초)보다는 넉넉히 길다.
     */
    static final Duration DISPLAY_CLAIM_LEASE = Duration.ofMinutes(2);

    private final UserQueryService userQueryService;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;
    private final ApplicationEventPublisher eventPublisher;

    /**
     * 결과 표시 선점 — 성공한 기기만 모달을 렌더한다. 실패는 영구 거절이 아니라 "이번엔 건너뛴다"이고
     * (리스가 만료되면 다시 후보), 응답에 <b>상대 지연</b>을 실어 앱이 폴링 없이 그 시점 1회만 다시
     * 시도하게 한다.
     *
     * <p>{@code currentToken} 이 있으면 <b>최초 획득이 아니라 재검증 + 리스 연장</b>이다(아래
     * {@link #renewClaim} 참조). 없으면 지금까지와 같은 최초 획득이다 — 바디 없는 호출이 그대로
     * 동작해야 한다(additive).
     *
     * <p><b>시각 인자가 없다.</b> 리스의 기록·만료·남은 지연을 전부 DB 시계가 정하므로 호출자가
     * 시계를 줄 자리가 없다(그게 이 경로의 계약이다 — 인스턴스 시계가 섞이면 시계가 빠른 쪽이 남의
     * 방금 만든 선점을 즉시 회수한다).
     *
     * @param userId 요청자 — 선점은 유저별이라 같은 회차라도 다른 멤버의 모달과 경합하지 않는다
     * @param sessionId 결과를 띄울 회차
     * @param currentToken 렌더 직전 재검증할 내 선점 토큰 — {@code null} 이면 최초 획득
     * @return 이 기기가 결과를 띄워도 된다는 증표. 재검증이면 <b>같은 토큰</b>이 그대로 돌아온다 —
     *     토큰을 회전시키면 갱신 응답이 유실됐을 때 ack 까지 막힌다
     * @throws UserException                   {@code USER_NOT_FOUND} — 요청자 유저 부재(재로그인)
     * @throws GroupException                    {@code BET_NOT_FOUND} — 그 회차의 내 참가 행 없음 /
     *                                           {@code RESULT_ALREADY_ACKED} — 이미 확인된 결과 /
     *                                           {@code RESULT_NOT_SETTLED} — 아직 정산 전
     * @throws ChallengeResultClaimHeldException {@code RESULT_CLAIM_HELD} — 남의 리스가 살아 있거나
     *                                           내 선점이 이미 남에게 넘어갔음
     */
    @Transactional
    public ChallengeResultClaimResponse claimDisplay(UUID userId, UUID sessionId, UUID currentToken) {
        requireActiveUser(userId);
        return currentToken == null ? acquireClaim(userId, sessionId)
                : renewClaim(userId, sessionId, currentToken);
    }

    /** 최초 획득 — 비어 있거나 리스가 만료된 선점을, <b>이미 결과가 된 회차에 한해</b> 가져온다. */
    private ChallengeResultClaimResponse acquireClaim(UUID userId, UUID sessionId) {
        lockParticipantRow(userId, sessionId);
        UUID token = Generators.timeBasedEpochRandomGenerator().generate();
        int claimed = groupChallengeBetParticipantRepository.claimDisplay(
                sessionId, userId, token, DISPLAY_CLAIM_LEASE.toSeconds(),
                GroupBetStatus.RESULT_STATUS_NAMES);
        if (claimed == 1) {
            return new ChallengeResultClaimResponse(token);
        }
        return failClaim(userId, sessionId);
    }

    /**
     * 렌더 직전 재검증 + 리스 연장 — <b>선점 성공은 시간이 지나면 무효가 된다</b>(IA §4.3).
     * A 가 선점 직후 OS 에 정지돼 렌더 전에 멈추고 리스가 만료된 뒤 B 가 재선점했는데, A 가 깨어나
     * <b>최초 성공 응답만 믿고</b> 모달을 띄우면 두 기기가 모두 렌더한다 — 그 뒤의
     * {@code acknowledged_at IS NULL} 은 이미 뜬 모달을 되돌리지 못한다.
     *
     * <p>검증과 연장은 <b>한 번의 쓰기</b>다 — 검증 응답을 받은 뒤 모달이 실제로 마운트되기까지도
     * 시간이 있어, 따로 두면 그 사이에 리스가 만료되는 TOCTOU 가 그대로 남는다.
     *
     * <p>성공 시 <b>같은 토큰</b>을 돌려준다(회전하지 않는다) — 회전시키면 갱신 응답이 유실됐을 때
     * 앱이 든 토큰이 영구히 낡은 값이 되어 ack 까지 막힌다.
     */
    private ChallengeResultClaimResponse renewClaim(UUID userId, UUID sessionId, UUID currentToken) {
        lockParticipantRow(userId, sessionId);
        int renewed = groupChallengeBetParticipantRepository.renewDisplayClaim(
                sessionId, userId, currentToken, GroupBetStatus.RESULT_STATUS_NAMES);
        if (renewed == 1) {
            return new ChallengeResultClaimResponse(currentToken);
        }
        return failClaim(userId, sessionId);
    }

    /**
     * 0 행의 이유를 갈라 던진다 — 판정용 읽기일 뿐, 선점 자체는 조건부 UPDATE 하나로 이미 끝났다.
     * 재검증 경로의 <b>토큰 불일치</b>도 여기로 온다: 내 선점이 남에게 넘어갔다는 뜻이라
     * {@code RESULT_CLAIM_HELD} 다(현 소유자의 남은 리스가 상대 지연이 된다).
     *
     * <p>순서가 의미를 정한다 — <b>아직 결과가 아님</b>을 리스 판정보다 먼저 본다. 정산 전 회차를
     * {@code RESULT_CLAIM_HELD} 로 접으면 {@code retryAfterMs} 가 "곧 다시 시도하라"는 신호가 돼
     * 앱이 헛된 재시도를 한다(선점자가 없으니 지연은 0으로 계산된다).
     */
    private ChallengeResultClaimResponse failClaim(UUID userId, UUID sessionId) {
        ClaimStateView state = readClaimState(userId, sessionId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        if (state.getChallengeDeletedAt() != null) {
            // 삭제된 챌린지의 회차는 조회에 아예 실리지 않는다(N48) — 앱 입장에서 이 후보는
            // "없는 것"이라 참가 행 부재와 같은 404 로 접는다. 새 코드를 만들지 않는 이유:
            // 어느 쪽이든 앱의 처리가 "큐에서 뺀다"로 같고, 409+retryAfterMs 로 접으면 오히려
            // 헛된 재시도를 부른다.
            throw new GroupException(GroupErrorCode.BET_NOT_FOUND);
        }
        if (state.getAcknowledgedAt() != null) {
            throw new GroupException(GroupErrorCode.RESULT_ALREADY_ACKED);
        }
        if (!isResult(state)) {
            throw new GroupException(GroupErrorCode.RESULT_NOT_SETTLED);
        }
        // 남은 리스는 DB 가 계산해 준 값이다 — 여기서 Instant.now() 를 섞으면 시계 축이 다시 갈린다.
        throw new ChallengeResultClaimHeldException(state.getRetryAfterMs());
    }

    /**
     * 조건부 UPDATE <b>앞에</b> 참가 행 잠금을 잡는다 — 리스 시각이 "잠금을 기다린 뒤"의 벽시각으로
     * 찍히게 하는 유일한 방법이다. Postgres 는 UPDATE 의 SET 식을 잠금 대기 <b>전에</b> 계산하므로
     * {@code clock_timestamp()} 만으로는 대기 시간만큼 과거로 찍힌다(리포지토리 주석의 실측).
     * 행이 없으면 아무것도 잠그지 않고 지나간다 — 뒤따르는 UPDATE 가 0행으로 같은 결론을 낸다.
     */
    private void lockParticipantRow(UUID userId, UUID sessionId) {
        groupChallengeBetParticipantRepository.lockForDisplayClaim(sessionId, userId);
    }

    private Optional<ClaimStateView> readClaimState(UUID userId, UUID sessionId) {
        return groupChallengeBetParticipantRepository.findClaimStateBySessionIdAndUserId(
                sessionId, userId, DISPLAY_CLAIM_LEASE.toSeconds());
    }

    /** 결과로 치는 회차인가 — OPEN(정산 전)·UNUSED(0명 종료)는 선점·확인 대상이 아니다. */
    private boolean isResult(ClaimStateView state) {
        return GroupBetStatus.RESULT_STATUS_NAMES.contains(state.getSessionStatus());
    }

    /**
     * 결과 확인 표시(ack) — <b>노출이 실제로 일어난 뒤</b>에 호출된다(D8: slot → 선점 → 검증 →
     * 노출 → ack). 대상 행 없음·이미 확인됨·중복 호출은 전부 no-op 으로 성공 처리한다(멱등).
     *
     * @param userId 요청자 — 확인 표시는 유저별이라 다른 멤버의 모달 큐에는 영향이 없다
     * @param sessionId 확인 처리할 회차 — 성사되면 아직 안 나간 결과 푸시 클레임도 함께 닫는다
     *     (안 닫으면 이미 본 결과의 푸시가 한참 뒤에 도착한다)
     * @param claimToken 선점 때 받은 토큰. {@code null} 이면 어떤 행도 갱신하지 못한다
     * @throws GroupException {@code RESULT_CLAIM_STALE} — 토큰이 현재 선점과 다르다(만료 후 재선점)
     */
    @Transactional
    public void acknowledge(UUID userId, UUID sessionId, UUID claimToken) {
        acknowledge(userId, sessionId, claimToken, Instant.now());
    }

    /**
     * 테스트에서 고정 시각을 주입하기 위한 package-private 오버로드. 트랜잭션은 public 진입점이 연다.
     *
     * <p><b>{@code now} 의 범위가 좁다</b> — 확인 시각({@code acknowledged_at})은 선점과 같은 DB
     * 시계로 찍히므로 이 값이 아니다. 여기 쓰이는 곳은 <b>알림 클레임 종결·tombstone</b> 뿐이고,
     * 그쪽은 알림 파이프라인이 원래 인스턴스 시각을 쓰는 축이라 그대로 둔다.
     */
    @Transactional
    void acknowledge(UUID userId, UUID sessionId, UUID claimToken, Instant now) {
        int acknowledged = claimToken == null ? 0 : groupChallengeBetParticipantRepository
                .acknowledge(sessionId, userId, claimToken, GroupBetStatus.RESULT_STATUS_NAMES);
        if (acknowledged == 0) {
            // 대상이 없거나 이미 확인된 경우는 멱등 no-op(중복·동시 호출 포함). 나머지 둘만 거절한다:
            // ① 아직 결과가 아닌 회차 — 여기서 확인 표시가 찍히면 나중에 정산됐을 때 그 결과를 어느
            //    기기에서도 못 본다(V49 백필을 결과 4종으로 좁힌 것과 같은 사고).
            // ② 행이 살아 있는데 토큰이 다르다 — 내 선점이 만료돼 다른 기기가 재선점한 상황이라,
            //    여기서 확인 처리하면 그 기기가 띄우려던 결과를 삼킨다.
            ClaimStateView state = readClaimState(userId, sessionId).orElse(null);
            if (state == null || state.getAcknowledgedAt() != null) {
                return;
            }
            throw new GroupException(isResult(state)
                    ? GroupErrorCode.RESULT_CLAIM_STALE : GroupErrorCode.RESULT_NOT_SETTLED);
        }
        // 확인한 결과의 푸시를 억제한다(B17) — 이미 있는 미발송 클레임을 닫고, 아직 없으면
        // tombstone 을 남겨 나중에 오는 클레임까지 막는다. 클레임을 만드는 리스너가
        // AFTER_COMMIT + @Async 라 ack 이 먼저 끝날 수 있어, "지금 있는 것"만 닫으면 순서가
        // 뒤집힌 경우에 이미 본 결과의 푸시가 그대로 나간다.
        //
        // 알림 서비스를 직접 부르지 않고 이벤트로 알리는 이유는 의존 방향뿐이다(GROMO-1656) —
        // group 이 notification 을 참조하면 순환이 된다. 소비자는 @EventListener(동기)라
        // 이 트랜잭션 안에서 지금 돌고, 실패하면 ack 도 함께 롤백된다 — 종전 직접 호출과 성질이 같다.
        // 커밋 이후로 미루면 그 지연 동안 5분 주기 발송 크론이 끼어든다(소비자 Javadoc 참조).
        eventPublisher.publishEvent(new BetResultAcknowledgedEvent(userId, sessionId, now));
    }

    /**
     * 정본 ack 상태 조회 — <b>알림 서버의 자기 수렴 경로</b>다 (A22 ⓓ · 조회 3종의 두 번째).
     *
     * <p>없으면 영구 억제가 실재한다: {@code HELD} 리스 만료는 {@code NEEDS_CONFIRM} 으로 넘어가
     * flush 가 계속 건너뛰는데, 해제는 {@code commit} · {@code abort} · <b>이 조회</b> 세 길뿐이다.
     * 「롤백 직후 프로세스가 죽는 구간」에서는 abort 행이 안 생기므로 이 조회가 <b>유일한 탈출구</b>다.
     *
     * <p><b>행이 없어도 예외가 아니다.</b> 「아직 확인되지 않았다」와 「그 참가가 없다」는 억제를
     * 푸는 쪽에서는 결론이 같고, 여기서 404 를 던지면 수렴 경로가 그 예외에 막힌다.
     *
     * @param userId    확인 주체
     * @param sessionId 회차
     * @return 확인 여부와 시각. 행이 없으면 「미확인」
     */
    @Transactional(readOnly = true)
    public ResultAckState readAckState(UUID userId, UUID sessionId) {
        return readClaimState(userId, sessionId)
                .map(state -> new ResultAckState(state.getAcknowledgedAt() != null, state.getAcknowledgedAt()))
                .orElseGet(() -> new ResultAckState(false, null));
    }

    /**
     * 정본 ack 상태.
     *
     * @param acknowledged   확인 표시가 찍혔는가
     * @param acknowledgedAt 확인 시각. 미확인이면 {@code null}
     */
    public record ResultAckState(boolean acknowledged, Instant acknowledgedAt) {
    }

    /** 조회 축과 같은 락 없는 활성 검증(GROMO-1230) — 잠글 대상은 참가 행이지 유저 행이 아니다. */
    private void requireActiveUser(UUID userId) {
        userQueryService.getCaller(userId);
    }
}
