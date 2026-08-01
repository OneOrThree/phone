package com.oneorthree.phone.character.service;

import com.oneorthree.phone.character.domain.CharacterGeneration;
import com.oneorthree.phone.character.dto.CharacterQuotaResponse;
import com.oneorthree.phone.character.repository.CharacterGenerationRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
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

    /** 현재 쿼터 조회 (GET /api/v1/character/quota). */
    public CharacterQuotaResponse getQuota(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        return computeQuota(user, Instant.now());
    }

    /**
     * 생성 1건 기록 후 갱신된 쿼터 반환 (POST /api/v1/character/generation).
     * 클라가 이미지 저장에 성공한 뒤 호출한다. 방금 insert 한 행이 같은 트랜잭션의
     * count 조회 전 auto-flush 되므로, 반환 쿼터는 이번 생성이 반영된 값이다.
     */
    @Transactional
    public CharacterQuotaResponse recordGeneration(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        characterGenerationRepository.save(CharacterGeneration.builder()
                .user(user)
                .build());
        return computeQuota(user, Instant.now());
    }

    /**
     * 쿼터 계산.
     * <ul>
     *   <li>now &lt; 가입일 + 7일 → unlimited (remaining·resetAt null)</li>
     *   <li>그 외 → 창(now-7일 이후) 내 count 로 remaining = max(0, 2 - count);
     *       remaining==0 이면 resetAt = 창 내 가장 오래된 생성 + 7일, 아니면 null</li>
     * </ul>
     */
    private CharacterQuotaResponse computeQuota(User user, Instant now) {
        Instant graceUntil = user.getCreatedAt().plus(GRACE_PERIOD_DAYS, ChronoUnit.DAYS);
        if (now.isBefore(graceUntil)) {
            return new CharacterQuotaResponse(true, null, null);
        }

        Instant windowStart = now.minus(ROLLING_WINDOW_DAYS, ChronoUnit.DAYS);
        long count = characterGenerationRepository
                .countByUserAndCreatedAtGreaterThanEqual(user, windowStart);
        int remaining = Math.max(0, ROLLING_LIMIT - (int) count);

        Instant resetAt = null;
        if (remaining == 0) {
            resetAt = characterGenerationRepository
                    .findFirstByUserAndCreatedAtGreaterThanEqualOrderByCreatedAtAsc(user, windowStart)
                    .map(oldest -> oldest.getCreatedAt().plus(ROLLING_WINDOW_DAYS, ChronoUnit.DAYS))
                    .orElse(null);
        }
        return new CharacterQuotaResponse(false, remaining, resetAt);
    }
}
