package com.oneorthree.phone.group.service;

import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;

import java.util.UUID;

/** 같은 두 사용자에 대한 역방향 요청도 users부터 UUID 순서로 잠근다. */
public final class GroupMemberUserLocks {
    private GroupMemberUserLocks() {
    }

    /** 대상 부재는 receipt 재생을 막지 않도록 보존하고 신규 실행에서만 거절한다. */
    public static LockedUsers lock(UserQueryService users, UUID callerId, UUID targetId) {
        if (callerId.equals(targetId)) {
            User caller = users.getCallerForShare(callerId);
            return new LockedUsers(caller, caller);
        }
        if (callerId.compareTo(targetId) < 0) {
            User caller = users.getCallerForShare(callerId);
            return new LockedUsers(caller, targetOrNull(users, targetId));
        }
        User target = targetOrNull(users, targetId);
        return new LockedUsers(users.getCallerForShare(callerId), target);
    }

    private static User targetOrNull(UserQueryService users, UUID targetId) {
        try {
            return users.getTargetForShare(targetId);
        } catch (UserException e) {
            if (e.getErrorCode() != UserErrorCode.TARGET_USER_NOT_FOUND) {
                throw e;
            }
            return null;
        }
    }

    /** caller는항상 활성이다. target은 존재하지 않을 수 있다. */
    public record LockedUsers(User caller, User target) {
        public User requireTarget() {
            if (target == null) {
                throw new UserException(UserErrorCode.TARGET_USER_NOT_FOUND);
            }
            return target;
        }
    }
}
