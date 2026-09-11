package com.oneorthree.business.linkpreview.exception;

public class PreviewException extends RuntimeException {

    private final String code;

    public PreviewException(String code) {
        super(code);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
