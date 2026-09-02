package com.oneorthree.phone.auth.service;

import com.oneorthree.phone.auth.dto.res.SocialLoginResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 동시 다른-소셜 게스트 승격 경쟁 통합 테스트 (GROMO-1229) — 같은 게스트 AT 로 두 기기가 서로 다른
 * 소셜에 동시 로그인해도 <b>유령 계정이 생기지 않는지</b>를 실 DB 로 고정한다.
 *
 * <p>메커니즘: 승자가 {@code findActiveGuestByIdForUpdate} 배타 락을 쥐고 승격을 커밋하면, 패자는
 * 락 해제 후 READ COMMITTED 술어 재평가에서 is_guest=false 를 보고 빈 결과 → 신규 가입 폴백으로
 * 빠져 닉네임 null 의 빈 유령 계정을 만들었다. 수정 후에는 요청 AT 의 guest 클레임(=true)으로
 * 패자를 판별해 GUEST_ALREADY_PROMOTED(409) 로 거절한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@code GroupBetCancelWithdrawIntegrationTest} 와
 * 같다 — 레이스는 별도 스레드의 별도 트랜잭션 커밋을 전제한다. 데이터는 {@code @AfterEach} 에서
 * 직접 지운다. 소셜 클라이언트는 ci 프로파일에 목/스텁 빈이 없어 외부 검증( getProviderId )을 건너뛴
 * 서비스 레벨 {@code loginOrRegister} 직접 호출로 경쟁을 재현한다 — 락·판별·폴백이 전부 그 안에 있어
 * 검증 대상 경로는 동일하다.
 */
class GuestPromotionConcurrencyTest extends IntegrationTestBase {

    @Autowired
    AuthService authService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    SocialAccountRepository socialAccountRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Autowired
    UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    @Autowired
    UserNotificationSettingsRepository userNotificationSettingsRepository;

    private static final Map<Provider, String> PROVIDER_IDS = Map.of(
            Provider.KAKAO, "kakao-race-1229",
            Provider.LINE, "line-race-1229");

    private UUID guestId;

    @BeforeEach
    void setUp() {
        // 승격 경로는 부속 테이블을 건드리지 않으므로 게스트 행만 만든다 (side rows 불필요)
        guestId = userRepository.save(User.builder().isGuest(true).build()).getId();
    }

    @AfterEach
    void tearDown() {
        // 연동 행 → (회귀로 생겼을 수 있는) 유령 유저 → 게스트 순으로 정리
        PROVIDER_IDS.forEach((provider, providerId) ->
                socialAccountRepository.findByProviderAndProviderId(provider, providerId).ifPresent(sa -> {
                    UUID ownerId = sa.getUser().getId();
                    socialAccountRepository.delete(sa);
                    if (!ownerId.equals(guestId)) {
                        deleteUserWithSideRows(ownerId);
                    }
                }));
        userRepository.deleteById(guestId);
    }

    @Test
    @DisplayName("같은 게스트 AT 로 서로 다른 소셜 동시 승격 — 한쪽만 승격, 패자는 409, 유령 계정 없음 (GROMO-1229)")
    void concurrentDifferentSocialPromotionCreatesNoGhostUser() throws Exception {
        long usersBefore = userRepository.count();

        List<SocialLoginResponse> successes = Collections.synchronizedList(new ArrayList<>());
        List<AuthException> conflicts = Collections.synchronizedList(new ArrayList<>());
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<?>> calls = new ArrayList<>();
            PROVIDER_IDS.forEach((provider, providerId) -> calls.add(pool.submit(() -> {
                await(startTogether);
                try {
                    // 게스트 AT 로 온 요청 재현 — guest 클레임 true (게스트 발급 경로)
                    successes.add(authService.loginOrRegister(provider, providerId, guestId, true));
                } catch (AuthException e) {
                    conflicts.add(e);
                }
            })));
            for (Future<?> call : calls) {
                call.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        // (b) 정확히 한쪽만 승격 성공(게스트 재활용 = isNewUser false), 다른 쪽은 GUEST_ALREADY_PROMOTED
        assertThat(successes).hasSize(1);
        assertThat(successes.get(0).isNewUser()).isFalse();
        assertThat(conflicts).hasSize(1);
        assertThat(conflicts.get(0).getErrorCode()).isEqualTo(AuthErrorCode.GUEST_ALREADY_PROMOTED);

        // (a) 유령 계정 없음 — users 행 수 불변, 게스트는 비게스트로 승격돼 있다
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        User promoted = userRepository.findById(guestId).orElseThrow();
        assertThat(promoted.isGuest()).isFalse();

        // (c) 소셜 연동은 승자 것 1건만, 전부 원래 게스트 행에 붙어 있다
        List<UUID> linkedOwnerIds = PROVIDER_IDS.entrySet().stream()
                .map(e -> socialAccountRepository.findByProviderAndProviderId(e.getKey(), e.getValue()))
                .flatMap(Optional::stream)
                .map(sa -> sa.getUser().getId())
                .toList();
        assertThat(linkedOwnerIds).containsExactly(guestId);
    }

    private void deleteUserWithSideRows(UUID userId) {
        userWalletRepository.deleteById(userId);
        userScreenTimeSettingsRepository.deleteById(userId);
        userFocusTimeSettingsRepository.deleteById(userId);
        userNotificationSettingsRepository.deleteById(userId);
        userRepository.deleteById(userId);
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}
