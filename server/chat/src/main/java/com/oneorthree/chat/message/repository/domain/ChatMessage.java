package com.oneorthree.chat.message.repository.domain;

import com.oneorthree.chat.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 안에서 오간 말 한 마디.
 *
 * <p><b>그룹·유저를 FK 로 걸지 않고 id 만 들고 있다.</b> 그 두 테이블은 다른 서비스(Data API)의
 * 다른 데이터베이스에 있어 물리적으로 FK 를 걸 수 없고, 걸 수 있더라도 걸지 않는다 — 참조 무결성을
 * DB 에 맡기는 순간 두 서비스의 배포·마이그레이션이 한 몸이 된다. 대신 「멤버가 아니면 못 쓴다」를
 * 쓰기 시점에 {@code ChatAccessGuard} 가 보장한다.
 *
 * <p>탈퇴한 사람의 메시지는 남는다. 대화 기록에서 한 사람의 말만 도려내면 남은 사람들의 대화가
 * 앞뒤가 안 맞게 된다 — 표시 이름은 어차피 이 테이블에 없고(있으면 개명이 반영 안 된다) 조회
 * 시점에 프로필에서 붙이므로, 탈퇴자는 화면에서 「알 수 없음」으로 그려진다.
 */
@Entity
@Getter
@Table(name = "chat_messages")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatMessage {

    /**
     * UUID v7 — 시간 정렬 PK다. <b>커서 페이징과 안 읽음 계산이 이 단조성에 얹혀 있다</b>
     * ({@code id < :cursor} = 「이보다 과거」). Postgres 의 uuid 비교는 바이트 순이고 v7 은 앞
     * 48비트가 epoch 밀리초라 그 비교가 곧 시간 비교가 된다.
     */
    @Id
    @GeneratedUuidV7
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** 섬(그룹) id. Data API 소유라 FK 는 없다. */
    @Column(name = "group_id", nullable = false, updatable = false)
    private UUID groupId;

    /** 보낸 사람. 탈퇴해도 이 값은 남는다. */
    @Column(name = "sender_id", nullable = false, updatable = false)
    private UUID senderId;

    /** 본문. 길이 상한은 컬럼이 아니라 {@code ChatErrorCode.CONTENT_TOO_LONG} 규칙이 정한다. */
    @Column(name = "content", nullable = false, updatable = false, length = 2000)
    private String content;

    /**
     * 클라이언트가 만든 멱등 키. {@code (group_id, sender_id, client_message_id)} 유니크 인덱스가
     * 재전송을 <b>DB 에서</b> 막는다.
     *
     * <p>애플리케이션에서 「있나 보고 없으면 넣는다」로 막지 않는 이유는 그 사이에 창이 있기 때문이다 —
     * 네트워크가 끊겼다 붙는 순간 같은 메시지가 두 번 날아오면 두 요청이 둘 다 「없음」을 읽고 둘 다
     * 넣는다. 유니크 인덱스는 그 창이 없다.
     */
    @Column(name = "client_message_id", nullable = false, updatable = false)
    private UUID clientMessageId;

    /**
     * 서버가 받은 시각. 클라 시각을 쓰지 않는다 — 기기 시계가 틀어지면 대화 순서가 뒤집힌다.
     *
     * <p>id 의 v7 타임스탬프와 사실상 같은 값이지만 컬럼으로도 둔다. id 에서 시각을 뽑는 건
     * 「PK 포맷을 안다」는 가정에 기대는 일이라, 조회·집계·사람이 읽는 용도로는 명시 컬럼이 낫다.
     */
    @Column(name = "sent_at", nullable = false, updatable = false)
    private Instant sentAt;

    @Builder
    private ChatMessage(UUID groupId, UUID senderId, String content, UUID clientMessageId, Instant sentAt) {
        this.groupId = groupId;
        this.senderId = senderId;
        this.content = content;
        this.clientMessageId = clientMessageId;
        this.sentAt = sentAt;
    }
}
