package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.notification.producer.NotificationDispatchOutcome;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 챌린지 종료 푸시의 <b>공통 발송부</b>(GROMO-1088).
 *
 * <p>종료 <b>감지</b>만 서비스마다 다르고(창형 = 창 종료 시각 / 일 목표형 = 하루 마감), 그 뒤는 같다:
 * 끝난 챌린지의 그룹원에게 "결과를 확인해보세요" 를 보내고 발송 이력을 남긴다. 두 감지 경로가 각자
 * 발송부를 들고 있으면 dedup·배치 로딩·문구 규칙이 갈라지므로 여기 하나로 모은다.
 *
 * <p><b>발송 단위는 (유저 × 그룹)</b>이다 — 챌린지 단위가 아니다. 한 그룹은 카테고리×타입당 활성
 * 챌린지 1개(V20 부분 유니크)라 같은 타입의 종료가 동시에 2건(FOCUS·SCREEN_TIME) 겹칠 수 있는데,
 * 문구에 챌린지 구분이 없어 같은 알림이 두 번 뜨는 꼴이 된다. 그래서 그룹당 1건만 보내고
 * <b>그 푸시가 대변한 챌린지 전부</b>에 발송 이력을 남긴다(딥링크는 대표 1건 = 가장 먼저 만들어진
 * 챌린지 — 그룹 대표 미션 관례). 발송이 성사되지 않으면 이력을 남기지 않으므로 다음 틱이 다시 집는다.
 *
 * <p>무효 토큰 정리(더티체킹)가 일어나므로 <b>호출측의 쓰기 트랜잭션 안에서</b> 돌아야 한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
class ChallengeEndPushDispatcher {

    /**
     * 한 번에 훑는 <b>그룹</b> 수 — 멤버·알림설정·발송이력 조회의 IN 목록 길이를 묶어 두기 위한 것이다.
     * 일 마감 배치는 활성 일 목표 챌린지 <b>전건</b>을 대상으로 하므로 그룹 수가 늘면 그대로 커진다.
     */
    private static final int CHUNK_SIZE = 200;

    /** 묶음 슬롯의 기준 시간대 — 크론·리그 도메인과 통일된 KST 고정이다. */
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final GroupMemberRepository groupMemberRepository;
    private final UserQueryService userQueryService;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;
    private final NotificationDispatcher notificationDispatcher;

    /** 결과 딥링크(계약 §2) — 그룹 화면까지 데려간 뒤 {@code challenge} 로 결과 모달을 연다. */
    static String resultDeepLink(UUID groupId, UUID challengeId) {
        return "gromo://group?g=" + groupId + "&challenge=" + challengeId;
    }

    /**
     * 끝난 챌린지들의 그룹원에게 결과 확인 푸시를 보낸다.
     *
     * @param endedChallenges 종료가 감지된 챌린지(그룹이 fetch 된 상태여야 한다)
     * @param pushType        {@link NotificationSentLog} 타입 문자열 — dedup 축이자 앱의 {@code data.type}
     * @param copy            문구(승패 미포함 — 보고 전이라 결과가 확정되지 않은 경우가 있다)
     * @param dedupSince      발송 이력을 이 시각 이후로만 본다(반복 주기의 "이번 회차" 경계)
     * @param cycleEndByChallengeId 챌린지별 <b>이번 회차가 끝난 시각</b> — 그 뒤에 그룹에 들어온 멤버는
     *     그 회차에 참여한 적이 없으므로 발송 대상에서 뺀다(@codex 리뷰). 값이 없으면 거르지 않는다.
     * @param now             판정·기록 시각
     * @param startedAtMillis 호출측 배치 시작 시각 — 감지 쿼리까지 포함한 소요 시간을 재기 위해 받는다
     */
    PushDispatchSummaryResponse dispatch(List<GroupChallenge> endedChallenges, String pushType,
            PushCopy copy, Instant dedupSince, Map<UUID, Instant> cycleEndByChallengeId,
            Instant now, long startedAtMillis) {
        // 그룹당 종료 챌린지 묶음 — 대표(딥링크에 실을 챌린지)가 흔들리지 않게 생성순으로 정렬한다.
        // createdAt 은 영속화 시점에 채워지므로 방어적으로 null 을 뒤로 민다.
        Map<UUID, List<GroupChallenge>> challengesByGroupId = endedChallenges.stream()
                .sorted(Comparator.comparing(GroupChallenge::getCreatedAt,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .collect(Collectors.groupingBy(challenge -> challenge.getGroup().getId(),
                        LinkedHashMap::new, Collectors.toList()));
        // 청크는 <b>그룹</b> 단위로 자른다 — 챌린지 단위로 자르면 한 그룹의 종료 챌린지가 청크 경계에
        // 갈려 (유저 × 그룹) 1건 묶음이 깨지고 같은 유저에게 두 번 나간다.
        List<UUID> groupIds = List.copyOf(challengesByGroupId.keySet());

        int target = 0;
        int sent = 0;
        int deduped = 0;
        int skipped = 0;
        for (int from = 0; from < groupIds.size(); from += CHUNK_SIZE) {
            List<UUID> chunk = groupIds.subList(from, Math.min(from + CHUNK_SIZE, groupIds.size()));
            Counts counts = dispatchChunk(chunk, challengesByGroupId, pushType, copy, dedupSince,
                    cycleEndByChallengeId, now);
            target += counts.target();
            sent += counts.sent();
            deduped += counts.deduped();
            skipped += counts.skipped();
        }
        return new PushDispatchSummaryResponse(
                target, sent, deduped, skipped, System.currentTimeMillis() - startedAtMillis);
    }

    private Counts dispatchChunk(List<UUID> groupIds,
            Map<UUID, List<GroupChallenge>> challengesByGroupId, String pushType, PushCopy copy,
            Instant dedupSince, Map<UUID, Instant> cycleEndByChallengeId, Instant now) {
        // pushType 문자열은 앱 계약(data.type)이자 신 경로의 kind 이름이다 — 같은 값이라 그대로 푼다.
        NotificationKind kind = NotificationKind.find(pushType);
        if (kind == null) {
            // 모르는 종류를 «성공»으로 세면 이관 검증이 통과한 채로 발송이 사라진다.
            throw new IllegalStateException("알 수 없는 챌린지 종료 푸시 종류입니다: " + pushType);
        }
        // 탈퇴한 유저는 발송 대상이 아니다(멤버 행은 남는다).
        // 멤버 행을 그대로 들고 간다 — 가입 시각(createdAt)이 회차 참여 여부 판정에 필요하다.
        Map<UUID, List<GroupMember>> membersByGroupId = groupMemberRepository
                .findByGroupIdIn(groupIds).stream()
                .filter(member -> !member.getUser().isDeleted())
                .collect(Collectors.groupingBy(member -> member.getGroup().getId()));
        List<UUID> userIds = membersByGroupId.values().stream()
                .flatMap(List::stream)
                .map(member -> member.getUser().getId())
                .distinct()
                .toList();
        if (userIds.isEmpty()) {
            return new Counts(0, 0, 0, 0);
        }

        Set<SentKey> alreadySent = alreadySentKeys(pushType, userIds, dedupSince);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);

        int target = 0;
        int sent = 0;
        int deduped = 0;
        int skipped = 0;
        List<NotificationSentLog> newLogs = new ArrayList<>();
        for (UUID groupId : groupIds) {
            List<GroupChallenge> ended = challengesByGroupId.get(groupId);
            for (GroupMember member : membersByGroupId.getOrDefault(groupId, List.of())) {
                User user = member.getUser();
                // 참여 가능한 회차를 먼저 추린다 — 참여한 적 없는 멤버는 발송 "대상" 자체가 아니다.
                // 이걸 dedup 과 한 단계에서 처리하면 가입 시각 필터가 걸린 건까지 dedupedCount 에
                // 섞여, "이미 발송 이력이 있어 건너뛴 건수" 라는 계약이 깨진다(@codex 리뷰).
                List<GroupChallenge> eligible = ended.stream()
                        .filter(challenge -> participatedInCycle(member, cycleEndByChallengeId.get(challenge.getId())))
                        .toList();
                if (eligible.isEmpty()) {
                    continue;
                }
                target++;
                List<GroupChallenge> pending = eligible.stream()
                        .filter(challenge -> !alreadySent.contains(new SentKey(user.getId(), challenge.getId())))
                        .toList();
                if (pending.isEmpty()) {
                    deduped++;
                    continue;
                }
                UserNotificationSettings settings = settingsByUserId.get(user.getId());
                boolean soundEnabled = settings == null || settings.isSoundEnabled();
                PushMessage message = compose(pending.get(0), pushType, copy, soundEnabled);
                // 한 건의 실패가 배치를 끊지 않게 격리 — sendIfAllowed 안에서도 잡지만 문구·로그 조립까지 감싼다.
                try {
                    // 신 경로는 «챌린지마다» 사건을 적는다 — 구 경로가 (유저 x 그룹) 한 건으로 접던
                    // 일을 알림 서버의 묶음(유저 x 그룹 x 슬롯)이 대신한다. 여기서 대표 1건만 적으면
                    // 나머지 챌린지의 결과는 어디에도 남지 않아 다음 회차에 되살아날 근거가 사라진다.
                    if (notificationDispatcher.isOutboxMode()) {
                        boolean queuedAny = false;
                        for (GroupChallenge challenge : pending) {
                            queuedAny |= notificationDispatcher.dispatch(user, settings,
                                    request(kind, user, challenge, pending, now), message, now)
                                    == NotificationDispatchOutcome.QUEUED;
                        }
                        // 전부 중복이면 「이미 적혀 있다」 — 구 경로의 dedup 과 같은 뜻이다.
                        if (queuedAny) {
                            sent++;
                        } else {
                            deduped++;
                        }
                    } else if (notificationDispatcher.dispatch(user, settings,
                            request(kind, user, pending.get(0), pending, now), message, now).recordsLegacyLog()) {
                        sent++;
                        pending.forEach(challenge -> {
                            alreadySent.add(new SentKey(user.getId(), challenge.getId()));
                            newLogs.add(NotificationSentLog.builder()
                                    .userId(user.getId())
                                    .type(pushType)
                                    .targetUserId(challenge.getId())
                                    .sentAt(now)
                                    .build());
                        });
                    } else {
                        skipped++;
                    }
                } catch (RuntimeException e) {
                    skipped++;
                    log.warn("챌린지 종료 푸시 실패 — type={}, userId={}, challengeId={}",
                            pushType, user.getId(), pending.get(0).getId(), e);
                }
            }
        }
        notificationSentLogRepository.saveAll(newLogs);
        return new Counts(target, sent, deduped, skipped);
    }

    /**
     * 이 멤버가 해당 회차에 참여한 적이 있는지 — 회차가 끝난 뒤에 들어왔으면 아니다.
     *
     * <p>DURATION 회차는 자정에 끝나는데 발송은 09:00 이라, 그 사이 가입·재가입한 유저에게도
     * "어제 목표 달성 결과" 가 나갔다(@codex 리뷰). 창형도 종료 뒤 가입이면 같은 문제다.
     * 회차 종료 시각이나 가입 시각을 모르면 거르지 않는다(기존 동작 유지).
     */
    private static boolean participatedInCycle(GroupMember member, Instant cycleEnd) {
        Instant joinedAt = member.getCreatedAt();
        return cycleEnd == null || joinedAt == null || !joinedAt.isAfter(cycleEnd);
    }

    /** 승패 미포함 문구 + 결과 딥링크. {@code data.type}·{@code groupId} 는 앱의 라우팅·GA4 소스다(계약 §2). */
    private PushMessage compose(GroupChallenge representative, String pushType, PushCopy copy,
            boolean soundEnabled) {
        UUID groupId = representative.getGroup().getId();
        return new PushMessage(
                copy.title(),
                copy.body(),
                resultDeepLink(groupId, representative.getId()),
                soundEnabled,
                Map.of("type", pushType, "groupId", groupId.toString(),
                        "challengeId", representative.getId().toString()));
    }

    /**
     * 이미 보낸 (유저, 챌린지) 조합. 기존 인덱스(user_id, type, sent_at)를 타도록 유저 집합 + 구간으로
     * 조회하고 target_user_id 는 메모리에서 접는다 — target_user_id 단독 조회는 인덱스가 없다.
     */
    private Set<SentKey> alreadySentKeys(String pushType, List<UUID> userIds, Instant since) {
        return notificationSentLogRepository.findByTypeAndUserIdInSince(pushType, userIds, since)
                .stream()
                .filter(sentLog -> sentLog.getTargetUserId() != null)
                .map(sentLog -> new SentKey(sentLog.getUserId(), sentLog.getTargetUserId()))
                .collect(Collectors.toCollection(HashSet::new));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(List<UUID> userIds) {
        return userQueryService.findAllNotificationSettings(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    /**
     * 신 경로의 요청 하나 — 대상은 <b>챌린지</b>, 묶음 축은 그룹 × 그날이다.
     *
     * <p>슬롯을 KST 하루의 시작으로 박는다. 구 경로의 dedup 이 「당일 {@code sent_at}」이었으므로
     * 묶음도 같은 폭이라야 창형(15분 크론)의 여러 틱이 하루 안에서 한 건으로 접힌다.
     *
     * <p><b>배치 메타 둘을 같이 싣는다.</b> 구 경로의 보장은 「한 배치당 (유저 × 그룹) 한 건」이고,
     * 신 경로는 그 한 건을 사건 {@code batch.size()} 개로 쪼개 보낸다. 알림 서버가 이것을 다시
     * 한 건으로 접으려면 <b>수신 순서에 기댈 수 없는 두 가지</b>를 알아야 한다 — relay 재전달이나
     * 처리 경합에서 순서는 생성 순서와 갈라지고, 첫 사건만 도착한 사이에 발송이 끼면 같은 배치가
     * 두 번 나간다:
     * <ul>
     *   <li>{@code bundleMembers} — 이 배치가 이 (유저 × 그룹)에 적는 <b>대상 id 전부</b>. 알림 서버는
     *       이 집합이 다 도착했을 때만 묶음을 낸다. 개수가 아니라 집합인 것은 (유저 × 그룹 × 그날)
     *       축에 하루 동안 여러 배치가 겹쳐 들어오기 때문이다.</li>
     *   <li>{@code bundleRepresentative} — 딥링크에 실을 대표 챌린지(= 가장 먼저 만들어진 것).
     *       {@code batch} 가 생성순이므로 첫 원소다.</li>
     * </ul>
     *
     * @param kind      알림 종류
     * @param user      수신자
     * @param challenge 대상 챌린지
     * @param batch     이 수신자에게 이번 배치로 나갈 챌린지 전부 — <b>생성순</b>이어야 한다
     * @param now       판정 시각
     * @return 요청
     */
    private static NotificationRequest request(NotificationKind kind, User user, GroupChallenge challenge,
                                               List<GroupChallenge> batch, Instant now) {
        Instant daySlot = now.atZone(KST).toLocalDate().atStartOfDay(KST).toInstant();
        return new NotificationRequest(kind, user.getId(), challenge.getId(),
                challenge.getGroup().getId(), daySlot, now, user.getLanguage(),
                Map.of("challengeId", challenge.getId().toString(),
                        "bundleRepresentative", batch.get(0).getId().toString(),
                        "bundleMembers", batch.stream().map(member -> member.getId().toString()).toList()));
    }

    /** 푸시 문구 — 감지 경로마다 한 쌍씩 고정한다. */
    record PushCopy(String title, String body) {
    }

    /** dedup 키 — (유저, 챌린지). */
    private record SentKey(UUID userId, UUID challengeId) {
    }

    /** 청크별 집계 — 요약은 호출측(dispatch)이 합산해 만든다. */
    private record Counts(int target, int sent, int deduped, int skipped) {
    }
}
