package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.internal.dto.IslandArrivalView;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 첫 항해의 짧은 화면 체험 뒤 도착. 사용 횟수는 앱 로컬에서 정하며 집중 세션·보상은 만들지 않는다. */
@Service
@RequiredArgsConstructor
public class IntroVoyageService {
    private final PublicCommandService commands;
    private final UserQueryService users;
    private final UserIslandContextLockService contexts;
    private final IslandMovementGuards guards;
    private final TelescopeService telescope;
    private final OnboardingIslandService onboarding;
    private final IslandMembershipService islands;
    private final IslandStateEvents stateEvents;
    private final IslandMembershipEvents membershipEvents;
    private final Clock clock;

    /** 같은 키 재시도는 실제 생성된 섬 ID까지 재생한다. 재설치 후 새 키 사용은 제한하지 않는다. */
    @Transactional
    public IslandArrivalView arrive(UUID userId, UUID destinationId, UUID key) {
        var command = new PublicCommandRequest(userId,
                "POST:/islands/" + destinationId + "/intro-arrivals:" + userId, key, InternalJson.tree(Map.of()));
        JsonNode data = commands.run(command, () -> users.getCallerForUpdate(userId),
                ignored -> users.getCallerForUpdate(userId), () -> {
                    var user = users.getCallerForUpdate(userId);
                    var context = contexts.lock(user);
                    guards.requireNoLiveFocusSession(user);
                    guards.requireDepartureUnlocked(context);
                    var destination = telescope.list(userId).items().stream()
                            .filter(item -> destinationId.equals(item.islandId()))
                            .findFirst()
                            .orElseThrow(() -> new FocusException(FocusErrorCode.SEA_DESTINATION_UNAVAILABLE));
                    UUID islandId = destinationId;
                    List<EventEnvelope> events = new ArrayList<>();
                    if (TelescopeService.SLOT_UNINHABITED.equals(destination.slot())) {
                        // 무인도 첫 항해 체험 도착도 실제 섬을 만들며, 마을회관을 완공 상태로 함께 받는다(GROMO-2650).
                        islandId = onboarding.materializeAtFinish(user, context, clock.instant()).getId();
                        events.add(stateEvents.created(islandId, userId));
                        events.add(membershipEvents.changed(islandId, userId, "MEMBER_ADDED", userId));
                    }
                    // 기존 도착 경로가 공개 여부·현재 섬·도착 기록·첫 주민 환영 사건을 같은 TX에서 처리한다.
                    var arrival = islands.arrive(userId, islandId, key);
                    return new PublicCommandResult(200, InternalJson.tree(arrival), InternalJson.tree(events));
                }).value().data();
        return InternalJson.decode(data, IslandArrivalView.class);
    }
}
