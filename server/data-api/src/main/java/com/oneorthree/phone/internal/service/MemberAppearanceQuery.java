package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.appearance.dto.PersonalAppearanceView;
import com.oneorthree.phone.appearance.exception.AppearanceErrorCode;
import com.oneorthree.phone.appearance.exception.AppearanceException;
import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.user.repository.UserBlockRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import java.util.List;
import java.util.Map;
import com.oneorthree.phone.user.repository.domain.User;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 앱 표시 캐시의 초기화·복구용 묶음 조회. Redis 복제 없이 DB 정본과 양방향 차단을 함께 읽는다. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemberAppearanceQuery {

    private final UserQueryService callers;
    private final UserRepository users;
    private final UserBlockRepository blocks;
    private final AppearanceService appearances;

    /** 공개 프로필의 착용 정보만 반환한다. 비공개 보유품·차단 방향·탈퇴 여부는 노출하지 않는다. */
    public Result find(UUID viewerId, List<UUID> userIds) {
        if (userIds == null || userIds.isEmpty() || userIds.size() > 50
                || userIds.stream().anyMatch(java.util.Objects::isNull)) {
            throw new AppearanceException(AppearanceErrorCode.INVALID_REQUEST);
        }
        callers.getCaller(viewerId);
        List<UUID> requested = userIds.stream().distinct().toList();
        Set<UUID> blocked = blocks.findBlockedEitherIds(viewerId);
        List<UUID> visible = requested.stream().filter(id -> !blocked.contains(id)).toList();
        var rows = visible.isEmpty() ? List.<User>of()
                : users.findAllByIdInAndIsDeletedFalse(visible);
        List<UUID> found = rows.stream().map(User::getId).toList();
        var looks = found.isEmpty() ? Map.<UUID, PersonalAppearanceView>of() : appearances.equippedOf(found);
        List<Member> members = rows.stream()
                .map(user -> new Member(user.getId(), user.getCatColor(), looks.get(user.getId()))).toList();
        return new Result(members, requested.stream().filter(id -> !found.contains(id)).toList());
    }

    public record Result(List<Member> members, List<UUID> hiddenUserIds) { }

    public record Member(UUID userId, String catColor, PersonalAppearanceView appearance) { }
}
