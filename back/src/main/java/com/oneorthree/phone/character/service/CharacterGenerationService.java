package com.oneorthree.phone.character.service;

import com.oneorthree.phone.character.domain.CharacterGeneration;
import com.oneorthree.phone.character.dto.CharacterQuotaResponse;
import com.oneorthree.phone.character.repository.CharacterGenerationRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * 누끼(캐릭터) 생성 쿼터 서비스 (GROMO-1045).
 *
 * <p>정책: 가입 후 7일은 무제한, 이후 롤링 7일 내 2회로 제한한다.
 * 판정 근거는 {@link CharacterGeneration} append-only 이력이다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CharacterGenerationService {

    /** 가입 후 무제한 유예 기간(일). */
    private static final int GRACE_PERIOD_DAYS = 7;
    /** 제한 구간의 롤링 윈도우 길이(일). */
    private static final int ROLLING_WINDOW_DAYS = 7;
    /** 제한 구간에서 윈도우당 허용 생성 횟수. */
    private static final int ROLLING_LIMIT = 2;

    private final UserRepository userRepository;
    private final CharacterGenerationRepository characterGenerationRepository;
    private final EntityManager entityManager;

    /** 현재 쿼터 조회 (GET /api/v1/character/quota). 클라 pre-check(UX)용 — 실제 관문은 record 이다. */
    public CharacterQuotaResponse getQuota(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        return computeQuota(user, Instant.now());
    }

    /**
     * 생성 1건 기록 후 갱신된 쿼터 반환 (POST /api/v1/character/generation).
     * 클라가 이미지 저장에 성공한 뒤 호출한다. GET /quota 의 pre-check 는 UX용이고, 실제 한도 관문은 이 record 다.
     *
     * <p>① TOCTOU 방지 — 트랜잭션 시작 시 유저별 advisory lock 으로 동시 기록을 직렬화한다. 락 후 창 내 건수를
     * 다시 세어, 무제한이 아니고 이미 한도에 도달했으면 insert 하지 않고(soft) 현재 쿼터를 반환한다. 원장이 한도를
     * 넘지 않도록 서버 record 가 최종 게이트다.
     *
     * <p>③ 멱등 — {@code clientGenerationId} 가 있고 같은 (user, key) 기록이 이미 있으면 no-op 로 현재 쿼터만
     * 반환한다(재시도 시 슬롯 중복 소비 방지). 키가 없으면(현행 클라) 기존대로 insert 한다.
     *
     * @param userId             로그인 유저 id
     * @param clientGenerationId 클라 멱등키(옵션, nullable)
     */
    @Transactional
    public CharacterQuotaResponse recordGeneration(UUID userId, UUID clientGenerationId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // ① 유저별 advisory lock — 동시 record 를 직렬화한다. 트랜잭션 커밋/롤백 시 자동 해제(xact 스코프).
        acquireUserLock(userId);

        Instant now = Instant.now();

        // ③ 멱등키 중복이면 재기록하지 않고 현재 쿼터만 반환.
        if (clientGenerationId != null
                && characterGenerationRepository.existsByUserAndClientGenerationId(user, clientGenerationId)) {
            return computeQuota(user, now);
        }

        // ① 락 후 창 내 건수 재확인 — 무제한이 아니고 한도 도달이면 insert 생략(원장이 한도를 넘지 않게).
        if (!isUnlimited(user, now) && countInWindow(user, now) >= ROLLING_LIMIT) {
            return computeQuota(user, now);
        }

        characterGenerationRepository.save(CharacterGeneration.builder()
                .user(user)
                .clientGenerationId(clientGenerationId)
                .build());
        return computeQuota(user, now);
    }

    /** 유저별 PostgreSQL advisory lock 획득(트랜잭션 스코프). userId 를 hashtext 로 bigint 키에 매핑. */
    private void acquireUserLock(UUID userId) {
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(hashtext(cast(:uid as text)))")
                .setParameter("uid", userId.toString())
                .getSingleResult();
    }

    /**
     * 쿼터 계산.
     * <ul>
     *   <li>무제한 구간 → unlimited (remaining·resetAt null)</li>
     *   <li>그 외 → 창(now-7일 이후) 내 count 로 remaining = max(0, 2 - count);
     *       remaining==0 이면 resetAt = 슬롯을 여는 오프셋 행의 created_at + 7일, 아니면 null</li>
     * </ul>
     */
    private CharacterQuotaResponse computeQuota(User user, Instant now) {
        if (isUnlimited(user, now)) {
            return new CharacterQuotaResponse(true, null, null);
        }

        long count = countInWindow(user, now);
        int remaining = Math.max(0, ROLLING_LIMIT - (int) count);

        Instant resetAt = null;
        if (remaining == 0) {
            // ② 창에 한도 초과 행이 있을 수 있어(grace spillover·경쟁) 가장 오래된 행이 아니라 실제로 슬롯을 여는
            //    (count - limit) 오프셋(오래된 순) 행이 만료돼야 remaining=1 이 된다. count==limit 이면 offset=0.
            int offset = (int) count - ROLLING_LIMIT;
            Instant windowStart = now.minus(ROLLING_WINDOW_DAYS, ChronoUnit.DAYS);
            List<Instant> slotRow = characterGenerationRepository
                    .findCreatedAtInWindowOrderByCreatedAtAsc(user, windowStart, PageRequest.of(offset, 1));
            if (!slotRow.isEmpty()) {
                resetAt = slotRow.get(0).plus(ROLLING_WINDOW_DAYS, ChronoUnit.DAYS);
            }
        }
        return new CharacterQuotaResponse(false, remaining, resetAt);
    }

    /** 창(now-7일 이후) 내 유저 생성 건수. */
    private long countInWindow(User user, Instant now) {
        Instant windowStart = now.minus(ROLLING_WINDOW_DAYS, ChronoUnit.DAYS);
        return characterGenerationRepository.countByUserAndCreatedAtGreaterThanEqual(user, windowStart);
    }

    /**
     * 가입 후 무제한 유예 구간인지.
     *
     * <p>④ createdAt null-safe — V1 baseline 이 users.created_at 을 NOT NULL 로 강제하지 않아 기존 유저는
     * null 일 수 있다. null 이면 무제한이 아닌 것(제한 쿼터 적용)으로 폴백해 null dereference 500 을 막는다.
     */
    private boolean isUnlimited(User user, Instant now) {
        Instant createdAt = user.getCreatedAt();
        return createdAt != null && now.isBefore(createdAt.plus(GRACE_PERIOD_DAYS, ChronoUnit.DAYS));
    }
}
