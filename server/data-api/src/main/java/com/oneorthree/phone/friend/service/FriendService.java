package com.oneorthree.phone.friend.service;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.NoArgGenerator;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.MainIslandNamePort;
import com.oneorthree.phone.common.ratelimit.PerUserHourlyLimiter;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.service.FocusLiveInfoLookup;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.letter.repository.LetterRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.domain.PinnedUser;
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
import com.oneorthree.phone.friend.service.search.FriendSearchStrategy;
import com.oneorthree.phone.friend.service.search.SearchType;
import com.oneorthree.phone.user.service.UserTierLookup;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 친구 요청·수락·거절·삭제와 핀, 그리고 친구 검색을 묶은 서비스.
 *
 * <p>이 도메인의 어려움은 대부분 <b>행 재사용</b>에서 온다. friendships 는 (from, to) 방향당 한 행만
 * 허용하고 거절·삭제도 행을 남기므로, 재요청은 새로 넣는 대신 남은 행을 되살린다. 그래서 여기 있는
 * 판정 순서(삭제 행 복원 → REJECTED 재전환 → 신규 insert)는 취향이 아니라 유니크 제약을 피하려는 필수 순서다.
 *
 * <p>목록 조회는 상대 유저가 여럿이라 티어·집중 라이브·캐릭터를 전부 <b>배치 조회</b>로 모은다(N+1 방지).
 * 알림은 여기서 직접 보내지 않고 이벤트만 발행해, 트랜잭션이 롤백되면 알림도 나가지 않게 한다.
 */
@Service
@Transactional(readOnly = true)
public class FriendService {

    /**
     * pinned_users.id 직접 생성용 (네이티브 INSERT는 @GeneratedUuidV7를 안 타므로 직접 발급)
     */
    private static final NoArgGenerator UUID_V7 = Generators.timeBasedEpochRandomGenerator();

    private final FriendshipRepository friendshipRepository;
    private final UserQueryService userQueryService;
    private final PinnedUserRepository pinnedUserRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final UserTierLookup userTierLookup;
    private final FocusLiveInfoLookup focusLiveInfoLookup;
    private final FriendRelationLookup friendRelationLookup;
    private final MainIslandNamePort mainIslandNamePort;
    /**
     * GROMO-2002: 친구를 끊으면 아직 확인하지 않은 편지도 지운다(policy-2026-09-14). letter 는 L2,
     * friend 는 L3 이라 참조가 아래로 간다 — {@code DomainLayerRulesTest} 가 이 방향을 위해 층을 갈라 뒀다.
     */
    private final LetterRepository letterRepository;
    /**
     * GROMO-1090: 푸시는 여기서 직접 보내지 않고 이벤트만 발행한다 — 발송은 커밋 이후에 일어나야 한다
     * (요청/수락이 롤백되는데 알림만 나가면 안 된다). 소비는 notification 도메인의 AFTER_COMMIT 리스너.
     */
    private final ApplicationEventPublisher eventPublisher;
    private final Map<SearchType, FriendSearchStrategy> searchStrategies;
    /** GROMO-1934: 게스트 계정의 친구 요청 시간 한도 — 정회원은 세지 않는다. */
    private final PerUserHourlyLimiter guestRequestLimiter;

    /**
     * 검색 전략은 AuthService의 Map&lt;Provider, SocialLoginClient>와 동일하게
     * 모든 빈을 모아 type() 기준 Map으로 구성한다. (검색 수단 추가 = 구현체 1개 추가)
     *
     * @param friendshipRepository        관계 행의 조회·정리 창구
     * @param userQueryService            id 로 하는 User 조회 — 활성 검증·락 선택을 계층이 맡는다
     * @param pinnedUserRepository        핀 설정·해제·조회
     * @param dailyFocusStatRepository    핀 목록의 "오늘 집중분" 집계 소스
     * @param focusSessionRepository      핀 목록의 "지금 집중 중" 판정 소스(끝나지 않은 세션)
     * @param characterEquipmentRepository 핀 목록에 실을 캐릭터 장착 표시정보
     * @param userActivityEventLogger     요청·수락 사실을 커밋과 무관하게 즉시 남기는 활동 로그
     * @param userTierLookup              상대들의 티어를 한 번에 뽑는 배치 조회기
     * @param focusLiveInfoLookup         상대들의 집중 라이브 정보를 한 번에 뽑는 배치 조회기
     * @param friendRelationLookup        검색 결과의 관계 배지 판정 — 프로필 도메인과 공유한다
     * @param mainIslandNamePort          상대들의 메인 섬 이름을 한 번에 뽑는 포트(GROMO-1971) — 섬은
     *                                    group(L5) 데이터라 friend(L3)가 직접 부르면 레이어 역행이다
     * @param letterRepository            친구 삭제에 딸린 미확인 편지 정리(GROMO-2002)
     * @param eventPublisher              푸시 발송을 커밋 이후로 미루기 위한 이벤트 발행기
     * @param searchStrategies            등록된 검색 전략 전부. {@code type()} 을 키로 Map 이 되며,
     *                                    키가 겹치면 기동 시점에 터진다
     * @param guestRequestLimiter         게스트 친구 요청 스팸 방어(GROMO-1934) — 레거시·내부 두 표면이 모두
     *                                    {@link #createRequest} 로 모이므로 여기 한 곳에서 센다
     */
    public FriendService(FriendshipRepository friendshipRepository,
                         UserQueryService userQueryService,
                         PinnedUserRepository pinnedUserRepository,
                         DailyFocusStatRepository dailyFocusStatRepository,
                         FocusSessionRepository focusSessionRepository,
                         CharacterEquipmentRepository characterEquipmentRepository,
                         UserActivityEventLogger userActivityEventLogger,
                         UserTierLookup userTierLookup,
                         FocusLiveInfoLookup focusLiveInfoLookup,
                         FriendRelationLookup friendRelationLookup,
                         MainIslandNamePort mainIslandNamePort,
                         LetterRepository letterRepository,
                         ApplicationEventPublisher eventPublisher,
                         List<FriendSearchStrategy> searchStrategies,
                         @Qualifier("friendRequestRateLimiter") PerUserHourlyLimiter guestRequestLimiter) {
        this.friendshipRepository = friendshipRepository;
        this.userQueryService = userQueryService;
        this.pinnedUserRepository = pinnedUserRepository;
        this.dailyFocusStatRepository = dailyFocusStatRepository;
        this.focusSessionRepository = focusSessionRepository;
        this.characterEquipmentRepository = characterEquipmentRepository;
        this.userActivityEventLogger = userActivityEventLogger;
        this.userTierLookup = userTierLookup;
        this.focusLiveInfoLookup = focusLiveInfoLookup;
        this.friendRelationLookup = friendRelationLookup;
        this.mainIslandNamePort = mainIslandNamePort;
        this.letterRepository = letterRepository;
        this.eventPublisher = eventPublisher;
        this.searchStrategies = searchStrategies.stream()
                .collect(Collectors.toMap(FriendSearchStrategy::type, strategy -> strategy));
        this.guestRequestLimiter = guestRequestLimiter;
    }

    /**
     * 친구 요청 생성. 자기자신·중복·이미친구 검증 후 PENDING insert,
     * 단 내가 보냈던 행이 남아 있으면 재사용한다 — soft delete 행은 복원(GROMO-719),
     * REJECTED 행은 PENDING 재전환(쿨다운은 GROMO-475).
     *
     * <p><b>아래 findPair 판정은 락을 잡지 않는다 — 일부러 그렇다</b>(GROMO-2042). 마지막 방어선은
     * V96 의 표현식 부분 유니크 인덱스 {@code uq_friendships_pending_pair}
     * ({@code least(from,to), greatest(from,to)} where {@code PENDING} 이고 미삭제)다.
     * A→B 와 B→A 가 동시에 오면 둘 다 「기존 행 없음」을 보고 지나가는데, 이때 지는 쪽은 커밋 시점에
     * 유니크 위반으로 떨어지고 {@code GlobalExceptionHandler.handleDataIntegrityViolation} 이 409 로 바꾼다
     * (같은 방향 동시 중복이 V1 의 unique 로 떨어지던 것과 같은 결이다).
     *
     * <p>「두 {@code users} 행을 배타 락」으로 직렬화하지 않은 이유: ① 행이 «아직 없을 때» 나는 경합이라
     * 잠글 관계 행이 없고({@code findAcceptedBetweenForUpdate} 의 「쌍당 한 행」 전제가 여기서는 성립하지
     * 않는다), users 두 행을 잡으면 방향마다 순서가 달라 새 교착이 생긴다 — 막으려면 「userId 오름차순」
     * 규칙을 같은 쌍을 잡는 모든 경로가 지켜야 하고, 어긴 경로는 부하 걸린 운영에서 교착 500 으로만
     * 드러난다. ② 요청 한 건이 상대의 {@code users} 행을 배타로 잡으면 상대의 프로필 수정·닉네임
     * 변경·탈퇴까지 줄을 선다. 그래서 여기서는 {@code users} 를 <b>공유 락</b>으로만 잡고
     * (서로 막지 않으므로 교착이 없다) 유일성은 인덱스에 맡긴다.
     *
     * @param me           요청을 보내는 유저
     * @param targetUserId 요청을 받을 유저. 자기 자신이면 SELF_REQUEST, 탈퇴자면 유저 없음으로 떨어진다
     * @return 이번 요청 사이클의 요청 행 id — 복원·재전환이면 되살린 행, 아니면 새 행 (GROMO-1894 내부 표면이
     *         결과 상태를 돌려주는 데 쓴다. 레거시 컨트롤러는 무시한다)
     */
    @Transactional
    public UUID createRequest(UUID me, UUID targetUserId) {
        if (me.equals(targetUserId)) {
            throw new FriendException(FriendErrorCode.SELF_REQUEST);
        }
        User fromUser = getCallerParticipant(me);
        User toUser = getRelationParticipant(targetUserId);

        // 락 없는 판정이다 — 동시에 들어온 반대 방향 요청은 여기서 못 거른다. 그건 V96 의
        // uq_friendships_pending_pair 가 커밋 시점에 잡고 409 로 떨어뜨린다(위 Javadoc 의 논증).
        List<Friendship> pair = friendshipRepository.findPair(fromUser, toUser);
        for (Friendship f : pair) {
            if (f.getStatus() == FriendshipStatus.ACCEPTED && f.getDeletedAt() == null) {
                throw new FriendException(FriendErrorCode.ALREADY_FRIEND);
            }
            if (f.getStatus() == FriendshipStatus.PENDING) {
                throw new FriendException(FriendErrorCode.REQUEST_ALREADY_EXISTS);
            }
        }
        // 한도는 판정을 다 통과한 «쓰기 직전»에 센다(GROMO-1934) — 이미 친구·중복 요청 같은 거절까지 세면
        // 앱 재시도 몇 번에 정상 게스트가 한 시간 막힌다. 게스트만 센다(오너 확정).
        if (fromUser.isGuest()) {
            guestRequestLimiter.acquire(me);
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
            return myDeleted.getId();
        }

        // unique(from,to) 충돌 회피 2: 내가 보냈던 (me→target) REJECTED·CANCELED row가 있으면 재전환.
        // 위 복원 분기가 삭제 행을 먼저 걷어가므로 여기 도달하는 내 방향 행은 항상 deletedAt == null 이다.
        // CANCELED 도 사정이 같다(GROMO-1894) — 취소한 요청을 다시 보낼 때 새 행을 넣을 수 없다.
        Friendship myClosed = pair.stream()
                .filter(f -> f.getFromUser().getId().equals(me)
                        && (f.getStatus() == FriendshipStatus.REJECTED
                                || f.getStatus() == FriendshipStatus.CANCELED))
                .findFirst()
                .orElse(null);
        if (myClosed != null) {
            myClosed.reopen();
            onRequestCreated(myClosed.getId(), me, targetUserId, true);
            return myClosed.getId();
        }

        Friendship request = Friendship.builder()
                .fromUser(fromUser)
                .toUser(toUser)
                .status(FriendshipStatus.PENDING)
                .build();
        // persist 가 이 인스턴스에 id 를 채우므로(@GeneratedUuidV7) 저장 후 그대로 읽어 이벤트에 싣는다.
        friendshipRepository.save(request);
        onRequestCreated(request.getId(), me, targetUserId, false);
        return request.getId();
    }

    /**
     * 요청 생성 후처리 — 신규 insert·REJECTED 재전환 두 경로 모두 1회씩, reopened 로 구분.
     * 활동 로그(즉시)와 푸시 이벤트(커밋 이후 소비)를 함께 낸다. 재전환도 수신자 입장에선 새 요청이라
     * 두 경로 모두 알린다 — 발송 측 dedup 은 동시 reopen 경합만 접고, 재요청 도배 억제는 요청
     * 쿨다운(티켓 475)의 몫이다(GROMO-1090).
     */
    private void onRequestCreated(UUID requestId, UUID me, UUID targetUserId, boolean reopened) {
        userActivityEventLogger.log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetUserId.toString(), "reopened", reopened));
        eventPublisher.publishEvent(new FriendRequestSentEvent(requestId, targetUserId, me));
    }

    /**
     * 요청 수락 — 수신자(toUser)만 가능. PENDING → ACCEPTED.
     * 상태 계약은 거절과 비대칭이다 (GROMO-719 오너 결정):
     * - 수락은 전 상태 관용 — REJECTED → ACCEPTED 는 "거절했다 뒤늦게 수락" UX 로 의도된 전이라 허용하고
     * 알린다("거절했던 요청을 뒤늦게 수락하면 알린다" 계약). ACCEPTED → ACCEPTED 는 멱등(무알림).
     * - 거절은 PENDING 한정(rejectRequest) — ACCEPTED 에 거절이 통하면 친구 관계가 deleteFriend 를
     * 우회해 조용히 증발하기 때문. 수락은 관계를 늘리는 방향이라 관용해도 그런 파괴 경로가 없다.
     * - 관용의 유일한 예외는 CANCELED (GROMO-1894, friend-letter LLD §1.11) — 발신자가 거둬들인 요청을
     * 수신자가 옛 requestId 로 되살릴 근거가 없다. {@code status != PENDING} 으로 통째로 막지 않는 이유는
     * 위 두 계약(REJECTED 관용·ACCEPTED 멱등)이 함께 깨지기 때문이다.
     *
     * @param me        수락하는 유저 — 요청의 수신자여야 한다
     * @param requestId 수락할 요청 행 id. 상대 유저 id 가 아니다
     */
    @Transactional
    public void acceptRequest(UUID me, UUID requestId) {
        Friendship friendship = getReceivedRequest(me, requestId);
        if (friendship.getStatus() == FriendshipStatus.CANCELED) {
            // 취소된 요청은 되살리지 않는다 — 배타 락 아래라 발신자의 취소와 수신자의 수락이 경합해도 한쪽만 이긴다.
            throw new FriendException(FriendErrorCode.INVALID_REQUEST_STATUS);
        }
        // 이 호출이 실제로 상태를 바꾼 것인지 먼저 본다 — 아래 알림 발행 조건 (GROMO-1090).
        boolean alreadyAccepted = friendship.getStatus() == FriendshipStatus.ACCEPTED;
        friendship.accept();
        UUID requesterId = friendship.getFromUser().getId();
        userActivityEventLogger.log(UserActivityEvent.FRIEND_ADDED,
                Map.of("request_id", requestId.toString(),
                        "from_user_id", requesterId.toString()));
        // 수락 사실은 보낸 쪽만 모른다 — 그쪽에만 알린다 (GROMO-1090). 발송은 커밋 이후.
        // 이미 ACCEPTED 인 요청에 수락이 또 들어와도(이 API 는 CANCELED 말고는 상태를 검사하지 않는다) 알리지 않는다 —
        // 늦게 도착한 재시도까지 발송 측 dedup 창에 기대면 창이 짧을수록 중복이 새 나간다(@codex 리뷰).
        if (!alreadyAccepted) {
            eventPublisher.publishEvent(new FriendRequestAcceptedEvent(requesterId, me));
        }
    }

    /**
     * 요청 거절 — 수신자(toUser)만 가능. PENDING → REJECTED 만 허용 (GROMO-719).
     * 수락과 달리 상태를 검사한다 — ACCEPTED 에 거절이 통하면 친구 관계가 deleteFriend 없이
     * (삭제 절차·검증을 우회해) 조용히 증발하고, 이후 재요청의 REJECTED 재전환 분기로 되살아나기까지 한다.
     * 거절은 알리지 않는다 (GROMO-1090) — 거절 통보는 관계상 부담이라 스코프에서 뺐다.
     *
     * @param me        거절하는 유저 — 요청의 수신자여야 한다
     * @param requestId 거절할 요청 행 id. PENDING 이 아니면 INVALID_REQUEST_STATUS
     */
    @Transactional
    public void rejectRequest(UUID me, UUID requestId) {
        Friendship friendship = getReceivedRequest(me, requestId);
        if (friendship.getStatus() != FriendshipStatus.PENDING) {
            throw new FriendException(FriendErrorCode.INVALID_REQUEST_STATUS);
        }
        friendship.reject();
    }

    /**
     * 요청 취소 — 발신자(fromUser)만 가능. PENDING → CANCELED 만 허용 (GROMO-1894, friend-letter LLD §1.11).
     * 거절({@link #rejectRequest})과 대칭이지만 검증 축이 반대다 — 수신자의 거절만 있고 발신자가 되돌릴 길이
     * 없으면 상대 검색 결과에 「요청중」이 영영 남는다. 취소는 알리지 않는다 — 거절 무알림과 같은 결이다.
     * 같은 배타 락({@code findByIdAndDeletedAtIsNull})을 잡으므로 수신자의 동시 수락과는 한쪽만 이긴다.
     *
     * @param me        취소하는 유저 — 요청의 발신자여야 한다
     * @param requestId 취소할 요청 행 id. PENDING 이 아니면 INVALID_REQUEST_STATUS
     */
    @Transactional
    public void cancelRequest(UUID me, UUID requestId) {
        Friendship friendship = getSentRequest(me, requestId);
        if (friendship.getStatus() != FriendshipStatus.PENDING) {
            throw new FriendException(FriendErrorCode.INVALID_REQUEST_STATUS);
        }
        friendship.cancel();
    }

    /**
     * 친구 삭제 — ACCEPTED 관계를 양측 누구나 soft delete.
     *
     * <p><b>아직 확인하지 않은 편지를 함께 지운다</b> (GROMO-2002, policy-2026-09-14 「친구를 삭제하면
     * 서로 편지를 보낼 수 없고 아직 확인하지 않은 편지도 지운다」). 「보낼 수 없다」는 이미 지켜지고
     * 있었다 — {@code InternalLetterService.send} 가 관계 확인으로 막는다.
     * 여기서 더하는 것은 뒤쪽 절반, 남아 있는 미확인 편지의 정리다.
     *
     * <p><b>두 절반은 관계 행 배타 락으로 이어 붙인다</b>(codex 리뷰 P1). 발송과 이 삭제가
     * {@code findAcceptedBetweenForUpdate} 로 같은 행을 잡지 않으면, 발송이 확인을 통과한 뒤 이 정리가
     * 커밋되고 그 «다음에» 편지가 꽂혀 「관계는 끊겼는데 미확인 편지가 남는」 상태가 만들어진다 —
     * 앞 절반과 뒤 절반이 각각은 맞는데 합쳐서 틀리는 자리다.
     *
     * <p>정리를 «여기»에 둔 것은 의도다. 레거시 {@code friend.FriendController} 와 내부 표면
     * {@code InternalFriendController} 두 표면이 모두 이 메서드로 모이므로, 상위(internal, L10)에
     * 올려 두면 레거시 경로만 정책을 어기게 된다. 레이어도 맞다 — {@code letter} 는 L2, {@code friend} 는
     * L3 이라 참조가 아래로 간다. {@code DomainLayerRulesTest} 의 letter 층 주석이 「친구 삭제 후 편지
     * 정리가 결정되면 friend 가 letter 를 참조해야 한다」며 미리 비워 둔 자리다.
     *
     * @param me           끊는 쪽
     * @param friendUserId 끊을 상대. 이미 탈퇴한 유저여도 허용한다 — 아니면 잔존 관계를 영영 못 끊는다
     * @return 끊은 관계 행 id (GROMO-1894 내부 표면이 결과를 돌려주는 데 쓴다. 레거시 컨트롤러는 무시한다)
     */
    @Transactional
    public UUID deleteFriend(UUID me, UUID friendUserId) {
        // 요청자 공유 락 (GROMO-1944) — 탈퇴 배타 락과 직렬화한다. 락 없이 활성 검사만 하면 탈퇴 커밋 직전에
        // 통과한 요청이 탈퇴가 하드 삭제한 관계 행에 뒤늦게 UPDATE 를 내 500 으로 터진다. 탈퇴가 먼저면 404.
        User meUser = getCallerParticipant(me);
        User friendUser = getAnyUser(friendUserId);   // 탈퇴자와의 잔존 관계도 끊을 수 있어야 한다 (GROMO-801)
        // 관계 행 배타 락 (codex 리뷰 P1) — 편지 발송과 «같은 행»에서 직렬화한다. 락 없이 읽으면
        // 발송이 관계 확인을 통과한 뒤 이 삭제가 정리까지 커밋하고, 그 다음에 발송이 편지를 꽂아
        // 「관계는 끊겼는데 미확인 편지가 남는」 상태가 된다(LLD §결정 3 위반).
        // 잠금 순서는 users(공유) → friendships(배타) — 논증은 findAcceptedBetweenForUpdate Javadoc.
        Friendship friendship = friendshipRepository.findAcceptedBetweenForUpdate(meUser, friendUser)
                .orElseThrow(() -> new FriendException(FriendErrorCode.NOT_FRIEND));
        Instant now = Instant.now();
        friendship.softDelete(now);
        // ⚠ 순서가 중요하다. 편지 정리는 벌크 UPDATE(clearAutomatically)라 영속성 컨텍스트를 «비운다» —
        // 먼저 부르면 위 friendship 이 준영속이 되어 softDelete 가 조용히 유실된다. 뒤에 두면
        // flushAutomatically 가 friendship UPDATE 를 먼저 내보낸 뒤 정리가 돈다. 같은 트랜잭션이라
        // 둘은 함께 커밋되거나 함께 롤백된다 — 관계만 끊기고 편지가 남는 중간 상태는 없다.
        letterRepository.softDeleteUnreadBetween(me, friendUserId, now);
        return friendship.getId();
    }

    /**
     * 친구 목록 — ACCEPTED·미삭제 관계를 상대 유저로 매핑. isPinned는 내 핀 친구 집합으로 결정.
     *
     * @param me   목록의 주인
     * @param date 집중분을 집계할 날짜. 서버 판정 축(KST 고정)의 오늘이며 기기 로컬 날짜가 아니다
     * @return 친구별 표시정보. 집중 이력이 없는 친구는 라이브 정보 맵에 없어 0/false/null 기본값이 채워진다
     */
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
        Map<UUID, Integer> tierLevels = userTierLookup.tierLevelsByUserId(otherIds);
        // GROMO-822: 상대 userId 들의 집중 라이브 정보(당일 집중분·진행중 여부·시작시각·태그명)를 1회 배치 조회(N+1 방지).
        // date 는 서버 판정 축(KST 고정, GROMO-1259) 기준 오늘(/pins 와 동일). 미조회 유저는 맵에 없어 아래에서 기본값(0/false/null) 처리.
        Map<UUID, FocusLiveInfo> liveInfo = focusLiveInfoLookup.liveInfoByUserId(otherIds, date);
        // GROMO-1971: 메인 섬 «이름»도 한 번에 모은다(N+1 방지) — 섬은 group(L5) 데이터라 포트로 묻는다.
        // 소속이 없는 친구는 맵에 키가 없어 아래에서 null 이 된다.
        Map<UUID, String> mainIslandNames = mainIslandNamePort.mainIslandNamesByUserId(otherIds);
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
                            .mainIslandName(mainIslandNames.get(other.getId()))
                            .build();
                })
                .toList();
    }

    /**
     * 유저 핀 설정 — 친구 아닌 임의 유저도 핀 가능(user 핀 통일, GROMO-609). 대상 존재만 검증 후 멱등 insert.
     *
     * @param me           핀을 거는 유저
     * @param friendUserId 핀 대상. 자기 자신이면 SELF_PIN, 활성 유저가 아니면 유저 없음으로 떨어진다
     */
    @Transactional
    public void pinFriend(UUID me, UUID friendUserId) {
        if (me.equals(friendUserId)) {
            throw new FriendException(FriendErrorCode.SELF_PIN);
        }
        // 양쪽 다 활성 검증 + 탈퇴와 직렬화 (GROMO-801) — 없으면 FK 위반 500 대신 NOT_FOUND(404)
        getCallerParticipant(me);
        getRelationParticipant(friendUserId);
        // ON CONFLICT DO NOTHING — 동시 핀 요청에도 멱등(중복은 무시), 500 없음.
        pinnedUserRepository.insertIgnoreConflict(UUID_V7.generate(), me, friendUserId);
    }

    /**
     * 친구 핀 해제 — 있으면 삭제, 없으면 멱등(204).
     *
     * @param me           핀을 건 유저
     * @param friendUserId 핀을 뗄 대상. 탈퇴자여도 해제할 수 있다
     */
    @Transactional
    public void unpinFriend(UUID me, UUID friendUserId) {
        getUser(me);
        getAnyUser(friendUserId);   // 탈퇴자 핀도 해제 가능해야 한다 (GROMO-801)
        // 벌크 DELETE — 조회 후 remove 하면 탈퇴의 핀 정리와 겹칠 때 0 행 DELETE 로 StaleStateException(500).
        // 0 행 = 이미 없음이므로 그대로 멱등 성공(204).
        pinnedUserRepository.deletePin(me, friendUserId);
    }

    /**
     * 내가 핀한 친구 조회 — 각 친구의 캐릭터 표시정보 + 오늘 집중분 + 진행중 여부 매핑(GROMO-369 재사용).
     *
     * @param me   핀을 건 유저
     * @param date 집중분을 집계할 날짜. DailyFocusStat 의 저장 버킷과 같은 축(KST 고정)이어야 값이 맞는다
     * @return 핀한 유저 목록. 핀이 하나도 없으면 배치 조회를 아예 건너뛰고 빈 리스트를 돌려준다
     */
    public List<PinnedUserResponse> getPinnedFriends(UUID me, LocalDate date) {
        User meUser = getUser(me);
        List<User> friends = pinnedUserRepository.findByUser(meUser).stream()
                .map(PinnedUser::getPinnedUser)
                .toList();
        if (friends.isEmpty()) {
            return List.of();
        }

        // GROMO-643·1259: 서버 판정 축(KST 고정) 날짜(date)로 오늘 집계 조회 (DailyFocusStat 저장 버킷과 동일 축)
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

    /**
     * PENDING 요청 목록 — type=received(받은) | sent(보낸).
     *
     * @param me   목록의 주인
     * @param type {@code received} 면 받은 요청, 그 밖의 값은 모두 보낸 요청으로 본다(대소문자 무시)
     * @return 각 요청의 <b>상대</b> 표시정보. 응답의 시각은 createdAt 이 아니라 updatedAt 이 소스다 —
     *         재요청이 행을 되살리므로 createdAt 은 원래 관계의 시각으로 남는다
     */
    public List<FriendRequestResponse> getRequests(UUID me, String type) {
        User meUser = getUser(me);
        boolean received = "received".equalsIgnoreCase(type);
        List<Friendship> requests = received
                ? friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(meUser, FriendshipStatus.PENDING)
                : friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(meUser, FriendshipStatus.PENDING);

        // GROMO-710: 상대 userId 들을 한 번에 모아 티어 배치 조회(N+1 방지). 티어는 league_arena_users 로만 도출(GROMO-671).
        Map<UUID, Integer> tierLevels = userTierLookup.tierLevelsByUserId(requests.stream()
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
                            // ⚠ 새 PENDING mutator 주의 (GROMO-1230) — 이 매핑은 "PENDING 행의 마지막
                            // UPDATE = 요청 전이(생성·복원·재전환)"라는 전제 위에 있다. PENDING 행을
                            // 건드리는 mutator 를 새로 추가하면 @UpdateTimestamp 가 updatedAt 을 그 시점으로
                            // 밀어 요청 시각이 오염된다 — 추가 전에 이 계약을 재검토할 것.
                            // createdAt 폴백: V1 스키마가 updated_at null 을 허용하고 Hibernate 밖에서
                            // 삽입된 행(부하테스트 시드 등)은 실제로 비어 있다 — null 을 그대로 내보내지
                            // 않는다. 앱 생성 행은 @UpdateTimestamp 가 insert 부터 채워 폴백을 안 탄다.
                            .createdAt(f.getUpdatedAt() != null ? f.getUpdatedAt() : f.getCreatedAt())
                            .build();
                })
                .toList();
    }

    /**
     * 친구 검색 — type 전략에 위임 후 자기자신 제외 + 기존 관계(relation) 표기.
     * relation 판정은 {@link FriendRelationLookup} 공유 컴포넌트에 위임한다 (GROMO-1631 — 프로필과 공유).
     *
     * <p><b>비친구에게는 티어·준비 시험을 주지 않는다</b> (GROMO-1996). 검색은 닉네임만 알면 누구나
     * 칠 수 있는 표면이라, 모르는 사람의 프로필 정보를 여기서 흘리면 친구 수락이라는 관문이 무의미해진다.
     * 남기는 셋({@code userId}·{@code nickname}·{@code relation})은 「이 사람에게 친구 요청을 보낼까」를
     * 그리는 데 필요한 최소값이다 — 더 보려면 친구가 되고 나서 프로필로 간다.
     *
     * <p>가리는 자리가 «여기» 인 것은 의도다: relation 이 이미 계산돼 있으므로 전략은 아무것도 몰라도
     * 되고, 검색 수단이 늘어도 가림 규칙은 한 곳에 남는다.
     *
     * @param me    검색하는 유저 — 결과에서 제외되고, 관계 배지 판정의 기준이 된다
     * @param type  검색 수단. 등록된 전략이 없으면 {@link IllegalArgumentException} 을 던져 400 이 된다
     * @param query 검색어. 해석은 전략 몫이다
     * @return 관계 배지까지 채운 검색 결과. 친구가 아닌 건의 {@code tierLevel}·{@code occupation} 은 null 이다
     */
    public List<FriendSearchResultResponse> search(UUID me, SearchType type, String query) {
        FriendSearchStrategy strategy = searchStrategies.get(type);
        if (strategy == null) {
            throw new FriendException(FriendErrorCode.INVALID_SEARCH_TYPE);   // 400 (GROMO-1725)
        }
        User meUser = getUser(me);
        Set<UUID> friendIds = friendRelationLookup.collectFriendIds(meUser);
        Set<UUID> pendingIds = friendRelationLookup.collectPendingIds(meUser);

        return strategy.search(me, query).stream()
                .filter(r -> !r.getUserId().equals(me))
                .map(r -> {
                    FriendRelation relation =
                            friendRelationLookup.resolveRelation(r.getUserId(), friendIds, pendingIds);
                    boolean friend = relation == FriendRelation.FRIEND;
                    return FriendSearchResultResponse.builder()
                            .userId(r.getUserId())
                            .nickname(r.getNickname())
                            // PENDING(요청중)도 아직 친구가 아니다 — 수락 전에 미리 보여 주지 않는다.
                            .tierLevel(friend ? r.getTierLevel() : null)
                            .occupation(friend ? r.getOccupation() : null)
                            .relation(relation)
                            .build();
                })
                .toList();
    }

    // ── 내부 헬퍼 ──────────────────────────────────────────

    /**
     * 활성 유저 조회 — 탈퇴(소프트딜리트) 유저는 없는 유저로 취급 (GROMO-801).
     * 호출자 본인(me) 확인과 일반 조회에 쓴다. 부재 시 NOT_FOUND 는 종전과 같다.
     */
    private User getUser(UUID userId) {
        return userQueryService.getCaller(userId);
    }

    /**
     * 관계 '생성'(친구 요청·핀)에 참여하는 유저 조회 (GROMO-801) — 활성 검증 + 공유 락.
     * 활성 검증: findById 를 쓰면 탈퇴자에게 요청이 걸리고, friendships 에 남은 (from,to) 유니크 제약과
     * 충돌해 500 이 난다.
     * 공유 락: 탈퇴 트랜잭션의 배타 락과 직렬화해, 정리가 끝난 뒤 새 관계가 끼어드는 레이스를 막는다.
     * 관계는 두 유저를 묶으므로 대상뿐 아니라 호출자(me) 에도 걸어야 한다 — 한쪽만 잠그면 잠그지 않은 쪽이
     * 탈퇴 중일 때 그 유저 소유의 유령 관계가 그대로 남는다.
     * 공유 락끼리는 충돌하지 않아 동시 요청은 병렬 그대로고, 탈퇴(배타 락)하고만 직렬화된다.
     * <p>여기서 {@code getTargetForUpdate} 를 쓰면 안 된다 — 이 트랜잭션은 users 를 읽기만 한다.
     */
    private User getRelationParticipant(UUID userId) {
        return userQueryService.getTargetForShare(userId);
    }

    /**
     * 요청자 본인 — 공유 락. {@link #getRelationParticipant} 와 같은 락이지만 부재 코드가
     * {@code USER_NOT_FOUND}(재로그인)다. GROMO-1725: 요청자·대상을 코드로 가른다.
     */
    private User getCallerParticipant(UUID me) {
        return userQueryService.getCallerForShare(me);
    }

    /**
     * 관계 '해제'(친구 삭제·핀 해제) 대상 조회 (GROMO-801) — 탈퇴 여부를 보지 않는다.
     * 활성 검증을 걸면 상대가 탈퇴한 순간 잔존 관계를 영구히 못 지운다. 특히 이 변경 배포 전에 탈퇴해
     * 정리되지 않은 관계는 사용자가 직접 끊는 것이 유일한 해소 수단이다(백필을 하지 않으므로).
     * 해제는 관계를 줄이는 방향이라 탈퇴자를 대상으로 허용해도 유령이 늘지 않는다.
     * <p>그래서 활성 필터가 없는 {@link UserQueryService#getAny(UUID)} 를 쓴다 — 다른 조회 메서드로
     * 바꾸면 탈퇴자와의 잔존 관계를 끊을 수단이 사라진다.
     */
    private User getAnyUser(UUID userId) {
        return userQueryService.getAny(userId);
    }

    /**
     * requestId로 PENDING 요청 조회 후 수신자(toUser) 본인인지 검증.
     * 탈퇴 정리로 soft delete 된 요청은 없는 요청으로 취급 (GROMO-801) — 목록에서 숨긴 것을 변경도 막는다.
     */
    private Friendship getReceivedRequest(UUID me, UUID requestId) {
        Friendship friendship = friendshipRepository.findByIdAndDeletedAtIsNull(requestId)
                .orElseThrow(() -> new FriendException(FriendErrorCode.REQUEST_NOT_FOUND));
        if (!friendship.getToUser().getId().equals(me)) {
            throw new FriendException(FriendErrorCode.NOT_REQUEST_RECEIVER);
        }
        return friendship;
    }

    /**
     * requestId 로 요청 조회 후 발신자(fromUser) 본인인지 검증 — {@link #getReceivedRequest} 의 대칭 (GROMO-1894).
     * 같은 배타 락 조회를 쓴다: 취소가 수락·탈퇴 정리와 서로의 UPDATE 를 덮어쓰지 않아야 한다.
     */
    private Friendship getSentRequest(UUID me, UUID requestId) {
        Friendship friendship = friendshipRepository.findByIdAndDeletedAtIsNull(requestId)
                .orElseThrow(() -> new FriendException(FriendErrorCode.REQUEST_NOT_FOUND));
        if (!friendship.getFromUser().getId().equals(me)) {
            throw new FriendException(FriendErrorCode.NOT_REQUEST_SENDER);
        }
        return friendship;
    }

    /**
     * 친구 관계에서 내가 아닌 상대 유저를 반환.
     */
    private User counterpart(Friendship friendship, UUID me) {
        return friendship.getFromUser().getId().equals(me)
                ? friendship.getToUser()
                : friendship.getFromUser();
    }


    /**
     * 탈퇴자의 친구 관계와 핀을 파기한다 (GROMO-801 · 이동 GROMO-1656 · 하드 삭제 GROMO-1801).
     *
     * <p><b>둘 다 하드 삭제</b>다(계정 LLD §4). 활성 조회 필터나 soft delete 는 파기가 아니다 — 요청·수락·거절
     * 상태와 시각이 탈퇴자 UUID 에 계속 묶인다. 두 활성 사용자끼리의 관계·핀은 건드리지 않는다.
     *
     * <p><b>호출 순서</b>: 벌크 DELETE 가 {@code friendships} 행을 잠그므로 관계와 무관한 정리를 먼저 끝내
     * 락 보유 구간을 줄인다 — 호출부가 이 메서드를 늦게 부르는 이유다.
     *
     * @param userId 탈퇴 중인 유저
     */
    @Transactional
    public void detachWithdrawnUser(UUID userId) {
        friendshipRepository.deleteAllInvolving(userId);
        pinnedUserRepository.deleteAllInvolving(userId);
    }

}
