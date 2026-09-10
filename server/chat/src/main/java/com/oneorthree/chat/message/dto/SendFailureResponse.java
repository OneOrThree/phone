package com.oneorthree.chat.message.dto;

import com.oneorthree.chat.common.exception.ErrorCode;
import com.oneorthree.chat.common.exception.ErrorResponse;
import lombok.Getter;

import java.util.UUID;

/**
 * 발신 실패 통지 — 공통 봉투에 <b>어느 요청이 실패했는지</b>를 더한 것.
 *
 * <p>{@code ErrorResponse} 를 고치지 않고 상속해 additive 하게 늘린다(그 클래스의 규율).
 *
 * <h2>왜 {@code clientMessageId} 가 필요한가</h2>
 * 성공은 브로드캐스트로 돌아오고 거기엔 {@code clientMessageId} 가 실려 있어, 앱이 낙관적으로 그린
 * 말풍선을 그걸로 찾아 갈아 끼운다. 그런데 실패는 코드와 문구뿐이었다 — 한 세션에서 여러 건을 연달아
 * 보낸 상태에서 그중 하나만 거절되면(집중 시작·강퇴 직후) <b>앱은 어느 말풍선을 실패로 그려야 할지
 * 알 수 없다.</b> 전부 실패로 그리거나 전부 남겨 두는 수밖에 없고, 어느 쪽이든 화면이 실제와 어긋난다.
 *
 * <p>본문을 못 읽은 실패(검증 오류)에는 이 값이 없다({@code null}). 그때는 서버도 요청을 특정할 수
 * 없어서다 — 앱은 그 경우 「방금 보낸 것」을 재시도 대상으로 삼는 수밖에 없다.
 *
 * @param clientMessageId 실패한 요청의 멱등 키. 본문을 파싱하지 못한 실패에서는 null
 */
@Getter
public class SendFailureResponse extends ErrorResponse {

    private final UUID clientMessageId;

    public SendFailureResponse(String code, String message, UUID clientMessageId) {
        super(code, message);
        this.clientMessageId = clientMessageId;
    }

    public static SendFailureResponse of(ErrorCode errorCode, UUID clientMessageId) {
        return new SendFailureResponse(errorCode.name(), errorCode.getMessage(), clientMessageId);
    }
}
