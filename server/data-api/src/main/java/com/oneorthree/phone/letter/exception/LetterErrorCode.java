package com.oneorthree.phone.letter.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 편지 도메인의 실패 사유 (GROMO-1933, friend-letter LLD §1.12~1.14).
 *
 * <p>여기 없는 실패는 다른 도메인이 던진다 — 수신자 부재·탈퇴는 {@code UserErrorCode.TARGET_USER_NOT_FOUND},
 * 요청자 본인 부재는 {@code UserErrorCode.USER_NOT_FOUND} 다(LLD §1.12 가 둘을 구분하라고 못 박았다).
 * 그 코드들을 편지 쪽에 다시 만들지 않는다.
 */
@Getter
public enum LetterErrorCode implements ErrorCode {

    // 잘못된 요청
    SELF_LETTER(HttpStatus.BAD_REQUEST, "자기 자신에게는 편지를 보낼 수 없습니다."),
    LETTER_CONTENT_BLANK(HttpStatus.BAD_REQUEST, "편지 내용을 입력해 주세요."),
    INVALID_PAGE_REQUEST(HttpStatus.BAD_REQUEST, "유효하지 않은 페이지 요청입니다."),

    /**
     * 편지함 {@code type} 파라미터 오류 — {@code size} 오류({@link #INVALID_PAGE_REQUEST})와 나눈다.
     * 한 코드로 합치면 Business 가 어느 파라미터가 틀렸는지 {@code field} 로 알려 줄 수 없다
     * (공개 {@code INVALID_PARAMETER} 의 field 는 각각 {@code type}·{@code size}).
     */
    INVALID_MAILBOX_TYPE(HttpStatus.BAD_REQUEST, "유효하지 않은 편지함 종류입니다."),

    // 권한
    /**
     * 우체통 미완공 — Business 가 공개 {@code FACILITY_LOCKED}(403)로 옮긴다. 재영님 확정(2026-09-18,
     * LLD §4 결정 2 = C): <b>발송은 항상 가능하고 열람만 게이트한다.</b> 그래서 이 코드는 목록·상세에서만
     * 나가고 {@code POST /letters} 에서는 절대 나가지 않는다.
     *
     * <p>이름을 {@code MAILBOX_LOCKED} 로 짓지 않은 것은 의도다 — 섬 우체통 편지방(GROMO-1775)이
     * {@code GroupErrorCode.MAILBOX_LOCKED} 를 쓰고 있어, 같은 이름을 두 도메인에 두면 오류 계약 규약
     * (「도메인 간 code 이름 재사용 금지」, {@code docs/conventions/error-contract.md})을 깬다.
     */
    LETTER_MAILBOX_LOCKED(HttpStatus.FORBIDDEN, "우체통을 지으면 편지를 주고받을 수 있어요"),
    NOT_LETTER_PARTICIPANT(HttpStatus.FORBIDDEN, "내가 주고받은 편지만 볼 수 있습니다."),

    /**
     * 닫기(GROMO-2002)를 <b>발신자</b>가 시도했다 — 정책은 「받는 사람이 편지를 열었다가 닫으면
     * 지워지고, 보낸 사람 목록에서도 사라진다」이므로 닫는 주체는 수신자 하나뿐이다.
     * {@link #NOT_LETTER_PARTICIPANT}(둘 중 어느 쪽도 아님)와 상태는 같지만 사유가 달라 코드를 나눈다 —
     * 합치면 「내 편지가 아니다」와 「내가 닫을 수 있는 편지가 아니다」를 앱이 구분해 안내할 수 없다.
     */
    NOT_LETTER_RECEIVER(HttpStatus.FORBIDDEN, "받은 편지만 닫을 수 있습니다."),

    // 대상 없음
    LETTER_NOT_FOUND(HttpStatus.NOT_FOUND, "편지를 찾을 수 없습니다."),
    LETTER_RECIPIENT_NOT_FRIEND(HttpStatus.NOT_FOUND, "친구에게만 편지를 보낼 수 있습니다."),

    /**
     * 본문 길이 상한 초과 — <b>400</b>(재영님 확정 2026-09-18: 501자는 400). LLD §1.12 의 422 는
     * 폐기된 제안이다. 빈 본문({@link #LETTER_CONTENT_BLANK})과 상태는 같고 사유만 다르므로
     * 상수를 나눈다 — 앱이 「비었다」와 「길다」를 구분해 안내할 수 있게. Business 는 이것을 공개
     * {@code INVALID_PARAMETER}(400, field=content)로 옮긴다.
     */
    LETTER_CONTENT_OUT_OF_RANGE(HttpStatus.BAD_REQUEST, "편지는 500자까지 쓸 수 있어요");

    private final HttpStatus status;
    private final String message;

    LetterErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
