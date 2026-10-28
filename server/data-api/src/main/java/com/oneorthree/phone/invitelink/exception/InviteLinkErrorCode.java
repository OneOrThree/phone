package com.oneorthree.phone.invitelink.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 초대 링크 도메인 에러 코드.
 *
 * <p>이름은 응답 본문의 {@code code} 로 그대로 나가 앱이 분기에 쓴다(스펙 §4-2 계약) — 변경 금지.
 */
@Getter
public enum InviteLinkErrorCode implements ErrorCode {

    SLUG_NOT_FOUND(HttpStatus.NOT_FOUND, "초대 링크를 찾을 수 없습니다."),
    SLUG_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "초대 링크 생성에 실패했습니다."),

    // 섬 초대 코드 (GROMO-1760 · 섬 소속 LLD §3.10~§3.11)

    /** 코드 형식이 맞지 않는다 — 8자·혼동 문자 제외 알파벳({@code SlugGenerator}) 외의 입력이다. */
    INVITATION_CODE_INVALID(HttpStatus.UNPROCESSABLE_ENTITY, "초대 코드 형식이 올바르지 않습니다."),

    /**
     * 코드는 존재하지만 «그 초대를 만든 세대» 가 사라졌다 — 발급자 이탈·강퇴·재가입으로 발급 세대가
     * 바뀌었거나 섬이 종결됐다 (§3.10). TTL 이 아니라 멤버십 세대 기준의 영구 폐기다.
     */
    INVITATION_EXPIRED(HttpStatus.GONE, "초대가 만료됐거나 폐기됐어요");

    private final HttpStatus status;
    private final String message;

    InviteLinkErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
