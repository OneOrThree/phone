package com.oneorthree.phone.outbox.repository.domain;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/** {@link AggregateVersion} 의 복합 키 — {@code (aggregateType, aggregateId)}. */
@Getter
@EqualsAndHashCode
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class AggregateVersionId implements Serializable {

    private static final long serialVersionUID = 1L;

    private String aggregateType;

    private String aggregateId;
}
