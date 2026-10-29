package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 적용 당시 전후 값은 후속 정책과 무관하게 불변 영수증으로 보존한다. */
public record ConstructionPolicyApplied(UUID publicationId, int previousRevision, int costPolicyVersion,
                                       Instant publishedAt, String actor,
                                       List<ConstructionPolicyView.Item> before,
                                       List<ConstructionPolicyView.Item> items) { }
