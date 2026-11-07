package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.group.repository.FirstIslandArrivalRepository;
import com.oneorthree.phone.group.repository.IslandArrivalRepository;
import com.oneorthree.phone.group.repository.domain.IslandArrival;
import com.oneorthree.phone.group.service.IslandMembershipEvents;
import com.oneorthree.phone.group.service.IslandStateEvents;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.internal.dto.IntroArrivalRequest;
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
import java.time.Instant;
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
    private final IslandArrivalRepository arrivals;
    private final FirstIslandArrivalRepository firstArrivals;
    private final Clock clock;

    /** 같은 키 재시도는 실제 생성된 섬 ID까지 재생한다. 재설치 후 새 키 사용은 제한하지 않는다. */
    @Transactional
    public IslandArrivalView arrive(UUID userId, UUID destinationId, UUID key, IntroArrivalRequest meta) {
        var command = new PublicCommandRequest(userId,
                "POST:/islands/" + destinationId + "/intro-arrivals:" + userId, key, InternalJson.tree(Map.of()));
        JsonNode data = commands.run(command, () -> users.getCallerForUpdate(userId),
                ignored -> users.getCallerForUpdate(userId), () -> {
                    var user = users.getCallerForUpdate(userId);
                    // 계정의 첫 도착 판정 — 모든 도착 writer 가 users 행 잠금을 쥐므로 확인과 기록 사이에 끼어들 수 없다(GROMO-2741).
                    boolean firstEver = !arrivals.existsByUserId(userId);
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
                    if (firstEver) {
                        // 광고 사건 시각은 방금 쓴 도착 기록의 첫 도착 시각이다. 사건 ID 는 계정당 한 번만 발급한다.
                        var at = arrivals.findById(new IslandArrival.Key(userId, islandId)).orElseThrow()
                                .getFirstArrivedAt();
                        // 메타 값이 있으면 Conversions API 전송 대기(PENDING), 없거나 틀리면 기록만 남긴다(SKIPPED).
                        var m = meta == null ? null : meta.meta();
                        boolean send = m != null && m.valid();
                        Instant now = clock.instant();
                        // IP 는 열 길이(45) 안일 때만 남긴다 — 넘치는 값이 INSERT 를 깨 도착까지 되돌리지 않게.
                        String ip = send && meta.clientIp() != null && meta.clientIp().length() <= 45
                                ? meta.clientIp() : null;
                        firstArrivals.insertIfAbsent(userId, UUID.randomUUID(), islandId, at,
                                send ? m.anonId() : null, send ? m.advertiserTrackingEnabled() : null,
                                send ? InternalJson.tree(m.extinfo()).toString() : null,
                                ip, send ? "PENDING" : "SKIPPED", send ? now : null);
                    }
                    var result = new IslandArrivalView(arrival.islandId(), arrival.arrivedBefore(),
                            arrival.membershipStatus(), arrival.currentIslandId(), firstEver);
                    return new PublicCommandResult(200, InternalJson.tree(result), InternalJson.tree(events));
                }).value().data();
        return InternalJson.decode(data, IslandArrivalView.class);
    }
}
