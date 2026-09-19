package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.ratelimit.PerUserHourlyLimiter;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.LetterItemView;
import com.oneorthree.phone.internal.dto.LetterSendRequest;
import com.oneorthree.phone.internal.dto.LetterSliceView;
import com.oneorthree.phone.internal.dto.LetterView;
import com.oneorthree.phone.letter.exception.LetterErrorCode;
import com.oneorthree.phone.letter.exception.LetterException;
import com.oneorthree.phone.letter.repository.LetterRepository;
import com.oneorthree.phone.letter.repository.domain.Letter;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * 편지 3종의 판정 (GROMO-1933, friend-letter LLD §1.12~1.14).
 *
 * <p>여러 도메인을 조합하므로 {@code internal}(L10)에 둔다 — 편지 저장소({@code letter}), 유저 활성
 * 검증({@code user}), 친구 관계({@code friend}), 섬 소속({@code group})을 함께 읽는다. 조합하는 코드가
 * 기반 도메인 안에 있으면 기반이 파생을 참조하게 된다({@code docs/conventions/backend-layering.md} §4).
 * {@code InternalIslandMailboxService}(GROMO-1775)와 같은 자리다.
 *
 * <h2>우체통 게이트 — 발송은 막지 않고 열람만 막는다</h2>
 * 재영님 확정(2026-09-18, LLD §4 결정 2 = C): {@link #send} 는 <b>수신자의 섬·시설을 조회하지 않는다.</b>
 * 우체통이 없는 섬 주민에게도 편지는 쌓이고, 나중에 우체통이 완공되면 한꺼번에 보인다. 게이트는
 * <b>받은 편지함</b> 목록({@link #list} 의 {@code type=sent} 가 아닌 호출)과 {@link #detail} 에만 있고
 * 판정 대상은 <b>호출자</b>의 섬이다({@link #requireMailboxUnlocked}). 보낸 편지함에는 없다 —
 * 이미 보낸 내 편지를 다시 보는 데 시설을 물을 이유가 없다.
 *
 * <h2>게스트 분기가 없다</h2>
 * 재영님 확정(2026-09-18, LLD §4 결정 1 = A): 게스트도 완전히 동일하다. {@code User.isGuest} 를 읽는 곳이
 * 이 클래스에 <b>한 곳도 없어야</b> 한다 — 스팸 방어(GROMO-1934)도 게스트를 가리지 않고 전 계정에 같은
 * 시간 한도를 건다({@link #send}).
 */
@Slf4j
@Service
public class InternalLetterService {

    /** 편지함이 파라미터 없이 불릴 때의 기본 페이지 크기 (LLD §1.13). */
    static final int DEFAULT_PAGE_SIZE = 20;

    /** 페이지 크기 상한 (LLD §1.13). */
    static final int MAX_PAGE_SIZE = 100;

    private static final String SENT = "sent";

    private final LetterRepository letters;
    private final UserQueryService users;
    private final FriendshipRepository friendships;
    private final GroupMemberRepository islandMemberships;
    private final IslandFacilityQueryService islandFacilityQueryService;
    private final PerUserHourlyLimiter sendLimiter;

    /**
     * 한도 카운터가 친구 요청 것과 같은 타입이라 이름으로 골라 받는다 — Lombok 생성자는 {@code @Qualifier} 를
     * 옮기지 않아 손으로 쓴다.
     *
     * @param sendLimiter 편지 발송 계정당 시간 한도(GROMO-1934) — 게스트 구분 없이 전 계정
     */
    public InternalLetterService(LetterRepository letters, UserQueryService users, FriendshipRepository friendships,
                                 GroupMemberRepository islandMemberships,
                                 IslandFacilityQueryService islandFacilityQueryService,
                                 @Qualifier("letterSendRateLimiter") PerUserHourlyLimiter sendLimiter) {
        this.letters = letters;
        this.users = users;
        this.friendships = friendships;
        this.islandMemberships = islandMemberships;
        this.islandFacilityQueryService = islandFacilityQueryService;
        this.sendLimiter = sendLimiter;
    }

    /**
     * 편지 보내기 (LLD §1.12). 검증 순서는 {@code FriendService.createRequest} 를 그대로 따른다 —
     * 자기 자신 → 본문 → 발신자·수신자 활성 → 친구 관계.
     *
     * <p>활성 검증에 공유 락판({@code getCallerForShare}·{@code getTargetForShare})을 쓰는 것은 의도다:
     * 탈퇴 트랜잭션과 직렬화해, 탈퇴가 커밋되는 중에 그 유저 앞으로 편지가 새로 꽂히지 않게 한다.
     *
     * @param senderId 보내는 사람(경로에서 오는 주체)
     * @param body     받는 사람과 본문
     * @return 방금 만든 편지. {@code readAt} 은 항상 null 이다
     * @throws LetterException {@code SELF_LETTER}(400) · {@code LETTER_CONTENT_BLANK}(400) ·
     *     {@code LETTER_CONTENT_OUT_OF_RANGE}(400) · {@code LETTER_RECIPIENT_NOT_FRIEND}(404)
     * @throws com.oneorthree.phone.common.exception.RateLimitedException {@code RATE_LIMITED}(429) — 계정당 시간 한도
     */
    @Transactional
    public LetterView send(UUID senderId, LetterSendRequest body) {
        if (senderId.equals(body.receiverId())) {
            throw new LetterException(LetterErrorCode.SELF_LETTER);
        }
        String content = validContent(body.content());

        User sender = users.getCallerForShare(senderId);
        User receiver = users.getTargetForShare(body.receiverId());
        if (friendships.findAcceptedBetween(sender, receiver).isEmpty()) {
            throw new LetterException(LetterErrorCode.LETTER_RECIPIENT_NOT_FRIEND);
        }
        // 한도는 판정을 다 통과한 «쓰기 직전»에 센다(GROMO-1934) — 거절될 요청까지 세면 오타 몇 번에 막힌다.
        sendLimiter.acquire(senderId);

        Letter saved = letters.save(Letter.builder()
                .sender(sender)
                .receiver(receiver)
                .content(content)
                .build());
        return new LetterView(saved.getId(), sender.getId(), sender.getNickname(),
                receiver.getId(), saved.getContent(), saved.getCreatedAt(), null);
    }

    /**
     * 편지함 목록 (LLD §1.13). 편지함 주인은 경로의 {@code userId} 로 고정이라 남의 편지함을 가리킬
     * 입력이 없다.
     *
     * @param userId 편지함 주인
     * @param type   {@code received}(생략 시 기본) 또는 {@code sent}. 빈 값·그 외 값은 400 이다
     * @param cursor 직전 페이지 마지막 편지 id. null 이면 첫 페이지
     * @param size   페이지 크기. null 이면 {@value #DEFAULT_PAGE_SIZE}
     * @return 최신순 한 페이지
     * @throws LetterException {@code LETTER_MAILBOX_LOCKED}(403, 받은함만) · {@code INVALID_PAGE_REQUEST}(400,
     *     size) · {@code INVALID_MAILBOX_TYPE}(400, type)
     */
    @Transactional(readOnly = true)
    public LetterSliceView list(UUID userId, String type, UUID cursor, Integer size) {
        // 입력 판정이 시설 게이트보다 먼저다 — 잘못된 요청(400)이 잠금(403)에 가려지면 앱이 고칠 곳을 모른다.
        int pageSize = validPageSize(size);
        boolean sent = mailboxType(type);

        User caller = users.getCaller(userId);
        // 보낸 편지함에는 게이트가 없다 — 받은 편지함·상세만 우체통을 묻는다(재영님 확정 2026-09-18).
        if (!sent) {
            requireMailboxUnlocked(caller);
        }
        Slice<Letter> page = sent
                ? letters.findSentByCursor(userId, cursor, PageRequest.of(0, pageSize))
                : letters.findReceivedByCursor(userId, cursor, PageRequest.of(0, pageSize));

        List<LetterItemView> items = page.getContent().stream()
                .map(letter -> item(letter, userId, sent))
                .toList();
        UUID nextCursor = page.hasNext() && !items.isEmpty() ? items.get(items.size() - 1).id() : null;
        return new LetterSliceView(items, pageSize, page.hasNext(), nextCursor);
    }

    /**
     * 편지 상세 (LLD §1.14). 호출자가 수신자이고 아직 안 읽었으면 최초 열람 시각을 박는다 —
     * <b>행을 지우지 않는다</b>(일반 우편함이다. 열람으로 사라지는 「읽으면 소멸」 편지가 아니다).
     *
     * @param userId   조회자
     * @param letterId 편지 id
     * @return 편지 한 통. 방금 읽음 처리했다면 {@code readAt} 이 그 시각이다
     * @throws LetterException {@code LETTER_MAILBOX_LOCKED}(403) · {@code LETTER_NOT_FOUND}(404) ·
     *     {@code NOT_LETTER_PARTICIPANT}(403)
     */
    @Transactional
    public LetterView detail(UUID userId, UUID letterId) {
        requireMailboxUnlocked(users.getCaller(userId));

        Letter letter = letters.findActiveWithSender(letterId)
                .orElseThrow(() -> new LetterException(LetterErrorCode.LETTER_NOT_FOUND));
        if (letter.isNotParticipant(userId)) {
            throw new LetterException(LetterErrorCode.NOT_LETTER_PARTICIPANT);
        }

        // 아래 조건부 UPDATE 가 영속성 컨텍스트를 비우므로 응답 값을 «먼저» 꺼내 둔다.
        UUID senderId = letter.getSender().getId();
        String senderNickname = letter.getSender().getNickname();
        UUID receiverId = letter.getReceiver().getId();
        String content = letter.getContent();
        Instant createdAt = letter.getCreatedAt();
        Instant readAt = letter.getReadAt();

        // 발신자 본인이 다시 봐도 읽음이 아니다 — 「상대가 읽었다」는 신호가 아니기 때문이다(HLD §2.2).
        if (readAt == null && receiverId.equals(userId)) {
            readAt = markRead(letterId);
        }
        return new LetterView(letterId, senderId, senderNickname, receiverId, content, createdAt, readAt);
    }

    /**
     * 최초 열람 시각을 조건부 UPDATE 로 박는다. 졌다면(다른 기기가 먼저) 이긴 쪽의 시각이 정본이라
     * 다시 읽어 온다 — 내 {@code now()} 를 응답에 실으면 화면과 DB 가 갈린다.
     */
    private Instant markRead(UUID letterId) {
        // timestamptz 는 마이크로초 정밀도다 — 자른 채로 써야 첫 응답과 재조회 값이 같다.
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (letters.markReadIfUnread(letterId, now) == 1) {
            return now;
        }
        return letters.findById(letterId).map(Letter::getReadAt).orElse(null);
    }

    private static LetterItemView item(Letter letter, UUID me, boolean sent) {
        User counterpart = letter.counterpartOf(me);
        // 보낸 편지함의 isRead 는 항상 false 로 고정한다 (LLD §1.13) — 상대의 열람 여부를 노출하지 않는다.
        boolean read = !sent && letter.getReadAt() != null;
        return new LetterItemView(letter.getId(), counterpart.getId(), counterpart.getNickname(),
                letter.getContent(), read, letter.getCreatedAt());
    }

    /**
     * 호출자가 편지를 <b>열람</b>할 수 있는가 — 살아 있는 섬에 소속돼 있고, 그 소속 섬 중
     * 우체통이 완공된 섬이 하나라도 있어야 한다(GROMO-1767 의 {@code island_facilities} 로 판정).
     * 공개 오류는 {@code LETTER_MAILBOX_LOCKED}(403) → Business 의 {@code FACILITY_LOCKED} 다.
     */
    private void requireMailboxUnlocked(User caller) {
        List<UUID> liveIslandIds = islandMemberships.findByUser(caller).stream()
                .map(GroupMember::getGroup)
                .filter(InternalLetterService::isAlive)
                .map(Group::getId)
                .toList();
        if (!islandFacilityQueryService.hasMailboxOnAnyOf(liveIslandIds)) {
            throw new LetterException(LetterErrorCode.LETTER_MAILBOX_LOCKED);
        }
    }

    private static boolean isAlive(Group island) {
        return island.getDeletedAt() == null && island.getStatus() != GroupStatus.ENDED;
    }

    /**
     * 편지함 종류 — {@code sent} 면 보낸 편지함이다. <b>파라미터 생략(null)과 {@code received} 만</b>
     * 받은 편지함이다(LLD §1.13 기본값). 빈 문자열·공백·그 외 문자열은 무엇인지 모르므로 받은함으로
     * 몰아 넣지 않고 400 으로 거절한다 — 거절 코드는 {@code size} 와 나눈다({@code INVALID_MAILBOX_TYPE}) —
     * Business 가 {@code field} 를 정확히 찍어야 앱이 어느 파라미터를 고칠지 안다.
     */
    private static boolean mailboxType(String type) {
        if (type == null || "received".equalsIgnoreCase(type)) {
            return false;
        }
        if (SENT.equalsIgnoreCase(type)) {
            return true;
        }
        throw new LetterException(LetterErrorCode.INVALID_MAILBOX_TYPE);
    }

    /** strip 후 빈 본문(400)과 상한 초과(400)는 사유가 달라야 해서 코드를 나눈다 (LLD §1.12). */
    private static String validContent(String raw) {
        String content = raw == null ? "" : raw.strip();
        if (content.isEmpty()) {
            throw new LetterException(LetterErrorCode.LETTER_CONTENT_BLANK);
        }
        if (content.length() > Letter.MAX_CONTENT_LENGTH) {
            throw new LetterException(LetterErrorCode.LETTER_CONTENT_OUT_OF_RANGE);
        }
        return content;
    }

    private static int validPageSize(Integer size) {
        if (size == null) {
            return DEFAULT_PAGE_SIZE;
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new LetterException(LetterErrorCode.INVALID_PAGE_REQUEST);
        }
        return size;
    }
}
