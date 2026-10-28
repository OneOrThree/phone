package com.oneorthree.business.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 신규 JSON 성공. 값이 없어도 data 키를 보존한다. */
public record ApiSuccess<T>(@JsonInclude(JsonInclude.Include.ALWAYS) T data) {
}
