package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.group.exception.ChallengeResultClaimHeldException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MissingPathVariableException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.http.HttpStatusCode;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import jakarta.persistence.EntityNotFoundException;

import java.time.zone.ZoneRulesException;

/**
 * 전역 예외 → HTTP 응답 변환. 모든 컨트롤러의 예외가 여기를 지나 {@link ErrorResponse} 봉투
 * ({@code code}·{@code message})로 통일된다 — 앱이 {@code code} 로 분기하므로 이 봉투를 벗어나
 * 스프링 기본 {@code /error} 로 새는 예외가 생기면 그 경로의 에러 규약이 깨진다.
 *
 * <p><b>매핑은 세 갈래다.</b>
 * <ul>
 *   <li>도메인 예외({@link DomainException} 전부) — 상태 코드와 {@code code} 를 실린
 *       {@link ErrorCode} 에서 그대로 꺼낸다. 여기서는 판단하지 않고 옮기기만 한다.
 *       도메인마다 핸들러를 두지 않는다 — 하나가 전부를 받는다 (GROMO-1657)</li>
 *   <li>프레임워크·DB 예외 — 원인 불명 500 으로 새지 않도록 의미 있는 4xx 로 강하시킨다
 *       (타입 변환 실패 400, 제약 위반·락 충돌 409)</li>
 *   <li>서버 배선 오류 — {@link LoginUserResolutionException} 만이 의도적으로 500 이다</li>
 *   <li>그 외 전부 — {@link #handleUnexpected} 가 500 고정 문구로 받는다. 스프링 기본 {@code /error}
 *       바디로 새는 경로는 더 이상 없다 (GROMO-1657)</li>
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
     * 도메인 예외 전부 → 에러코드가 지정한 상태 (GROMO-1657).
     *
     * <p>종전엔 도메인마다 글자 그대로 같은 핸들러가 11개 있었다. {@link DomainException} 을 상속하고
     * {@link ErrorCode} 를 구현하는 순간 여기로 들어오므로, 새 도메인은 이 클래스를 <b>손대지 않는다</b>.
     * 빠뜨릴 자리가 없다는 것이 이 핸들러의 존재 이유다.
     *
     * <p>하위 타입 전용 핸들러({@link #handleChallengeResultClaimHeld})가 있으면 스프링이 더 구체적인
     * 쪽을 고르므로 여기는 그 뒤에 온다 — 등록 순서와 무관하다.
     *
     * @param e 던져진 예외. 상태와 {@code code} 는 실린 에러코드가 정하므로 이 핸들러는 정책을 갖지
     *          않는다 — 응답을 바꾸려면 그 도메인의 enum 을 고친다
     * @return {@code code} = 에러코드 이름, {@code message} = 에러코드에 적힌 사용자용 문구
     */
    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorResponse> handleDomain(DomainException e) {
        ErrorCode code = e.getErrorCode();
        return ResponseEntity.status(code.getStatus())
                .body(new ErrorResponse(code.name(), code.getMessage()));
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
        return ResponseEntity.status(CommonErrorCode.INVALID_PARAMETER.getStatus())
                .body(new ErrorResponse(CommonErrorCode.INVALID_PARAMETER.name(),
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
        return body(CommonErrorCode.LOGIN_USER_RESOLUTION_FAILED);
    }

    /**
     * 어디서도 잡히지 않은 {@code IllegalArgumentException} 의 그물 → 409.
     *
     * <p><b>넓은 그물이라 주의가 필요하다.</b> 서비스가 사전 검증 실패를 이 예외로 던지는 관행 때문에
     * 409 로 두었지만, 진짜 프로그래밍 오류도 같은 타입이라 함께 409 로 나간다. 새 예외를 만들 때는
     * 전용 도메인 예외를 쓰는 편이 낫다 — 이 그물에 걸리면 상태 코드를 스스로 고를 수 없다.
     *
     * @param e 메시지는 <b>응답에 싣지 않고 로그로만</b> 남긴다 (GROMO-1657). 종전엔 그대로 반사해서
     *          내부 구현이 드러나는 문구가 클라이언트에 나갔다
     * @return 409 {@code ILLEGAL_ARGUMENT} — 상태는 종전 그대로다. 400 으로 바꾸는 것은 계약 변경이라
     *         GROMO-1725 가 받는다
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        log.warn("IllegalArgumentException → 409 ILLEGAL_ARGUMENT: {}", e.getMessage());
        return body(CommonErrorCode.ILLEGAL_ARGUMENT);
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
        return ResponseEntity.status(CommonErrorCode.INVALID_TIMEZONE.getStatus())
                .body(new ErrorResponse(CommonErrorCode.INVALID_TIMEZONE.name(), e.getMessage()));
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
        return body(CommonErrorCode.DATA_INTEGRITY_VIOLATION);
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
        return body(CommonErrorCode.CONCURRENT_UPDATE);
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
        return body(CommonErrorCode.CONCURRENT_UPDATE);
    }

    /**
     * {@code @Valid} 검증 실패 → 400 {@code INVALID_REQUEST} (GROMO-1657).
     *
     * <p>종전엔 핸들러가 없어 스프링 기본 바디({@code timestamp·status·error·path})가 <b>{@code code}
     * 없이</b> 나갔다 — 컨트롤러 26곳의 {@code @Valid} 가 전부 앱에서는 «알 수 없는 오류»였다.
     *
     * @param e 필드 오류 목록. 첫 필드의 기본 메시지를 문구로 쓴다 — DTO 애노테이션에 우리가 적은
     *          문장이라 내부가 새지 않는다. 없으면 공통 문구
     * @return 400 {@code INVALID_REQUEST}
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException e) {
        FieldError first = e.getBindingResult().getFieldError();
        String message = first != null && first.getDefaultMessage() != null
                ? first.getDefaultMessage() : CommonErrorCode.INVALID_REQUEST.getMessage();
        return ResponseEntity.status(CommonErrorCode.INVALID_REQUEST.getStatus())
                .body(new ErrorResponse(CommonErrorCode.INVALID_REQUEST.name(), message));
    }

    /**
     * 요청 바디를 읽을 수 없다(깨진 JSON·타입 불일치) → 400 {@code INVALID_REQUEST} (GROMO-1657).
     *
     * @param e 파서 메시지에 클래스명·필드 경로가 실리므로 <b>응답에 싣지 않는다</b>
     * @return 400 {@code INVALID_REQUEST}
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException e) {
        return body(CommonErrorCode.INVALID_REQUEST);
    }

    /**
     * 필수 쿼리·경로 파라미터 누락 → 400 {@code INVALID_PARAMETER} (GROMO-1657).
     * 타입 불일치({@link #handleTypeMismatch})와 같은 코드, 같은 문구 형식이다.
     *
     * @param e 누락된 파라미터 이름을 문구에 싣는다 — 클라이언트가 보낸 계약의 일부라 새는 정보가 없다
     * @return 400 {@code INVALID_PARAMETER}
     */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponse> handleMissingParameter(MissingServletRequestParameterException e) {
        return ResponseEntity.status(CommonErrorCode.INVALID_PARAMETER.getStatus())
                .body(new ErrorResponse(CommonErrorCode.INVALID_PARAMETER.name(),
                        "요청 파라미터 '" + e.getParameterName() + "' 이(가) 필요합니다."));
    }

    /**
     * 경로는 있는데 그 메서드를 받지 않는다 → 405 {@code METHOD_NOT_ALLOWED} (GROMO-1657).
     *
     * @param e 어떤 메서드였는지는 응답에 싣지 않는다 — 상태 코드가 이미 말한다
     * @return 405 {@code METHOD_NOT_ALLOWED}
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        // 405 는 Allow 헤더가 규약상 필수다(RFC 9110 §15.5.6) — 스프링 기본 처리기는 실어 보내는데 봉투를
        // 만들면서 버리고 있었다(codex 리뷰). 예외가 이미 만들어 둔 헤더를 그대로 복사한다.
        return ResponseEntity.status(CommonErrorCode.METHOD_NOT_ALLOWED.getStatus())
                .headers(e.getHeaders())
                .body(new ErrorResponse(CommonErrorCode.METHOD_NOT_ALLOWED.name(),
                        CommonErrorCode.METHOD_NOT_ALLOWED.getMessage()));
    }

    /**
     * 그런 경로가 없다 → 404 {@code RESOURCE_NOT_FOUND} (GROMO-1657).
     *
     * <p>{@code NOT_FOUND} 를 쓰지 않는다 — 앱이 그 문자열을 «그룹이 사라짐»으로 해석하는 분기가
     * 17곳이라, 오타 난 경로에 그 코드를 주면 엉뚱한 안내가 뜬다(GROMO-1725).
     *
     * @param e 경로는 응답에 싣지 않는다
     * @return 404 {@code RESOURCE_NOT_FOUND}
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNoResource(NoResourceFoundException e) {
        return body(CommonErrorCode.RESOURCE_NOT_FOUND);
    }

    /**
     * JPA {@code EntityNotFoundException} → 404 {@code ENTITY_NOT_FOUND} (GROMO-1657).
     *
     * <p>종전엔 매핑이 없어 <b>500</b> 이 나갔다 — {@code ItemQueryService} 가 이 예외를 던진다.
     * 도메인 코드로 치환하는 일(GROMO-895)이 끝나면 이 핸들러에 도달하는 예외는 없어야 한다.
     * 그래서 warn 을 남긴다 — 도달했다는 것 자체가 «아직 치환 안 된 조회가 있다»는 신호다.
     *
     * @param e 메시지는 우리 코드가 적은 문장이지만 규칙대로 응답에 싣지 않는다
     * @return 404 {@code ENTITY_NOT_FOUND}
     */
    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleEntityNotFound(EntityNotFoundException e) {
        log.warn("EntityNotFoundException 이 전역 핸들러까지 왔다 — 도메인 예외로 감싸지 않은 조회: {}", e.getMessage());
        return body(CommonErrorCode.ENTITY_NOT_FOUND);
    }

    /**
     * 스프링 MVC 표준 예외 전부 → <b>예외가 들고 있는 상태 코드 그대로</b> (GROMO-1657).
     *
     * <p>스프링 6 의 프레임워크 예외({@code HttpMediaTypeNotSupported} 415 · {@code HttpMediaTypeNotAcceptable}
     * 406 · {@code MissingPathVariable} 500 · {@code AsyncRequestTimeout} 503 …)는 전부
     * {@link org.springframework.web.ErrorResponse} 를 구현해 자기 상태를 안다. 위에서 전용 핸들러를 둔
     * 것들(검증·파싱·파라미터·405·404)은 더 구체적인 타입이라 여전히 그쪽으로 가고, <b>여기는 나머지를
     * 받아 catch-all 의 500 으로 떨어지지 않게 한다</b> — codex 리뷰가 잡은 회귀: catch-all 이 415/406 을
     * 500 으로 바꾸고 있었다. 두 개만 막으면 같은 부류가 또 새므로 인터페이스로 받는다.
     *
     * @param e 상태 코드를 들고 있는 프레임워크 예외. 문구는 싣지 않는다 — 내부 타입명이 들어 있다
     * @return 상태는 예외의 것. {@code code} 는 415·406 은 전용, 그 외 4xx 는 {@code INVALID_REQUEST},
     *         5xx 는 {@code INTERNAL_ERROR}
     */
    @ExceptionHandler({
        HttpMediaTypeNotSupportedException.class, HttpMediaTypeNotAcceptableException.class,
        MissingPathVariableException.class, ServletRequestBindingException.class,
        AsyncRequestTimeoutException.class, HandlerMethodValidationException.class,
        MaxUploadSizeExceededException.class, ErrorResponseException.class })
    public ResponseEntity<ErrorResponse> handleFrameworkErrorResponse(Exception e) {
        // 나열한 타입은 전부 org.springframework.web.ErrorResponse 를 구현한다 — 상속 계층은 제각각이라
        // (ServletException 계열·RuntimeException 계열) 인터페이스로는 @ExceptionHandler 를 못 걸고
        // 스프링 자신의 ResponseEntityExceptionHandler 처럼 목록으로 잡는다.
        org.springframework.web.ErrorResponse errorResponse = (org.springframework.web.ErrorResponse) e;
        HttpStatusCode status = errorResponse.getStatusCode();
        CommonErrorCode code;
        if (status.value() == 415) {
            code = CommonErrorCode.UNSUPPORTED_MEDIA_TYPE;
        } else if (status.value() == 406) {
            code = CommonErrorCode.NOT_ACCEPTABLE;
        } else if (status.is4xxClientError()) {
            code = CommonErrorCode.INVALID_REQUEST;
        } else {
            log.error("프레임워크 예외 → {} INTERNAL_ERROR", status.value(), e);
            code = CommonErrorCode.INTERNAL_ERROR;
        }
        // 예외가 만든 헤더(415 의 Accept 등)도 함께 — 상태만 옮기고 헤더를 버리면 규약이 깨진다.
        return ResponseEntity.status(status).headers(errorResponse.getHeaders())
                .body(new ErrorResponse(code.name(), code.getMessage()));
    }

    /**
     * 위 어디에도 잡히지 않은 전부 → 500 {@code INTERNAL_ERROR} 고정 문구 (GROMO-1657).
     *
     * <p>이 그물이 없으면 스프링 기본 {@code /error} 바디가 {@code code} 없이 나가 앱의 에러 규약이
     * 그 경로에서만 깨진다. 여기 도달한 예외는 <b>전부 서버 버그</b>이므로 error 로 남긴다 —
     * 응답에는 아무 내부 정보도 싣지 않는다.
     *
     * @param e 원인. 로그로만
     * @return 500 {@code INTERNAL_ERROR}
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        log.error("잡히지 않은 예외 → 500 INTERNAL_ERROR", e);
        return body(CommonErrorCode.INTERNAL_ERROR);
    }

    /** 공통 코드를 그대로 봉투로 — 상태·code·문구 전부 enum 에서 꺼낸다. */
    private static ResponseEntity<ErrorResponse> body(CommonErrorCode code) {
        return ResponseEntity.status(code.getStatus())
                .body(new ErrorResponse(code.name(), code.getMessage()));
    }
}
