package com.oneorthree.realtime.common.exception;

import lombok.Getter;
import lombok.Setter;

/**
 * 이 서비스가 «의도적으로» 거절할 때 던지는 예외의 뿌리.
 *
 * <p>{@code GlobalExceptionHandler} 하나가 이 타입만 보고 봉투를 만든다 — 도메인마다 핸들러를 두지
 * 않는다. 반대로 도메인 예외가 아닌 것(NPE·드라이버 오류 등)은 절대 이 타입으로 감싸지 않는다.
 * 그건 «우리가 예상한 거절»이 아니라 «우리가 몰랐던 고장»이고, 둘을 섞으면 500 이 4xx 로 위장돼
 * 알림·대시보드에서 사라진다.
 */
@Getter
public abstract class DomainException extends RuntimeException {

    private final transient ErrorCode errorCode;

    /**
     * 섬 구독·intent 거절이 실어 보내는 채널({@code events | movement}) — ERROR 프레임 {@code channel} 헤더가
     * 된다(GROMO-2354). 앱이 어느 구독이 거절됐는지 가르는 근거다. 없으면 null(헤더를 싣지 않는다).
     *
     * <p>{@code ChatException} 뿐 아니라 상류 장애({@code UpstreamUnavailableException}·
     * {@code UpstreamRejectedCredentialException})도 같은 구독 판정 안에서 나오므로 뿌리에 둔다.
     * 바다({@code sea})는 소켓이 따로라 싣지 않는다.
     *
     * <p>응원({@code emotes}) 구독 거절은 일부러 싣지 않는다 — 배포된 앱은 헤더 없는 ERROR 를 «응원 구독 중단» 신호로
     * 읽어서, 헤더가 붙으면 옛 빌드가 재접속마다 응원을 다시 구독해 소켓이 끊겼다 붙는 루프에 빠진다. 모든 클라이언트
     * 빌드가 {@code channel: emotes} 를 처리한 뒤에야 싣는다(앱 쪽 수정은 티켓 2160 빌드가 처음).
     */
    @Setter
    private String channel;

    protected DomainException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
