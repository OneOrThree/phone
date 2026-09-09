package com.oneorthree.phone.character.service;

import com.oneorthree.phone.character.repository.domain.CharacterGeneration;
import com.oneorthree.phone.character.dto.CharacterQuotaResponse;
import com.oneorthree.phone.character.repository.CharacterGenerationRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
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
 * <p>정책: 이 기능을 처음 만난 시점부터 7일은 무제한(trial), 이후 롤링 7일 내 3회로 제한한다.
 * 판정 근거는 {@link CharacterGeneration} append-only 이력이다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CharacterGenerationService {

    /** trial(무제한) 기간(일). */
    private static final int GRACE_PERIOD_DAYS = 7;
    /** 제한 구간의 롤링 윈도우 길이(일). */
    private static final int ROLLING_WINDOW_DAYS = 7;
    /** 제한 구간에서 윈도우당 허용 생성 횟수. */
    private static final int ROLLING_LIMIT = 3;

    private final UserQueryService userQueryService;
    private final UserRepository userRepository;
    private final CharacterGenerationRepository characterGenerationRepository;
    private final EntityManager entityManager;

    /**
     * 현재 쿼터 조회 (GET /api/v1/character/quota). 클라 pre-check(UX)용 — 실제 관문은 record 이다.
     *
     * <p>조회지만 쓰기 트랜잭션이다 — trial 앵커를 이 호출에서 lazy 초기화하기 때문
     * ({@link #ensureTrialAnchor}). 클라는 캐릭터 만들기 화면 진입 시 이 API 를 부르므로,
     * 유저가 기능을 처음 여는 순간이 곧 trial 시작점이 된다.
     *
     * @param userId 조회 대상 유저. 탈퇴했거나 없는 유저면 NOT_FOUND(404)
     * @return trial 구간이면 unlimited, 아니면 남은 횟수와 슬롯이 열리는 시각.
     *         이 값은 UX 안내용이며 실제 한도 판정은 {@link #recordGeneration} 이 다시 한다
     */
    @Transactional
    public CharacterQuotaResponse getQuota(UUID userId) {
        User user = requireActiveUser(userId);
        Instant now = Instant.now();
        return computeQuota(user, ensureTrialAnchor(user, now), now);
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
     * @return 기록 후 쿼터. 멱등키 중복이거나 이미 한도에 닿아 기록을 건너뛴 경우에도 예외 없이
     *         현재 쿼터를 돌려주므로, 호출측은 반환값의 remaining 으로 성사 여부를 판단해야 한다
     */
    @Transactional
    public CharacterQuotaResponse recordGeneration(UUID userId, UUID clientGenerationId) {
        User user = requireActiveUser(userId);

        // ① 유저별 advisory lock — 동시 record 를 직렬화한다. 트랜잭션 커밋/롤백 시 자동 해제(xact 스코프).
        acquireUserLock(userId);

        Instant now = Instant.now();
        // getQuota 를 거치지 않고 곧장 기록하는 경로(구 클라·재시도)에서도 앵커가 비어 있지 않게 한다.
        Instant anchor = ensureTrialAnchor(user, now);

        // ③ 멱등키 중복이면 재기록하지 않고 현재 쿼터만 반환.
        if (clientGenerationId != null
                && characterGenerationRepository.existsByUserAndClientGenerationId(user, clientGenerationId)) {
            return computeQuota(user, anchor, now);
        }

        // ① 락 후 창 내 건수 재확인 — 무제한이 아니고 한도 도달이면 insert 생략(원장이 한도를 넘지 않게).
        if (!isUnlimited(anchor, now) && countInWindow(user, now) >= ROLLING_LIMIT) {
            return computeQuota(user, anchor, now);
        }

        characterGenerationRepository.save(CharacterGeneration.builder()
                .user(user)
                .clientGenerationId(clientGenerationId)
                .build());
        return computeQuota(user, anchor, now);
    }

    /**
     * 활성 검증 + 배타 락 (GROMO-801 락 규율, GROMO-1237) — 쿼터 조회·기록 트랜잭션의 요청자 로드.
     * 두 경로 모두 {@link #ensureTrialAnchor} 가 users 행을 UPDATE(트라이얼 앵커 초회 세팅)할 수 있어
     * "users 행을 변경하는 트랜잭션 = 처음부터 배타 락(findActiveByIdForUpdate)" 분류다 — 공유 락으로
     * 읽고 나중에 UPDATE 하면 같은 행을 잡은 두 트랜잭션이 서로의 공유 락 해제를 기다리는 락 승급
     * 교착이 된다(UserRepository 락 선택 원칙). 탈퇴(배타 락)가 먼저 커밋되면 READ COMMITTED
     * 재평가로 빈 결과 → NOT_FOUND(404).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 read-only 트랜잭션의 행 잠금을 거절한다.
     * 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        return userQueryService.getCallerForUpdate(userId);
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
     *   <li>그 외 → 창(now-7일 이후) 내 count 로 remaining = max(0, 3 - count);
     *       remaining==0 이면 resetAt = 슬롯을 여는 오프셋 행의 created_at + 7일, 아니면 null</li>
     * </ul>
     */
    private CharacterQuotaResponse computeQuota(User user, Instant anchor, Instant now) {
        if (isUnlimited(anchor, now)) {
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
     * trial 앵커 lazy 초기화 — 아직 비어 있으면 지금을 기준 시각으로 박고, 유효 앵커를 돌려준다.
     *
     * <p>배포 날짜 상수를 쓰지 않는 이유: 백엔드 배포 시점과 유저가 새 앱을 받는 시점이 다르고 유저마다도
     * 제각각이라, 상수로 잡으면 늦게 업데이트한 유저는 trial 이 이미 끝난 채로 기능을 만나게 된다.
     * 유저가 기능을 처음 여는 순간을 기준으로 하면 누구든 7일을 온전히 받는다.
     *
     * <p>엔티티 setter 가 아니라 단일 컬럼 UPDATE 를 쓰는 이유는
     * {@link UserRepository#initCharacterTrialAnchorAt} 주석 참고(전 컬럼 flush 로 인한 lost update 회피).
     * 동시 호출 시 UPDATE 는 IS NULL 가드로 1건만 성사되고, 진 쪽은 자기 now 를 반환값으로 쓰지만
     * 두 시각의 차이가 밀리초 수준이라 판정에 영향이 없다.
     */
    private Instant ensureTrialAnchor(User user, Instant now) {
        Instant anchor = user.getCharacterTrialAnchorAt();
        if (anchor != null) {
            return anchor;
        }
        userRepository.initCharacterTrialAnchorAt(user.getId(), now);
        return now;
    }

    /**
     * trial(무제한) 구간인지 — 앵커로부터 {@value #GRACE_PERIOD_DAYS}일 이내면 무제한.
     *
     * <p>앵커는 정의상 항상 가입일 이후이므로 {@code max(가입일, 앵커) == 앵커} 다. 그래서 가입일은 보지 않는다.
     */
    private boolean isUnlimited(Instant anchor, Instant now) {
        return now.isBefore(anchor.plus(GRACE_PERIOD_DAYS, ChronoUnit.DAYS));
    }
}
