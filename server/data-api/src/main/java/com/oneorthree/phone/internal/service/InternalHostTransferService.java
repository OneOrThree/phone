package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.group.service.GroupMemberUserLocks;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.internal.dto.HostTransferRequest;
import com.oneorthree.phone.internal.dto.HostTransferResponse;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 사용자/세션 인증과 그룹 명령을 결합한다. 그룹은 auth 상위 조합 도메인을 역참조하지 않는다. */
@Service
@RequiredArgsConstructor
public class InternalHostTransferService {
    private static final long MAX_SAFE_VERSION = 9007199254740991L;
    private final UserQueryService users;
    private final AuthSessionService sessions;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final GroupMemberService membershipCommands;
    private final GroupMembershipMutationLocks locks;
    private final PublicCommandService commands;

    @Value("${island-management.host-transfer-enabled:false}")
    private boolean enabled;

    /** 기본 비활성은 receipt 선점·역할·버전·outbox 변경보다 앞서 거절한다. */
    @Transactional
    public HostTransferResponse transfer(UUID islandId, UUID userId, UUID key, HostTransferRequest request) {
        if (!enabled) {
            throw new GroupException(GroupErrorCode.REALTIME_NOT_READY);
        }
        var locked = GroupMemberUserLocks.lock(users, userId, request.targetUserId());
        var command = new PublicCommandRequest(userId, "POST:/islands/" + islandId + "/host-transfer", key,
                tree(Map.of("targetUserId", request.targetUserId().toString())));
        var receipt = commands.run(command, () -> authorize(locked.caller(), request),
                stored -> {
                    // 현재 host/membership/대상 생존은 요구하지 않는다. 원 명령 scope/fingerprint는 공통 검증한다.
                    authorize(locked.caller(), request);
                    response(stored.data());
                }, () -> {
                    locks.lockGroup(islandId);
                    var group = groups.getGroup(islandId);
                    if (group.getDeletedAt() != null || group.getStatus() == GroupStatus.ENDED) {
                        throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
                    }
                    var callerMembership = groups.findMembership(locked.caller(), group)
                            .filter(member -> member.getRole() == GroupMemberRole.OWNER)
                            .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));
                    if (userId.equals(request.targetUserId())) {
                        throw new GroupException(GroupErrorCode.CANNOT_TRANSFER_SELF);
                    }
                    locked.requireTarget();
                    long owners = members.findByGroup(group).stream()
                            .filter(member -> member.getRole() == GroupMemberRole.OWNER).count();
                    if (owners != 1 || callerMembership.isLeft()) {
                        throw new IllegalStateException("활성 방장 수가 올바르지 않습니다.");
                    }
                    var event = membershipCommands.transferOwnerAndRecord(
                            islandId, request.targetUserId(), userId);
                    var result = new HostTransferResponse(request.targetUserId(), event.version());
                    if (result.version() < 1 || result.version() > MAX_SAFE_VERSION) {
                        throw new IllegalStateException("주민 목록 버전 범위를 초과했습니다.");
                    }
                    return new PublicCommandResult(200, tree(result), tree(List.of(event)));
                }).value();
        // 내부 event/control은 이 응답에 노출하지 않고 저장된 최소 완료 증거만 복원한다.
        return response(receipt.data());
    }

    private void authorize(User caller, HostTransferRequest request) {
        if (request.sessionId() == null || request.authGeneration() == null
                || request.authGeneration() != caller.getAuthGeneration()
                || sessions.verifySession(caller.getId(), request.sessionId())
                        .filter(row -> row.isActive()).isEmpty()) {
            throw new AuthException(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
    }

    private static HostTransferResponse response(JsonNode data) {
        if (data == null || !data.isObject() || data.size() != 2 || !data.path("hostUserId").isTextual()
                || !data.path("version").isIntegralNumber() || !data.path("version").canConvertToLong()
                || data.path("version").longValue() < 1 || data.path("version").longValue() > MAX_SAFE_VERSION) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
        try {
            return new HostTransferResponse(HostTransferRequest.identifier(data.path("hostUserId").textValue()),
                    data.path("version").longValue());
        } catch (IllegalArgumentException e) {
            throw new OutboxException(OutboxErrorCode.IDEMPOTENT_REPLAY_FAILED);
        }
    }

    private static JsonNode tree(Object value) {
        try {
            return OutboxEnvelopeCodec.fromJson(OutboxEnvelopeCodec.toJson(value), JsonNode.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("위임 결과 직렬화 실패", e);
        }
    }
}
