package com.oneorthree.phone.content.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

/** 운영 콘텐츠의 입력·검토·멱등성 판정. */
@Getter
@RequiredArgsConstructor
public enum ContentErrorCode implements ErrorCode {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "입력 내용을 확인해 주세요"),
    NOT_FOUND(HttpStatus.NOT_FOUND, "소식을 찾을 수 없어요"),
    CONTENT_REVIEW_STALE(HttpStatus.CONFLICT, "내용이 바뀌었어요. 다시 검토해 주세요"),
    CONTENT_PUBLICATION_CONFLICT(HttpStatus.CONFLICT, "이미 다른 내용으로 게시한 요청이에요"),
    CONTENT_PUBLICATION_WINDOW(HttpStatus.CONFLICT, "오늘 호는 오전 7시 이후에 게시할 수 있어요");

    private final HttpStatus status;
    private final String message;
}
