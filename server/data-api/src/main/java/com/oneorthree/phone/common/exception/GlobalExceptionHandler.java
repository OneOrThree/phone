package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.currency.exception.CurrencyException;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.group.exception.ChallengeResultClaimHeldException;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.exception.UserException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.time.zone.ZoneRulesException;

/**
 * 전역 예외 → HTTP 응답 변환. 모든 컨트롤러의 예외가 여기를 지나 {@link ErrorResponse} 봉투
 * ({@code code}·{@code message})로 통일된다 — 앱이 {@code code} 로 분기하므로 이 봉투를 벗어나
 * 스프링 기본 {@code /error} 로 새는 예외가 생기면 그 경로의 에러 규약이 깨진다.
 *
 * <p><b>매핑은 세 갈래다.</b>
 * <ul>
 *   <li>도메인 예외(User·Focus·Group·League… 11종) — 상태 코드와 {@code code} 를 각 도메인
 *       에러코드 enum 에서 그대로 꺼낸다. 여기서는 판단하지 않고 옮기기만 한다</li>
 *   <li>프레임워크·DB 예외 — 원인 불명 500 으로 새지 않도록 의미 있는 4xx 로 강하시킨다
 *       (타입 변환 실패 400, 제약 위반·락 충돌 409)</li>
 *   <li>서버 배선 오류 — {@link LoginUserResolutionException} 만이 의도적으로 500 이다</li>
 * </ul>
 *
 * <p><b>핸들러 등록 순서는 무의미하다.</b> 스프링은 가장 <b>구체적인</b> 예외 타입의 핸들러를 고르므로,
 * 하위 타입 전용 핸들러({@code handleChallengeResultClaimHeld})가 상위({@code handleGroup})보다
 * 아래 있어도 하위가 이긴다. 반대로 {@code IllegalArgumentException} 처럼 넓은 타입을 잡는 핸들러는
 * 좁은 타입의 전용 핸들러가 없으면 예상 못 한 예외까지 삼키므로, 새로 추가할 때 이 그물에
 * 걸릴 것이 없는지 확인해야 한다.
 *
 * <p>응답 본문에는 스택트레이스·내부 클래스명·SQL 을 절대 싣지 않는다. 진단 정보는 로그로만 남긴다.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 회원 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(UserException.class)
    public ResponseEntity<ErrorResponse> handleUser(UserException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 집중 세션 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(FocusException.class)
    public ResponseEntity<ErrorResponse> handleFocus(FocusException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 재화 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(CurrencyException.class)
    public ResponseEntity<ErrorResponse> handleCurrency(CurrencyException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 토큰 검증 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<ErrorResponse> handleToken(InvalidTokenException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 인증·계정 상태 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(AuthException.class)
    public ResponseEntity<ErrorResponse> handleAuth(AuthException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 결과 표시 선점 실패(GROMO-1577 · B17) — {@link GroupException} 의 하위 타입이라 이 핸들러가
     * 없어도 아래 {@code handleGroup} 이 같은 상태·코드를 돌려준다(지연 힌트만 빠진다). 여기서는
     * <b>서버가 계산한 상대 지연</b>을 함께 실어, 앱이 폴링 없이 그 시점 1회만 다시 시도하게 한다.
     *
     * @param e 선점 실패 예외. 다른 도메인 예외와 달리 {@code getRetryAfterMs()} 를 갖고 있어
     *          이 핸들러가 존재할 이유가 된다
     * @return {@link RetryAfterErrorResponse} — 공용 봉투에 상대 지연(ms)이 더해진 형태.
     *         앱은 이 값을 보고 폴링 대신 그 시점 1회만 재시도한다
     */
    @ExceptionHandler(ChallengeResultClaimHeldException.class)
    public ResponseEntity<RetryAfterErrorResponse> handleChallengeResultClaimHeld(
            ChallengeResultClaimHeldException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new RetryAfterErrorResponse(
                        e.getErrorCode().name(), e.getMessage(), e.getRetryAfterMs()));
    }

    /**
     * 그룹·챌린지 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(GroupException.class)
    public ResponseEntity<ErrorResponse> handleGroup(GroupException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 초대 링크 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(InviteLinkException.class)
    public ResponseEntity<ErrorResponse> handleInviteLink(InviteLinkException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 친구 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(FriendException.class)
    public ResponseEntity<ErrorResponse> handleFriend(FriendException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 통계 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(StatsException.class)
    public ResponseEntity<ErrorResponse> handleStats(StatsException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 리그 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(LeagueException.class)
    public ResponseEntity<ErrorResponse> handleLeague(LeagueException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 분석 이벤트 도메인 예외 → 에러코드가 지정한 상태.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 여기 실린 에러코드 enum 이 정하므로
     *          이 핸들러 자체는 정책을 갖지 않는다 — 응답을 바꾸려면 enum 쪽을 고친다
     * @return {@code code} = 에러코드 enum 이름, {@code message} = enum 에 적힌 사용자용 문구
     */
    @ExceptionHandler(AnalyticsException.class)
    public ResponseEntity<ErrorResponse> handleAnalytics(AnalyticsException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 쿼리/경로 파라미터 타입 변환 실패(잘못된 Instant·UUID·숫자 등) → 400.
     * (원인 체인에 IllegalArgumentException 이 있어 아래 핸들러로 새면 409 가 되므로 명시적으로 우선 처리)
     *
     * @param e 변환에 실패한 파라미터 이름을 꺼내기 위해서만 쓴다 — 원인 예외 메시지는
     *          내부 타입이 드러나므로 응답에 싣지 않는다
     * @return 400 {@code INVALID_PARAMETER}. 이 핸들러가 없으면 원인 체인의
     *         {@code IllegalArgumentException} 이 잡혀 <b>409</b> 로 나가는 오분류가 생긴다
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("INVALID_PARAMETER",
                        "요청 파라미터 '" + e.getName() + "' 형식이 올바르지 않습니다."));
    }

    /**
     * {@code @LoginUser} 주입 실패 (GROMO-363) — 클라이언트가 재시도해도 고쳐지지 않는 서버 배선 오류라 500 이다.
     * 원인(어느 핸들러인지)은 로그에만 남기고 응답 본문에는 넣지 않는다 — 내부 클래스·메서드명 노출 방지.
     *
     * @param e 배선이 어디서 어긋났는지 담고 있다. 로그로만 흘리고 응답에는 넣지 않는다 —
     *          내부 클래스·메서드명이 밖으로 나가지 않게 한다
     * @return 500 {@code LOGIN_USER_RESOLUTION_FAILED}. 클라이언트가 재시도해도 풀리지 않는
     *         유일한 계열이라 4xx 로 강하시키지 않는다
     */
    @ExceptionHandler(LoginUserResolutionException.class)
    public ResponseEntity<ErrorResponse> handleLoginUserResolution(LoginUserResolutionException e) {
        log.error("@LoginUser 주입 실패 — 배선 오류", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse("LOGIN_USER_RESOLUTION_FAILED", "서버 설정 오류로 요청을 처리하지 못했습니다."));
    }

    /**
     * 어디서도 잡히지 않은 {@code IllegalArgumentException} 의 그물 → 409.
     *
     * <p><b>넓은 그물이라 주의가 필요하다.</b> 서비스가 사전 검증 실패를 이 예외로 던지는 관행 때문에
     * 409 로 두었지만, 진짜 프로그래밍 오류도 같은 타입이라 함께 409 로 나간다. 새 예외를 만들 때는
     * 전용 도메인 예외를 쓰는 편이 낫다 — 이 그물에 걸리면 상태 코드를 스스로 고를 수 없다.
     *
     * @param e 메시지를 그대로 응답에 싣는다. 따라서 이 예외를 던질 때 <b>내부 구현이 드러나는 문구를
     *          쓰면 그대로 클라이언트에게 나간다</b>
     * @return 409 {@code ILLEGAL_ARGUMENT}
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("ILLEGAL_ARGUMENT", e.getMessage()));
    }

    /**
     * 알 수 없는 타임존 id → 400. 클라이언트가 보낸 {@code Asia/Seoul} 류 문자열을
     * {@code ZoneId} 로 해석하지 못했다는 뜻이라 서버 잘못이 아니다.
     *
     * <p>{@code IllegalArgumentException} 그물에 맡기면 409 가 되므로 따로 잡는다 —
     * 잘못된 입력에 "충돌"이라고 답하면 앱이 재시도로 오해한다.
     *
     * @param e 메시지에 문제의 타임존 id 가 들어 있어 그대로 싣는다 — 클라이언트가 보낸 값이라
     *          되돌려 줘도 새는 정보가 없다
     * @return 400 {@code INVALID_TIMEZONE}
     */
    @ExceptionHandler(ZoneRulesException.class)
    public ResponseEntity<ErrorResponse> handleZoneRulesException(ZoneRulesException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("INVALID_TIMEZONE", e.getMessage()));
    }

    /**
     * DB 유니크/무결성 제약 위반 → 409. 서비스 사전 검사를 뚫은 동시 요청 레이스(TOCTOU)의 최종 폴백
     * (예: 닉네임 중복 GROMO-584). 사전 검사가 대부분 거르므로 여기 도달은 드물다.
     * ※ 자체 처리하는 곳(예: AuthService 소셜 로그인 재시도)은 여기까지 오지 않는다.
     * 전역 스코프라 예상 못 한 FK·NOT NULL 위반(실제 서버 버그)도 409 로 응답될 수 있으므로,
     * 원인을 warn 로 남겨 모니터링에서 "정상 충돌"과 "버그"를 구분할 수 있게 한다.
     *
     * @param e 위반한 제약을 담고 있다. warn 으로 남겨 "정상 충돌"과 "서버 버그"를 모니터링에서
     *          구분할 수 있게 한다 — 응답만 보면 둘이 똑같아 보이기 때문이다
     * @return 409 {@code DATA_INTEGRITY_VIOLATION}. 어떤 제약인지는 응답에 싣지 않는다 —
     *         테이블·컬럼 구조가 드러난다
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleDataIntegrityViolation(DataIntegrityViolationException e) {
        log.warn("DataIntegrityViolationException → 409 응답 (제약 위반)", e);
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("DATA_INTEGRITY_VIOLATION", "요청이 기존 데이터와 충돌합니다."));
    }

    /**
     * 낙관락(@Version — Group 정원·UserWallet 잔액) 충돌 → 409 CONCURRENT_UPDATE.
     * 예전엔 ROOM_FULL 로 응답했는데, 내기 참가·정산이 같은 지갑을 두고 경합하는 경로가 생기면서
     * 그룹 참가와 무관한 충돌까지 "정원 초과"로 보이는 오매핑이 됐다 — 전용 재시도 코드로 분리.
     * 트랜잭션은 이미 전체 롤백된 상태라 재시도하면 풀린다.
     *
     * @param e 충돌한 엔티티 정보를 담고 있으나 응답에는 쓰지 않는다 — 재시도 여부만 알리면 된다
     * @return 409 {@code CONCURRENT_UPDATE}. 트랜잭션은 이미 전체 롤백됐으므로
     *         <b>그대로 재시도하면 풀리는</b> 종류의 실패라는 신호다
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLock(OptimisticLockingFailureException e) {
        return ResponseEntity.status(GroupErrorCode.CONCURRENT_UPDATE.getStatus())
                .body(new ErrorResponse(GroupErrorCode.CONCURRENT_UPDATE.name(),
                        GroupErrorCode.CONCURRENT_UPDATE.getMessage()));
    }

    /**
     * 비관락(내기 행 FOR UPDATE — 참가·취소·정산·그룹 탈퇴 연동) 획득 실패/데드락 감지 → 같은
     * 409 CONCURRENT_UPDATE. 잠금 순서(내기 행 전부 → 지갑)를 코드로 고정해 데드락이 없도록 설계했지만,
     * DB 가 감지해 한쪽을 끊는 경우(CannotAcquireLockException 등)에도 원인 불명 500 대신 재시도 가능
     * 응답으로 강하시킨다. 트랜잭션은 전체 롤백된 상태라 재시도하면 풀린다. 설계상 없어야 할 충돌이므로
     * warn 을 남겨 모니터링에서 보이게 한다.
     *
     * @param e 락 획득 실패·데드락 감지 예외. 설계상 없어야 할 충돌이라 warn 으로 남긴다
     * @return 낙관락과 같은 409 {@code CONCURRENT_UPDATE} — 클라이언트 입장에서 대응이 같으므로
     *         (재시도) 락 종류를 구분해 알릴 이유가 없다
     */
    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handlePessimisticLock(PessimisticLockingFailureException e) {
        log.warn("PessimisticLockingFailureException → 409 응답 (행 잠금 충돌/데드락 감지)", e);
        return ResponseEntity.status(GroupErrorCode.CONCURRENT_UPDATE.getStatus())
                .body(new ErrorResponse(GroupErrorCode.CONCURRENT_UPDATE.name(),
                        GroupErrorCode.CONCURRENT_UPDATE.getMessage()));
    }
}
