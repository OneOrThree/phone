package com.oneorthree.phone.character.service;

import com.oneorthree.phone.character.dto.CharacterQuotaResponse;
import com.oneorthree.phone.character.repository.CharacterGenerationRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 누끼 생성 쿼터 판정 단위 테스트.
 *
 * <p>여기서 잠그는 성질은 셋이다: ① trial 기준이 <b>가입일이 아니라 유저별 첫 접촉(앵커)</b>이라
 * 오래 전 가입자도 지금 처음 열면 무제한을 받는가, ② 앵커가 비어 있으면 조회 그 순간에 박히는가,
 * ③ 제한 구간의 한도가 롤링 7일 <b>3회</b>인가.
 *
 * <p>advisory lock 네이티브 쿼리를 타는 {@code recordGeneration} 은 여기 범위 밖이다(통합테스트 영역).
 */
@ExtendWith(MockitoExtension.class)
class CharacterGenerationServiceTest {

    private static final UUID USER_ID = UUID.randomUUID();

    @Mock
    private UserQueryService userQueryService;
    @Mock
    private UserRepository userRepository;
    @Mock
    private CharacterGenerationRepository characterGenerationRepository;
    @Mock
    private EntityManager entityManager;

    @InjectMocks
    private CharacterGenerationService service;

    /** 가입한 지 오래됐고 앵커만 지정된 유저. 앵커가 null 이면 "아직 기능을 만난 적 없음". */
    private User user(Instant anchor) {
        return User.builder()
                .id(USER_ID)
                .createdAt(Instant.parse("2026-01-01T00:00:00Z")) // 한참 전 가입
                .characterTrialAnchorAt(anchor)
                .build();
    }

    // GROMO-1237: 쿼터 경로는 trial 앵커 UPDATE 가능성이 있어 배타 락 조회를 쓴다(락 규율).
    private void givenUser(User user) {
        given(userQueryService.getTargetForUpdate(USER_ID)).willReturn(user);
    }

    private void givenWindowCount(long count) {
        given(characterGenerationRepository
                .countByUserAndCreatedAtGreaterThanEqual(any(User.class), any(Instant.class)))
                .willReturn(count);
    }

    @Test
    @DisplayName("앵커가 비어 있으면 조회 시점에 박히고, 그 자리에서 바로 무제한이 된다")
    void anchorIsStampedOnFirstQuotaLookup() {
        givenUser(user(null));
        Instant before = Instant.now();

        CharacterQuotaResponse quota = service.getQuota(USER_ID);

        // 가입한 지 반년이 넘었어도, 기능을 지금 처음 열었으므로 trial 이 시작된다.
        assertThat(quota.unlimited()).isTrue();
        assertThat(quota.remaining()).isNull();

        // 엔티티 setter 가 아니라 단일 컬럼 UPDATE 로 박혀야 한다(전 컬럼 flush 로 인한 lost update 회피).
        ArgumentCaptor<Instant> stamped = ArgumentCaptor.forClass(Instant.class);
        verify(userRepository).initCharacterTrialAnchorAt(eq(USER_ID), stamped.capture());
        assertThat(stamped.getValue()).isAfterOrEqualTo(before);
    }

    @Test
    @DisplayName("앵커 후 7일 이내면 무제한 — 가입일이 아무리 오래됐어도 무관")
    void unlimitedWithinSevenDaysOfAnchor() {
        givenUser(user(Instant.now().minus(3, ChronoUnit.DAYS)));

        CharacterQuotaResponse quota = service.getQuota(USER_ID);

        assertThat(quota.unlimited()).isTrue();
    }

    @Test
    @DisplayName("앵커 후 7일이 지나면 제한 구간 — 창이 비었으면 3회 남는다")
    void limitedAfterTrialWithThreeRemaining() {
        givenUser(user(Instant.now().minus(10, ChronoUnit.DAYS)));
        givenWindowCount(0);

        CharacterQuotaResponse quota = service.getQuota(USER_ID);

        assertThat(quota.unlimited()).isFalse();
        assertThat(quota.remaining()).isEqualTo(3);
        assertThat(quota.resetAt()).isNull();
    }

    @Test
    @DisplayName("제한 구간에서 창 안에 3건이면 소진 — resetAt 은 가장 오래된 행 + 7일")
    void exhaustedAtThreeInWindow() {
        givenUser(user(Instant.now().minus(10, ChronoUnit.DAYS)));
        givenWindowCount(3);
        Instant oldest = Instant.now().minus(2, ChronoUnit.DAYS);
        // 창 내 건수 == 한도라 슬롯을 여는 행은 오프셋 0(가장 오래된 행)이다.
        given(characterGenerationRepository
                .findCreatedAtInWindowOrderByCreatedAtAsc(any(User.class), any(Instant.class), any()))
                .willReturn(List.of(oldest));

        CharacterQuotaResponse quota = service.getQuota(USER_ID);

        assertThat(quota.unlimited()).isFalse();
        assertThat(quota.remaining()).isZero();
        assertThat(quota.resetAt()).isEqualTo(oldest.plus(7, ChronoUnit.DAYS));
    }

    @Test
    @DisplayName("이미 박힌 앵커는 다시 조회해도 건드리지 않는다 — 불필요한 write 없음")
    void anchorIsNotOverwritten() {
        givenUser(user(Instant.now().minus(10, ChronoUnit.DAYS)));
        givenWindowCount(0);

        service.getQuota(USER_ID);

        verify(userRepository, never()).initCharacterTrialAnchorAt(any(), any());
    }

    @Test
    @DisplayName("쿼터 조회는 배타 락 조회를 쓴다 — 무락·무필터 getAny 금지 (GROMO-1237 락 규율)")
    void getQuotaLoadsUserWithExclusiveLock() {
        givenUser(user(Instant.now().minus(3, ChronoUnit.DAYS)));

        service.getQuota(USER_ID);

        // 앵커 lazy 초기화가 users 행을 UPDATE 할 수 있으므로 처음부터 배타 락(승급 교착 방지).
        verify(userQueryService).getTargetForUpdate(USER_ID);
        verify(userQueryService, never()).getAny(USER_ID);
    }
}
