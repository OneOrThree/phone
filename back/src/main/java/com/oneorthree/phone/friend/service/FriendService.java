package com.oneorthree.phone.friend.service;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.NoArgGenerator;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.service.FocusLiveInfoLookup;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.domain.PinnedUser;
import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.friend.search.FriendSearchStrategy;
import com.oneorthree.phone.friend.search.SearchType;
import com.oneorthree.phone.league.service.LeagueTierLookup;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class FriendService {

    // pinned_users.id 직접 생성용 (네이티브 INSERT는 @GeneratedUuidV7를 안 타므로 직접 발급)
    private static final NoArgGenerator UUID_V7 = Generators.timeBasedEpochRandomGenerator();

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;
    private final PinnedUserRepository pinnedUserRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final LeagueTierLookup leagueTierLookup;
    private final FocusLiveInfoLookup focusLiveInfoLookup;
    // GROMO-1090: 푸시는 여기서 직접 보내지 않고 이벤트만 발행한다 — 발송은 커밋 이후에 일어나야 한다
    // (요청/수락이 롤백되는데 알림만 나가면 안 된다). 소비는 notification 도메인의 AFTER_COMMIT 리스너.
    private final ApplicationEventPublisher eventPublisher;
    private final Map<SearchType, FriendSearchStrategy> searchStrategies;

    // 검색 전략은 AuthService의 Map<Provider, SocialLoginClient>와 동일하게
    // 모든 빈을 모아 type() 기준 Map으로 구성한다. (검색 수단 추가 = 구현체 1개 추가)
    public FriendService(FriendshipRepository friendshipRepository,
                         UserRepository userRepository,
                         PinnedUserRepository pinnedUserRepository,
                         DailyFocusStatRepository dailyFocusStatRepository,
                         FocusSessionRepository focusSessionRepository,
                         CharacterEquipmentRepository characterEquipmentRepository,
                         UserActivityEventLogger userActivityEventLogger,
                         LeagueTierLookup leagueTierLookup,
                         FocusLiveInfoLookup focusLiveInfoLookup,
                         ApplicationEventPublisher eventPublisher,
                         List<FriendSearchStrategy> searchStrategies) {
        this.friendshipRepository = friendshipRepository;
        this.userRepository = userRepository;
        this.pinnedUserRepository = pinnedUserRepository;
        this.dailyFocusStatRepository = dailyFocusStatRepository;
        this.focusSessionRepository = focusSessionRepository;
        this.characterEquipmentRepository = characterEquipmentRepository;
        this.userActivityEventLogger = userActivityEventLogger;
        this.leagueTierLookup = leagueTierLookup;
        this.focusLiveInfoLookup = focusLiveInfoLookup;
        this.eventPublisher = eventPublisher;
        this.searchStrategies = searchStrategies.stream()
                .collect(Collectors.toMap(FriendSearchStrategy::type, strategy -> strategy));
    }

    // 친구 요청 생성. 자기자신·중복·이미친구 검증 후 PENDING insert,
    // 단 내가 보냈던 행이 남아 있으면 재사용한다 — soft delete 행은 복원(GROMO-719),
    // REJECTED 행은 PENDING 재전환(쿨다운은 GROMO-475).
    @Transactional
    public void createRequest(UUID me, UUID targetUserId) {
        if (me.equals(targetUserId)) {
            throw new FriendException(FriendErrorCode.SELF_REQUEST);
        }
        User fromUser = getRelationParticipant(me);
        User toUser = getRelationParticipant(targetUserId);

        List<Friendship> pair = friendshipRepository.findPair(fromUser, toUser);
        for (Friendship f : pair) {
            if (f.getStatus() == FriendshipStatus.ACCEPTED && f.getDeletedAt() == null) {
                throw new FriendException(FriendErrorCode.ALREADY_FRIEND);
            }
            if (f.getStatus() == FriendshipStatus.PENDING) {
                throw new FriendException(FriendErrorCode.REQUEST_ALREADY_EXISTS);
            }
        }

        // unique(from,to) 충돌 회피 1: 내가 보냈던 (me→target) soft delete 행이 있으면 복원해 재사용 (GROMO-719).
        // 친구 삭제(deleteFriend)는 status=ACCEPTED 를 남긴 채 deletedAt 만 찍는데, 이 행을 안 되살리면
        // save() 가 unique(from,to) 와 충돌해 409 로 죽고 그 방향은 영영 요청 불가가 된다.
        // deletedAt 을 status 보다 먼저 봐야 한다 — 삭제된 REJECTED 행이 아래 재전환 분기로 빠지면
        // reopen() 이 deletedAt 을 안 지워 PENDING 인데도 목록·수락 경로에서 안 보이는 유령 요청이 된다.
        Friendship myDeleted = pair.stream()
                .filter(f -> f.getFromUser().getId().equals(me) && f.getDeletedAt() != null)
                .findFirst()
                .orElse(null);
        if (myDeleted != null) {
            myDeleted.restore();
            onRequestCreated(myDeleted.getId(), me, targetUserId, true);
            return;
        }

        // unique(from,to) 충돌 회피 2: 내가 보냈던 (me→target) REJECTED row가 있으면 재전환.
        // 위 복원 분기가 삭제 행을 먼저 걷어가므로 여기 도달하는 내 방향 행은 항상 deletedAt == null 이다.
        Friendship myRejected = pair.stream()
                .filter(f -> f.getFromUser().getId().equals(me)
                        && f.getStatus() == FriendshipStatus.REJECTED)
                .findFirst()
                .orElse(null);
        if (myRejected != null) {
            myRejected.reopen();
            onRequestCreated(myRejected.getId(), me, targetUserId, true);
            return;
        }

        Friendship request = Friendship.builder()
                .fromUser(fromUser)
                .toUser(toUser)
                .status(FriendshipStatus.PENDING)
                .build();
        // persist 가 이 인스턴스에 id 를 채우므로(@GeneratedUuidV7) 저장 후 그대로 읽어 이벤트에 싣는다.
        friendshipRepository.save(request);
        onRequestCreated(request.getId(), me, targetUserId, false);
    }

    // 요청 생성 후처리 — 신규 insert·REJECTED 재전환 두 경로 모두 1회씩, reopened 로 구분.
    // 활동 로그(즉시)와 푸시 이벤트(커밋 이후 소비)를 함께 낸다. 재전환도 수신자 입장에선 새 요청이라
    // 두 경로 모두 알린다 — 발송 측 dedup 은 동시 reopen 경합만 접고, 재요청 도배 억제는 요청
    // 쿨다운(티켓 475)의 몫이다(GROMO-1090).
    private void onRequestCreated(UUID requestId, UUID me, UUID targetUserId, boolean reopened) {
        userActivityEventLogger.log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetUserId.toString(), "reopened", reopened));
        eventPublisher.publishEvent(new FriendRequestSentEvent(requestId, targetUserId, me));
    }

    // 요청 수락 — 수신자(toUser)만 가능. PENDING → ACCEPTED.
    // 상태 계약은 거절과 비대칭이다 (GROMO-719 오너 결정):
    //   - 수락은 전 상태 관용 — REJECTED → ACCEPTED 는 "거절했다 뒤늦게 수락" UX 로 의도된 전이라 허용하고
    //     알린다("거절했던 요청을 뒤늦게 수락하면 알린다" 계약). ACCEPTED → ACCEPTED 는 멱등(무알림).
    //   - 거절은 PENDING 한정(rejectRequest) — ACCEPTED 에 거절이 통하면 친구 관계가 deleteFriend 를
    //     우회해 조용히 증발하기 때문. 수락은 관계를 늘리는 방향이라 관용해도 그런 파괴 경로가 없다.
    @Transactional
    public void acceptRequest(UUID me, UUID requestId) {
        Friendship friendship = getReceivedRequest(me, requestId);
        // 이 호출이 실제로 상태를 바꾼 것인지 먼저 본다 — 아래 알림 발행 조건 (GROMO-1090).
        boolean alreadyAccepted = friendship.getStatus() == FriendshipStatus.ACCEPTED;
        friendship.accept();
        UUID requesterId = friendship.getFromUser().getId();
        userActivityEventLogger.log(UserActivityEvent.FRIEND_ADDED,
                Map.of("request_id", requestId.toString(),
                        "from_user_id", requesterId.toString()));
        // 수락 사실은 보낸 쪽만 모른다 — 그쪽에만 알린다 (GROMO-1090). 발송은 커밋 이후.
        // 이미 ACCEPTED 인 요청에 수락이 또 들어와도(이 API 는 상태를 검사하지 않는다) 알리지 않는다 —
        // 늦게 도착한 재시도까지 발송 측 dedup 창에 기대면 창이 짧을수록 중복이 새 나간다(@codex 리뷰).
        if (!alreadyAccepted) {
            eventPublisher.publishEvent(new FriendRequestAcceptedEvent(requesterId, me));
        }
    }

    // 요청 거절 — 수신자(toUser)만 가능. PENDING → REJECTED 만 허용 (GROMO-719).
    // 수락과 달리 상태를 검사한다 — ACCEPTED 에 거절이 통하면 친구 관계가 deleteFriend 없이
    // (삭제 절차·검증을 우회해) 조용히 증발하고, 이후 재요청의 REJECTED 재전환 분기로 되살아나기까지 한다.
    // 거절은 알리지 않는다 (GROMO-1090) — 거절 통보는 관계상 부담이라 스코프에서 뺐다.
    @Transactional
    public void rejectRequest(UUID me, UUID requestId) {
        Friendship friendship = getReceivedRequest(me, requestId);
        if (friendship.getStatus() != FriendshipStatus.PENDING) {
            throw new FriendException(FriendErrorCode.INVALID_REQUEST_STATUS);
        }
        friendship.reject();
    }

    // 친구 삭제 — ACCEPTED 관계를 양측 누구나 soft delete.
    @Transactional
    public void deleteFriend(UUID me, UUID friendUserId) {
        User meUser = getUser(me);
        User friendUser = getAnyUser(friendUserId);   // 탈퇴자와의 잔존 관계도 끊을 수 있어야 한다 (GROMO-801)
        Friendship friendship = friendshipRepository.findAcceptedBetween(meUser, friendUser)
                .orElseThrow(() -> new FriendException(FriendErrorCode.NOT_FRIEND));
        friendship.softDelete(Instant.now());
    }

    // 친구 목록 — ACCEPTED·미삭제 관계를 상대 유저로 매핑. isPinned는 내 핀 친구 집합으로 결정.
    public List<FriendResponse> getFriends(UUID me, LocalDate date) {
        User meUser = getUser(me);
        Set<UUID> pinnedIds = pinnedUserRepository.findByUser(meUser).stream()
                .map(p -> p.getPinnedUser().getId())
                .collect(Collectors.toSet());
        List<User> others = friendshipRepository.findAcceptedByUser(meUser).stream()
                .map(f -> counterpart(f, me))
                .toList();
        List<UUID> otherIds = others.stream().map(User::getId).toList();
        // GROMO-710: 상대 userId 들을 한 번에 모아 티어 배치 조회(N+1 방지). 티어는 league_arena_users 로만 도출(GROMO-671).
        Map<UUID, Integer> tierLevels = leagueTierLookup.tierLevelsByUserId(otherIds);
        // GROMO-822: 상대 userId 들의 집중 라이브 정보(당일 집중분·진행중 여부·시작시각·태그명)를 1회 배치 조회(N+1 방지).
        // date 는 클라 로컬 타임존 기준 오늘(/pins 와 동일). 미조회 유저는 맵에 없어 아래에서 기본값(0/false/null) 처리.
        Map<UUID, FocusLiveInfo> liveInfo = focusLiveInfoLookup.liveInfoByUserId(otherIds, date);
        return others.stream()
                .map(other -> {
                    FocusLiveInfo info = liveInfo.get(other.getId());
                    return FriendResponse.builder()
                            .userId(other.getId())
                            .nickname(other.getNickname())
                            .occupation(other.getOccupation() != null ? other.getOccupation().name() : null)
                            .tierLevel(tierLevels.get(other.getId()))
                            .isPinned(pinnedIds.contains(other.getId()))
                            .isFocusing(info != null && info.isFocusing())
                            .focusTimeMinutes(info != null ? info.focusTimeMinutes() : 0)
                            .focusStartedAt(info != null ? info.focusStartedAt() : null)
                            .focusTagName(info != null ? info.focusTagName() : null)
                            .build();
                })
                .toList();
    }

    // 유저 핀 설정 — 친구 아닌 임의 유저도 핀 가능(user 핀 통일, GROMO-609). 대상 존재만 검증 후 멱등 insert.
    @Transactional
    public void pinFriend(UUID me, UUID friendUserId) {
        if (me.equals(friendUserId)) {
            throw new FriendException(FriendErrorCode.SELF_PIN);
        }
        // 양쪽 다 활성 검증 + 탈퇴와 직렬화 (GROMO-801) — 없으면 FK 위반 500 대신 NOT_FOUND(404)
        getRelationParticipant(me);
        getRelationParticipant(friendUserId);
        // ON CONFLICT DO NOTHING — 동시 핀 요청에도 멱등(중복은 무시), 500 없음.
        pinnedUserRepository.insertIgnoreConflict(UUID_V7.generate(), me, friendUserId);
    }

    // 친구 핀 해제 — 있으면 삭제, 없으면 멱등(204).
    @Transactional
    public void unpinFriend(UUID me, UUID friendUserId) {
        getUser(me);
        getAnyUser(friendUserId);   // 탈퇴자 핀도 해제 가능해야 한다 (GROMO-801)
        // 벌크 DELETE — 조회 후 remove 하면 탈퇴의 핀 정리와 겹칠 때 0 행 DELETE 로 StaleStateException(500).
        // 0 행 = 이미 없음이므로 그대로 멱등 성공(204).
        pinnedUserRepository.deletePin(me, friendUserId);
    }

    // 내가 핀한 친구 조회 — 각 친구의 캐릭터 표시정보 + 오늘 집중분 + 진행중 여부 매핑(GROMO-369 재사용).
    public List<PinnedUserResponse> getPinnedFriends(UUID me, LocalDate date) {
        User meUser = getUser(me);
        List<User> friends = pinnedUserRepository.findByUser(meUser).stream()
                .map(PinnedUser::getPinnedUser)
                .toList();
        if (friends.isEmpty()) {
            return List.of();
        }

        // GROMO-643: 클라 로컬 날짜(date)로 오늘 집계 조회 (저장과 동일 기준, UTC 산정 제거)
        Map<UUID, Integer> focusMap = dailyFocusStatRepository.findByUserInAndDate(friends, date).stream()
                // GROMO-642: 초 저장 → 분 환산
                .collect(Collectors.toMap(s -> s.getUser().getId(), s -> s.getTotalFocusSeconds() / 60));
        Set<UUID> focusingIds = focusSessionRepository.findByUserInAndEndedAtIsNull(friends).stream()
                .map(s -> s.getUser().getId())
                .collect(Collectors.toSet());
        Map<UUID, List<CharacterEquipmentResponse>> equipMap =
                characterEquipmentRepository.findByUserIn(friends).stream()
                        .collect(Collectors.groupingBy(e -> e.getUser().getId(),
                                Collectors.mapping(CharacterEquipmentResponse::from, Collectors.toList())));

        return friends.stream()
                .map(f -> PinnedUserResponse.builder()
                        .userId(f.getId())
                        .nickname(f.getNickname())
                        .character(equipMap.getOrDefault(f.getId(), List.of()))
                        .focusTimeMinutes(focusMap.getOrDefault(f.getId(), 0))
                        .isFocusing(focusingIds.contains(f.getId()))
                        .build())
                .toList();
    }

    // PENDING 요청 목록 — type=received(받은) | sent(보낸).
    public List<FriendRequestResponse> getRequests(UUID me, String type) {
        User meUser = getUser(me);
        boolean received = "received".equalsIgnoreCase(type);
        List<Friendship> requests = received
                ? friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(meUser, FriendshipStatus.PENDING)
                : friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(meUser, FriendshipStatus.PENDING);

        // GROMO-710: 상대 userId 들을 한 번에 모아 티어 배치 조회(N+1 방지). 티어는 league_arena_users 로만 도출(GROMO-671).
        Map<UUID, Integer> tierLevels = leagueTierLookup.tierLevelsByUserId(requests.stream()
                .map(f -> (received ? f.getFromUser() : f.getToUser()).getId())
                .toList());
        return requests.stream()
                .map(f -> {
                    User other = received ? f.getFromUser() : f.getToUser();
                    return FriendRequestResponse.builder()
                            .requestId(f.getId())
                            .userId(other.getId())
                            .nickname(other.getNickname())
                            .tierLevel(tierLevels.get(other.getId()))
                            // 요청 시각의 소스는 updatedAt — 행 재사용(복원·재전환) 시 createdAt 은 원래
                            // 관계의 시각이 남는다(@CreationTimestamp 가 insert 생성이라 갱신 불가,
                            // Friendship.reopen() 주석). 이 목록은 PENDING 만 실으므로 마지막 변경 시각이
                            // 곧 요청 사이클 시작 시각이다 — 신규 insert·재전환·복원 세 경로 모두 (GROMO-719).
                            .createdAt(f.getUpdatedAt())
                            .build();
                })
                .toList();
    }

    // 친구 검색 — type 전략에 위임 후 자기자신 제외 + 기존 관계(relation) 표기.
    public List<FriendSearchResultResponse> search(UUID me, SearchType type, String query) {
        FriendSearchStrategy strategy = searchStrategies.get(type);
        if (strategy == null) {
            throw new IllegalArgumentException("지원하지 않는 검색 수단입니다: " + type);
        }
        User meUser = getUser(me);
        Set<UUID> friendIds = collectFriendIds(meUser);
        Set<UUID> pendingIds = collectPendingIds(meUser);

        return strategy.search(me, query).stream()
                .filter(r -> !r.getUserId().equals(me))
                .map(r -> FriendSearchResultResponse.builder()
                        .userId(r.getUserId())
                        .nickname(r.getNickname())
                        .tierLevel(r.getTierLevel())
                        .occupation(r.getOccupation())
                        .relation(resolveRelation(r.getUserId(), friendIds, pendingIds))
                        .build())
                .toList();
    }

    // ── 내부 헬퍼 ──────────────────────────────────────────

    // 활성 유저 조회 — 탈퇴(소프트딜리트) 유저는 없는 유저로 취급 (GROMO-801).
    // 호출자 본인(me) 확인과 일반 조회에 쓴다.
    private User getUser(UUID userId) {
        return userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    // 관계 '생성'(친구 요청·핀)에 참여하는 유저 조회 (GROMO-801) — 활성 검증 + 공유 락.
    // 활성 검증: findById 를 쓰면 탈퇴자에게 요청이 걸리고, friendships 에 남은 (from,to) 유니크 제약과
    //           충돌해 500 이 난다.
    // 공유 락: 탈퇴 트랜잭션의 배타 락과 직렬화해, 정리가 끝난 뒤 새 관계가 끼어드는 레이스를 막는다.
    // 관계는 두 유저를 묶으므로 대상뿐 아니라 호출자(me) 에도 걸어야 한다 — 한쪽만 잠그면 잠그지 않은 쪽이
    // 탈퇴 중일 때 그 유저 소유의 유령 관계가 그대로 남는다.
    // 공유 락끼리는 충돌하지 않아 동시 요청은 병렬 그대로고, 탈퇴(배타 락)하고만 직렬화된다.
    private User getRelationParticipant(UUID userId) {
        return userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    // 관계 '해제'(친구 삭제·핀 해제) 대상 조회 (GROMO-801) — 탈퇴 여부를 보지 않는다.
    // 활성 검증을 걸면 상대가 탈퇴한 순간 잔존 관계를 영구히 못 지운다. 특히 이 변경 배포 전에 탈퇴해
    // 정리되지 않은 관계는 사용자가 직접 끊는 것이 유일한 해소 수단이다(백필을 하지 않으므로).
    // 해제는 관계를 줄이는 방향이라 탈퇴자를 대상으로 허용해도 유령이 늘지 않는다.
    private User getAnyUser(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    // requestId로 PENDING 요청 조회 후 수신자(toUser) 본인인지 검증.
    // 탈퇴 정리로 soft delete 된 요청은 없는 요청으로 취급 (GROMO-801) — 목록에서 숨긴 것을 변경도 막는다.
    private Friendship getReceivedRequest(UUID me, UUID requestId) {
        Friendship friendship = friendshipRepository.findByIdAndDeletedAtIsNull(requestId)
                .orElseThrow(() -> new FriendException(FriendErrorCode.REQUEST_NOT_FOUND));
        if (!friendship.getToUser().getId().equals(me)) {
            throw new FriendException(FriendErrorCode.NOT_REQUEST_RECEIVER);
        }
        return friendship;
    }

    // 친구 관계에서 내가 아닌 상대 유저를 반환.
    private User counterpart(Friendship friendship, UUID me) {
        return friendship.getFromUser().getId().equals(me)
                ? friendship.getToUser()
                : friendship.getFromUser();
    }

    private Set<UUID> collectFriendIds(User meUser) {
        return friendshipRepository.findAcceptedByUser(meUser).stream()
                .map(f -> counterpart(f, meUser.getId()).getId())
                .collect(Collectors.toCollection(HashSet::new));
    }

    private Set<UUID> collectPendingIds(User meUser) {
        Set<UUID> ids = new HashSet<>();
        friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(meUser, FriendshipStatus.PENDING)
                .forEach(f -> ids.add(f.getToUser().getId()));
        friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(meUser, FriendshipStatus.PENDING)
                .forEach(f -> ids.add(f.getFromUser().getId()));
        return ids;
    }

    private FriendRelation resolveRelation(UUID userId, Set<UUID> friendIds, Set<UUID> pendingIds) {
        if (friendIds.contains(userId)) {
            return FriendRelation.FRIEND;
        }
        if (pendingIds.contains(userId)) {
            return FriendRelation.PENDING;
        }
        return FriendRelation.NONE;
    }
}
