package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.analytics.exception.AnalyticsException;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.exception.InvalidTokenException;
import com.oneorthree.phone.common.auth.LoginUserResolutionException;
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

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(UserException.class)
    public ResponseEntity<ErrorResponse> handleUser(UserException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(FocusException.class)
    public ResponseEntity<ErrorResponse> handleFocus(FocusException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(CurrencyException.class)
    public ResponseEntity<ErrorResponse> handleCurrency(CurrencyException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<ErrorResponse> handleToken(InvalidTokenException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<ErrorResponse> handleAuth(AuthException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    /**
     * 결과 표시 선점 실패(GROMO-1577 · B17) — {@link GroupException} 의 하위 타입이라 이 핸들러가
     * 없어도 아래 {@code handleGroup} 이 같은 상태·코드를 돌려준다(지연 힌트만 빠진다). 여기서는
     * <b>서버가 계산한 상대 지연</b>을 함께 실어, 앱이 폴링 없이 그 시점 1회만 다시 시도하게 한다.
     */
    @ExceptionHandler(ChallengeResultClaimHeldException.class)
    public ResponseEntity<RetryAfterErrorResponse> handleChallengeResultClaimHeld(
            ChallengeResultClaimHeldException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new RetryAfterErrorResponse(
                        e.getErrorCode().name(), e.getMessage(), e.getRetryAfterMs()));
    }

    @ExceptionHandler(GroupException.class)
    public ResponseEntity<ErrorResponse> handleGroup(GroupException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(InviteLinkException.class)
    public ResponseEntity<ErrorResponse> handleInviteLink(InviteLinkException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(FriendException.class)
    public ResponseEntity<ErrorResponse> handleFriend(FriendException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(StatsException.class)
    public ResponseEntity<ErrorResponse> handleStats(StatsException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(LeagueException.class)
    public ResponseEntity<ErrorResponse> handleLeague(LeagueException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    @ExceptionHandler(AnalyticsException.class)
    public ResponseEntity<ErrorResponse> handleAnalytics(AnalyticsException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus())
                .body(new ErrorResponse(e.getErrorCode().name(), e.getMessage()));
    }

    // 쿼리/경로 파라미터 타입 변환 실패(잘못된 Instant·UUID·숫자 등) → 400.
    // (원인 체인에 IllegalArgumentException 이 있어 아래 핸들러로 새면 409 가 되므로 명시적으로 우선 처리)
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("INVALID_PARAMETER",
                        "요청 파라미터 '" + e.getName() + "' 형식이 올바르지 않습니다."));
    }

    // @LoginUser 주입 실패 (GROMO-363) — 클라이언트가 재시도해도 고쳐지지 않는 서버 배선 오류라 500 이다.
    // 원인(어느 핸들러인지)은 로그에만 남기고 응답 본문에는 넣지 않는다 — 내부 클래스·메서드명 노출 방지.
    @ExceptionHandler(LoginUserResolutionException.class)
    public ResponseEntity<ErrorResponse> handleLoginUserResolution(LoginUserResolutionException e) {
        log.error("@LoginUser 주입 실패 — 배선 오류", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse("LOGIN_USER_RESOLUTION_FAILED", "서버 설정 오류로 요청을 처리하지 못했습니다."));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("ILLEGAL_ARGUMENT", e.getMessage()));
    }

    @ExceptionHandler(ZoneRulesException.class)
    public ResponseEntity<ErrorResponse> handleZoneRulesException(ZoneRulesException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("INVALID_TIMEZONE", e.getMessage()));
    }

    // DB 유니크/무결성 제약 위반 → 409. 서비스 사전 검사를 뚫은 동시 요청 레이스(TOCTOU)의 최종 폴백
    // (예: 닉네임 중복 GROMO-584). 사전 검사가 대부분 거르므로 여기 도달은 드물다.
    // ※ 자체 처리하는 곳(예: AuthService 소셜 로그인 재시도)은 여기까지 오지 않는다.
    // 전역 스코프라 예상 못 한 FK·NOT NULL 위반(실제 서버 버그)도 409 로 응답될 수 있으므로,
    // 원인을 warn 로 남겨 모니터링에서 "정상 충돌"과 "버그"를 구분할 수 있게 한다.
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleDataIntegrityViolation(DataIntegrityViolationException e) {
        log.warn("DataIntegrityViolationException → 409 응답 (제약 위반)", e);
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("DATA_INTEGRITY_VIOLATION", "요청이 기존 데이터와 충돌합니다."));
    }

    // 낙관락(@Version — Group 정원·UserWallet 잔액) 충돌 → 409 CONCURRENT_UPDATE.
    // 예전엔 ROOM_FULL 로 응답했는데, 내기 참가·정산이 같은 지갑을 두고 경합하는 경로가 생기면서
    // 그룹 참가와 무관한 충돌까지 "정원 초과"로 보이는 오매핑이 됐다 — 전용 재시도 코드로 분리.
    // 트랜잭션은 이미 전체 롤백된 상태라 재시도하면 풀린다.
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLock(OptimisticLockingFailureException e) {
        return ResponseEntity.status(GroupErrorCode.CONCURRENT_UPDATE.getStatus())
                .body(new ErrorResponse(GroupErrorCode.CONCURRENT_UPDATE.name(),
                        GroupErrorCode.CONCURRENT_UPDATE.getMessage()));
    }

    // 비관락(내기 행 FOR UPDATE — 참가·취소·정산·그룹 탈퇴 연동) 획득 실패/데드락 감지 → 같은
    // 409 CONCURRENT_UPDATE. 잠금 순서(내기 행 전부 → 지갑)를 코드로 고정해 데드락이 없도록 설계했지만,
    // DB 가 감지해 한쪽을 끊는 경우(CannotAcquireLockException 등)에도 원인 불명 500 대신 재시도 가능
    // 응답으로 강하시킨다. 트랜잭션은 전체 롤백된 상태라 재시도하면 풀린다. 설계상 없어야 할 충돌이므로
    // warn 을 남겨 모니터링에서 보이게 한다.
    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handlePessimisticLock(PessimisticLockingFailureException e) {
        log.warn("PessimisticLockingFailureException → 409 응답 (행 잠금 충돌/데드락 감지)", e);
        return ResponseEntity.status(GroupErrorCode.CONCURRENT_UPDATE.getStatus())
                .body(new ErrorResponse(GroupErrorCode.CONCURRENT_UPDATE.name(),
                        GroupErrorCode.CONCURRENT_UPDATE.getMessage()));
    }
}
