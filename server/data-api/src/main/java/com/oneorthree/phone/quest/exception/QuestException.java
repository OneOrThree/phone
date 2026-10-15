package com.oneorthree.phone.quest.exception;

import com.oneorthree.phone.common.exception.DomainException;

/** 섬 퀘스트 도메인의 단일 예외 — 상태 코드와 문구는 전부 {@link QuestErrorCode} 가 들고 있다. */
public class QuestException extends DomainException {

    private final QuestErrorCode errorCode;

    public QuestException(QuestErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }

    @Override
    public QuestErrorCode getErrorCode() {
        return errorCode;
    }
}
