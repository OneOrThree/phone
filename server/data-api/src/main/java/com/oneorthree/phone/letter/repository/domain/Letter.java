package com.oneorthree.phone.letter.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 친구 사이 1:1 편지 (GROMO-1933, friend-letter LLD §2 · HLD §2.1).
 *
 * <p>섬 주민 전체가 보는 우체통 공개 메시지(island-mailbox, 저장소는 Realtime 의 {@code gromo_chat})와는
 * <b>다른 도메인</b>이다 — 같은 화면에 나란히 떠도 저장소·권한·계약이 전부 갈린다(HLD §0).
 *
 * <p>상태 전이가 하나뿐이라 status enum 을 두지 않는다: 생성됨 →({@code readAt} 채워짐) 읽음.
 * 그 갱신은 서비스가 조건부 UPDATE 로 원자적으로 한다({@code LetterRepository.markReadIfUnread}) —
 * 엔티티에 setter 를 열면 「읽고 나서 쓰기」가 되어 두 기기가 최초 열람 시각을 서로 덮어쓴다(LLD §1.14).
 *
 * <p>{@code deletedAt} 은 <b>편지의 수명 끝</b>이다 (GROMO-2002, policy-2026-09-14). 정책이
 * 「친구 편지는 기록으로 남기지 않는다 — 받는 사람이 열었다가 닫으면 지워지고 보낸 사람 목록에서도
 * 사라진다」와 「친구를 삭제하면 아직 확인하지 않은 편지도 지운다」로 확정되면서, GROMO-1933 이
 * 미리 걸어 둔 {@code deletedAt IS NULL} 읽기 필터에 쓰기 두 경로가 붙었다
 * ({@code LetterRepository.softDeleteIfActive} · {@code softDeleteUnreadBetween}).
 * 갱신을 벌크 UPDATE 로 하는 이유는 {@code readAt} 과 같다 — 아래 setter 부재 논증 참조.
 *
 * <p><b>⚠ 알려진 정보 누출 — 2026-09-21 재영님 수용 결정.</b> 닫기가 편지를 «양쪽»에서 지우므로,
 * 발신자는 자기 보낸함에서 편지가 사라지는 «시점»으로 상대가 읽었다는 사실을 알게 된다. 이는
 * {@code InternalLetterService.item} 이 보낸함의 {@code isRead} 를 항상 false 로 고정해 열람 여부를
 * 숨기는 것과 형식상 모순이다. 그럼에도 정책이 「보낸 사람 목록에서도 사라진다」로 명시했고 재영님이
 * 알고 수용했다 — <b>버그가 아니다.</b> 「숨기려면 삭제를 발신자·수신자 2컬럼으로 나눠야 한다」는
 * 쪽으로 갈아엎기 전에 이 결정부터 뒤집을 것.
 */
@Entity
@Table(name = "letters")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Letter {

    /**
     * 본문 길이 상한 — 재영님 확정값(2026-09-18). LLD·HLD 에 남아 있는 1000 은 폐기된 제안값이다.
     * 컬럼 정의({@code varchar(500)})와 검증이 이 상수 하나를 공유한다.
     */
    public static final int MAX_CONTENT_LENGTH = 500;

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "receiver_id", nullable = false)
    private User receiver;

    @Column(nullable = false, length = MAX_CONTENT_LENGTH)
    private String content;

    /** 수신자가 처음 상세 조회한 시각. {@code null} 이면 안 읽음. */
    @Column(name = "read_at")
    private Instant readAt;

    /** 발송 시각. 목록 정렬 축은 이 컬럼이 아니라 {@code id} 다 — UUID v7 이 이미 시간순이다. */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * 이 편지의 상대 — 내가 받은 편지면 발신자, 내가 보낸 편지면 수신자.
     *
     * @param me 편지함 주인
     * @return 상대 유저. 목록 DTO 의 {@code counterpartUserId}·{@code counterpartNickname} 이 이 값을 읽는다
     */
    public User counterpartOf(UUID me) {
        return sender.getId().equals(me) ? receiver : sender;
    }

    /**
     * 이 유저가 발신자도 수신자도 아닌가 — 상세 조회 인가 판정 (LLD §1.14).
     *
     * @param userId 조회를 시도한 유저
     * @return 둘 중 어느 쪽도 아니면 true
     */
    public boolean isNotParticipant(UUID userId) {
        return !sender.getId().equals(userId) && !receiver.getId().equals(userId);
    }
}
