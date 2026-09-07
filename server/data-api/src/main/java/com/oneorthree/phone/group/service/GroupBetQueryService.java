package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.dto.ChallengeDeletionPreviewResponse;
import com.oneorthree.phone.group.dto.GroupChallengeHistoryItemResponse;
import com.oneorthree.phone.group.dto.GroupChallengeHistorySliceResponse;
import com.oneorthree.phone.group.dto.MyBetSessionResponse;
import com.oneorthree.phone.group.dto.MyBetSessionsResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultResponse;
import com.oneorthree.phone.group.dto.MyChallengeResultsResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeBetParticipantRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 챌린지 v2 조회·보고 축의 읽기 전용 서비스 (GROMO-1415·1416·1271) — 세 가지 조회 축을 담당한다.
 *
 * <ul>
 *   <li><b>참가자 스코프</b>(그룹 무관): {@code /me/bet-sessions}(보고 대상 탐색축 — N43) ·
 *       {@code /me/challenge-results}(결과 모달 큐의 유일한 소스 — N53). 그룹 멤버십을 보지 않는다
 *       — C8·N19 로 탈퇴자도 정산 대상으로 남는데 멤버십 축으로는 자기 회차·결과를 영영 못 본다.</li>
 *   <li><b>그룹장 스코프</b>: {@code deletion-preview}(N49·K11) — 삭제 경고 수치 프리플라이트.</li>
 *   <li><b>그룹 스코프</b>: {@code challenge-history}(N6-1) — 이력의 소유자를 그룹으로 승격해
 *       챌린지 삭제와 무관하게 조회한다(값은 회차 미션 스냅샷).</li>
 * </ul>
 *
 * <p>{@link GroupBetService}(참여·브리지·카드 조립)와 분리한 이유: 여기는 돈이 움직이지 않는
 * 순수 읽기라 잠금 규율이 없고, 신 엔드포인트 계약(LLD §2)이 레거시 브리지(N36)와 섞이면 어느
 * 필드가 구앱 계약인지 흐려진다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupBetQueryService {

    /** 결과 큐 보존 창(§D3) — 최근 30일 초과분은 버린다(수용). 앱 seen 마커 프룬(60일)보다 짧아야 재생이 없다. */
    static final Duration RESULTS_WINDOW = Duration.ofDays(30);

    /** 결과 큐 최대 건수(§D3). limit 파라미터의 상한이자 기본값이다. */
    static final int MAX_RESULTS = 10;

    /** 내역 페이지 크기 상한 — 레거시 내기 히스토리({@code GroupBetService})와 같은 값. */
    static final int MAX_HISTORY_PAGE_SIZE = 100;

    /**
     * 내역·결과에 실리는 status — 정산 결과 4종. UNUSED(0명 종료)는 결과가 아니라 어디에도 싣지
     * 않는다(N52). VOIDED 는 신 API 부터 노출한다(레거시 3종 목록과 갈라지는 지점).
     *
     * <p>정의의 주인은 상태 enum 이다({@link GroupBetStatus#RESULT_STATUSES}) — 조회와 ack 이 목록을
     * 따로 들면 한쪽만 고쳐졌을 때 "조회에는 실리는데 확인 표시는 거부되는" 결과가 생긴다.
     */
    private static final List<GroupBetStatus> RESULT_STATUSES = GroupBetStatus.RESULT_STATUSES;

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeBetSessionRepository groupChallengeBetSessionRepository;
    private final GroupChallengeBetParticipantRepository groupChallengeBetParticipantRepository;

    // ── 참가자 스코프 (그룹 무관) ─────────────────────────────────────────

    /**
     * 내 OPEN 회차 목록(GROMO-1415, N43 보고 대상 탐색축) — 그룹 목록을 타지 않으므로 탈퇴 후에도,
     * 챌린지가 종료된 뒤에도 내가 참가비를 건 진행 중 회차를 찾을 수 있다. 미션 스냅샷을 실어야
     * 앱이 창 시각·목표를 알고 보고한다 — 챌린지 행 조인이 불가능한 상황(종료·삭제)이 이 API 의
     * 존재 이유다.
      *
      * @param userId 요청자 — 그룹 소속과 무관하게 내 참가 행만 훑는다
      * @return 내가 참가비를 건 진행 중 회차 목록. 참가 중인 회차가 없으면 빈 목록이고,
      *     그것이 곧 「지금 보고할 창이 없다」는 뜻이다
     */
    public MyBetSessionsResponse getMyOpenBetSessions(UUID userId) {
        requireActiveUserNoLock(userId);
        List<MyBetSessionResponse> sessions = groupChallengeBetParticipantRepository
                .findOpenSessionParticipationsByUserId(userId).stream()
                .map(GroupChallengeBetParticipant::getSession)
                .map(session -> MyBetSessionResponse.builder()
                        .sessionId(session.getId())
                        .groupId(session.getGroup().getId())
                        .challengeId(session.getChallenge().getId())
                        .sessionDate(session.getSessionDate())
                        .missionCategory(session.getMissionCategory())
                        .missionType(session.getMissionType())
                        .goalMinutes(session.getGoalMinutes())
                        .windowStart(session.getWindowStart())
                        .windowEnd(session.getWindowEnd())
                        .closesAt(session.getClosesAt())
                        .settleAfter(session.getSettleAfter())
                        .build())
                .toList();
        return new MyBetSessionsResponse(sessions);
    }

    /**
     * 내 정산 완료 회차(GROMO-1415, N53) — 결과 모달 큐의 단일 소스. 그룹 멤버십과 챌린지
     * ACTIVE/ENDED 를 보지 않는다(탈퇴자·종료 챌린지도 실린다). 삭제된 챌린지의 회차는 제외
     * (FR-44-4·N48 — 리포지토리 술어), UNUSED 는 status 목록에서 제외(N52).
     *
     * @param userId 요청자 — 확인 여부가 유저별이라 같은 회차라도 사람마다 다른 결과가 나온다
     * @param since 정산 시각({@code settled_at}) 하한 — 생략 시 최근 30일. 30일보다 과거를 줘도
     *              30일 바닥으로 보정한다(§D3 — seen 마커 프룬 주기보다 짧아야 재생이 없다)
     * @param limit 최대 건수 — 생략 시 {@value #MAX_RESULTS}, 범위(1~{@value #MAX_RESULTS}) 밖이면
     *              {@code INVALID_PAGE_REQUEST} 400
     * @return 아직 확인하지 않은 정산 회차 목록. 다 봤으면 빈 목록이고, 그것이 곧 「띄울 모달이
     *     없다」는 뜻이다
     */
    public MyChallengeResultsResponse getMyChallengeResults(UUID userId, Instant since, Integer limit) {
        requireActiveUserNoLock(userId);
        int effectiveLimit = limit == null ? MAX_RESULTS : limit;
        if (effectiveLimit < 1 || effectiveLimit > MAX_RESULTS) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        Instant floor = Instant.now().minus(RESULTS_WINDOW);
        Instant effectiveSince = (since == null || since.isBefore(floor)) ? floor : since;

        List<GroupChallengeBetParticipant> mine = groupChallengeBetParticipantRepository
                .findSettledParticipationsByUserId(userId, RESULT_STATUSES, effectiveSince,
                        PageRequest.of(0, effectiveLimit));
        if (mine.isEmpty()) {
            return new MyChallengeResultsResponse(List.of());
        }

        List<UUID> sessionIds = mine.stream().map(p -> p.getSession().getId()).toList();
        Map<UUID, List<GroupChallengeBetParticipant>> participantsBySession =
                groupChallengeBetParticipantRepository.findBySessionIdIn(sessionIds).stream()
                        .collect(Collectors.groupingBy(p -> p.getSession().getId()));

        List<MyChallengeResultResponse> results = mine.stream()
                .map(my -> {
                    GroupChallengeBetSession session = my.getSession();
                    List<GroupChallengeBetParticipant> participants =
                            participantsBySession.getOrDefault(session.getId(), List.of());
                    GroupChallenge challenge = session.getChallenge();
                    return MyChallengeResultResponse.builder()
                            .sessionId(session.getId())
                            .groupId(session.getGroup().getId())
                            .groupName(session.getGroup().getName())
                            .challengeId(challenge.getId())
                            .challengeDeleted(challenge.getDeletedAt() != null)
                            .challengeEnded(challenge.getStatus() != GroupChallengeStatus.ACTIVE)
                            .sessionDate(session.getSessionDate())
                            .stake(session.getStake())
                            .pot(session.getStake() * participants.size())
                            .status(session.getStatus())
                            .voidReason(session.getVoidReason())
                            .goalMinutes(session.getGoalMinutes())
                            .missionCategory(session.getMissionCategory())
                            .missionType(session.getMissionType())
                            .windowStart(session.getWindowStart())
                            .windowEnd(session.getWindowEnd())
                            .myAchieved(my.getAchieved())
                            .myPayout(my.getPayout())
                            .results(GroupBetService.toResultParticipants(participants))
                            // 미확인만 실리므로 항상 false 다 — 계약 표면으로 유지한다(N58).
                            // 필터가 limit 뒤에 오면 확인된 10건이 상한을 점유해 11번째 미확인
                            // 결과가 영영 조회되지 않는다(리포지토리 술어 주석 참조).
                            .acknowledged(my.isAcknowledged())
                            .settledAt(session.getSettledAt())
                            .build();
                })
                .toList();
        return new MyChallengeResultsResponse(results);
    }

    // ── 그룹장 스코프 ────────────────────────────────────────────────────

    /**
     * 삭제 프리플라이트(GROMO-1416, N49) — OPEN 회차 전부(예약된 미래 포함)의 날짜·인원·적립금과
     * 총 환불액. 그룹장 전용이다(경고는 삭제 확인 시트의 것 — 평시 카드 조회는 불변). 챌린지는
     * 그룹 바인딩으로 조회한다 — challengeId 만으로 읽으면 내가 방장인 그룹 gid + 남의 그룹 cid
     * 조합의 IDOR 이 성립한다(삭제 본체와 같은 규율).
      *
      * @param groupId 챌린지 스코프 — 이 바인딩이 IDOR 을 막는다
      * @param challengeId 삭제를 검토 중인 챌린지
      * @param userId 요청자 — 방장이 아니면 {@code NOT_OWNER}
      * @return 삭제하면 무효화될 OPEN 회차 전부와 환불 총액. 걸린 회차가 없으면 빈 목록·0 원이라
      *     시트가 「돌려줄 돈 없음」을 확신하고 그릴 수 있다
     */
    public ChallengeDeletionPreviewResponse getDeletionPreview(UUID groupId, UUID challengeId, UUID userId) {
        User user = requireActiveUserNoLock(userId);
        Group group = groupQueryService.getGroup(groupId);
        GroupMember member = groupQueryService.getMembership(user, group);
        if (member.getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }
        groupChallengeRepository.findByIdAndGroupAndDeletedAtIsNull(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        List<GroupChallengeBetSession> openSessions = groupChallengeBetSessionRepository
                .findByChallengeIdAndStatusOrderBySessionDateAscIdAsc(challengeId, GroupBetStatus.OPEN);
        Map<UUID, Long> countBySession = openSessions.isEmpty() ? Map.of()
                : groupChallengeBetParticipantRepository
                        .findBySessionIdIn(openSessions.stream().map(GroupChallengeBetSession::getId).toList())
                        .stream()
                        .collect(Collectors.groupingBy(p -> p.getSession().getId(), Collectors.counting()));

        List<ChallengeDeletionPreviewResponse.OpenSessionPreview> previews = openSessions.stream()
                .map(session -> {
                    int participantCount = countBySession.getOrDefault(session.getId(), 0L).intValue();
                    return new ChallengeDeletionPreviewResponse.OpenSessionPreview(
                            session.getSessionDate(), participantCount, session.getStake() * participantCount);
                })
                .toList();
        int totalRefund = previews.stream()
                .mapToInt(ChallengeDeletionPreviewResponse.OpenSessionPreview::pot).sum();
        return new ChallengeDeletionPreviewResponse(previews, totalRefund);
    }

    // ── 그룹 스코프 ──────────────────────────────────────────────────────

    /**
     * 그룹 챌린지 내역(GROMO-1271, N6-1) — 그룹 단위 회차 이력, 챌린지 삭제와 무관하게 조회된다
     * (표시 값은 회차 미션 스냅샷 — 챌린지 조인은 삭제 배지 하나뿐이다). 커서는 직전 페이지 마지막
     * 항목의 sessionId 로, 서버가 {@code (session_date, id)} 튜플로 해석해 keyset 을 잇는다 —
     * 그룹 전체 조회라 같은 날짜에 회차가 여럿이라 날짜 단독 커서는 경계에서 스킵/중복이 생긴다.
     *
     * @param groupId 이력을 볼 그룹
     * @param userId 요청자 — 그룹원이 아니면 {@code MEMBER_ONLY}
     * @param cursor 직전 페이지 마지막 항목의 sessionId — null 이면 첫 페이지다
     * @param size 페이지 크기 — 범위 밖이면 {@code INVALID_PAGE_REQUEST} 400
     * @param challengeId 선택 — 특정 챌린지로 필터(챌린지별 이력 화면). 그룹 스코프는 유지된다
     * @return 회차 이력 한 페이지(최신순). 마지막 페이지면 {@code nextCursor} 가 null 이다
     */
    public GroupChallengeHistorySliceResponse getGroupChallengeHistory(
            UUID groupId, UUID userId, UUID cursor, int size, UUID challengeId) {
        if (size < 1 || size > MAX_HISTORY_PAGE_SIZE) {
            throw new GroupException(GroupErrorCode.INVALID_PAGE_REQUEST);
        }
        User user = requireActiveUserNoLock(userId);
        Group group = groupQueryService.getGroup(groupId);
        groupQueryService.getMembership(user, group);

        Slice<GroupChallengeBetSession> slice =
                loadHistorySlice(groupId, cursor, size, challengeId);
        List<GroupChallengeBetSession> pageSessions = slice.getContent();
        Map<UUID, List<GroupChallengeBetParticipant>> participantsBySession = pageSessions.isEmpty()
                ? Map.of()
                : groupChallengeBetParticipantRepository
                        .findBySessionIdIn(pageSessions.stream().map(GroupChallengeBetSession::getId).toList())
                        .stream()
                        .collect(Collectors.groupingBy(p -> p.getSession().getId()));

        List<GroupChallengeHistoryItemResponse> content = pageSessions.stream()
                .map(session -> toHistoryItem(session, userId,
                        participantsBySession.getOrDefault(session.getId(), List.of())))
                .toList();
        UUID nextCursor = slice.hasNext() && !pageSessions.isEmpty()
                ? pageSessions.get(pageSessions.size() - 1).getId()
                : null;
        return new GroupChallengeHistorySliceResponse(content, size, slice.hasNext(), nextCursor);
    }

    /** 커서 유무 × 챌린지 필터 유무의 4분기 — 커서는 이 그룹의 회차일 때만 해석한다(IDOR 차단). */
    private Slice<GroupChallengeBetSession> loadHistorySlice(
            UUID groupId, UUID cursor, int size, UUID challengeId) {
        PageRequest page = PageRequest.of(0, size);
        if (cursor == null) {
            return challengeId == null
                    ? groupChallengeBetSessionRepository
                            .findGroupHistoryFirstPage(groupId, RESULT_STATUSES, page)
                    : groupChallengeBetSessionRepository
                            .findGroupHistoryFirstPageByChallenge(groupId, challengeId, RESULT_STATUSES, page);
        }
        GroupChallengeBetSession cursorSession = groupChallengeBetSessionRepository
                .findByIdAndGroupId(cursor, groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.BET_NOT_FOUND));
        return challengeId == null
                ? groupChallengeBetSessionRepository.findGroupHistoryAfterCursor(
                        groupId, RESULT_STATUSES, cursorSession.getSessionDate(), cursorSession.getId(), page)
                : groupChallengeBetSessionRepository.findGroupHistoryAfterCursorByChallenge(
                        groupId, challengeId, RESULT_STATUSES,
                        cursorSession.getSessionDate(), cursorSession.getId(), page);
    }

    private GroupChallengeHistoryItemResponse toHistoryItem(
            GroupChallengeBetSession session, UUID userId, List<GroupChallengeBetParticipant> participants) {
        Optional<GroupChallengeBetParticipant> mine = participants.stream()
                .filter(p -> p.getUser().getId().equals(userId))
                .findFirst();
        int achievedCount = (int) participants.stream()
                .filter(p -> Boolean.TRUE.equals(p.getAchieved()))
                .count();
        return GroupChallengeHistoryItemResponse.builder()
                .sessionId(session.getId())
                .sessionDate(session.getSessionDate())
                .challengeId(session.getChallenge().getId())
                .challengeDeleted(session.getChallenge().getDeletedAt() != null)
                .missionCategory(session.getMissionCategory())
                .missionType(session.getMissionType())
                .goalMinutes(session.getGoalMinutes())
                .windowStart(session.getWindowStart())
                .windowEnd(session.getWindowEnd())
                .stake(session.getStake())
                .pot(session.getStake() * participants.size())
                .status(session.getStatus())
                .voidReason(session.getVoidReason())
                .myPayout(mine.map(GroupChallengeBetParticipant::getPayout).orElse(null))
                .myAchieved(mine.map(GroupChallengeBetParticipant::getAchieved).orElse(null))
                .myProgressMinutes(mine.map(GroupChallengeBetParticipant::getProgressMinutes).orElse(null))
                .achievedCount(achievedCount)
                .participantCount(participants.size())
                .build();
    }

    /**
     * 활성 검증의 락 없는 판(GROMO-1230) — 순수 읽기(readOnly) 경로 전용. Postgres 가
     * read-only 트랜잭션에서 FOR SHARE 를 거절하고, 순수 조회는 잠글 이유도 없다.
     */
    private User requireActiveUserNoLock(UUID userId) {
        return userQueryService.getCaller(userId);
    }
}
