package com.oneorthree.phone.character.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
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
 * 누끼(캐릭터) 생성 1건 기록 (GROMO-1045).
 *
 * <p>append-only 이력 — 쿼터(첫 접촉 후 7일 무제한 → 이후 롤링 7일 내 3회) 판정의 근거다.
 * 클라가 이미지 저장에 성공한 뒤 1건씩 insert 하며, (user_id, created_at) 인덱스로
 * 창 내 건수·가장 오래된 행을 조회한다.
 */
@Entity
@Table(
        name = "character_generation",
        indexes = @Index(
                name = "idx_character_generation_user_created_at",
                columnList = "user_id, created_at")
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class CharacterGeneration {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @CreationTimestamp
    private Instant createdAt;

    /**
     * 클라 멱등키(옵션) — 재시도 시 같은 생성이 2슬롯을 소비하지 않도록 (user_id, client_generation_id) 중복을 무시한다.
     * null 이면 멱등 없이 그대로 기록(키를 안 보내는 현행 클라 하위호환). 부분 유니크 인덱스는 V22 마이그레이션에 있다.
     */
    @Column(name = "client_generation_id")
    private UUID clientGenerationId;
}
