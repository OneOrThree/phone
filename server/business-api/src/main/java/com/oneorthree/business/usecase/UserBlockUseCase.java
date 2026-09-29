package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.dto.BlockedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/** 차단 공개 표면의 Data 위임과 오류 계약 변환 (GROMO-1975). */
@Service
@RequiredArgsConstructor
public class UserBlockUseCase {

    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            "SELF_BLOCK", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "blockedUserId"),
            "TARGET_USER_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "blockedUserId"),
            "USER_NOT_FOUND", new PublicFailure(ApiErrorCode.USER_NOT_FOUND, null));

    private final DataFriendClient data;

    public void block(AccessTokenClaims claims, UUID blockedUserId, Deadline deadline) {
        relay(() -> {
            data.blockUser(claims.userId(), blockedUserId, deadline);
            return null;
        });
    }

    public void unblock(AccessTokenClaims claims, UUID blockedUserId, Deadline deadline) {
        relay(() -> {
            data.unblockUser(claims.userId(), blockedUserId, deadline);
            return null;
        });
    }

    public List<BlockedUserView> blocks(AccessTokenClaims claims, Deadline deadline) {
        List<BlockedUser> result = relay(() -> data.fetchBlockedUsers(claims.userId(), deadline));
        if (result == null) {
            throw new UpstreamContractMismatchException("차단 목록 응답이 없습니다");
        }
        return result.stream().map(BlockedUserView::from).toList();
    }

    /** 차단 목록의 공개 필드만 허용한다. */
    public record BlockedUserView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String name) {
        private static BlockedUserView from(BlockedUser source) {
            return source == null ? null : new BlockedUserView(source.id(), source.name());
        }
    }

    private <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            if (failure == null || failure.code().getStatus().value() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    private record PublicFailure(ApiErrorCode code, String field) {
    }
}
