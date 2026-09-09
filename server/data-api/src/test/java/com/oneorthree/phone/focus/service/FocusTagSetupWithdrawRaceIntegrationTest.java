package com.oneorthree.phone.focus.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.repository.DefaultTagRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 탈퇴 ↔ 집중 태그 채택 동시 실행 통합 테스트 (GROMO-1237) — 탈퇴 확정 이후에 유저 소유
 * 자원이 새로 생기지 않음을 실 DB 로 고정한다.
 *
 * <p>setupFocusTag 가 락 없는 findById 로 요청자를 읽으면, 탈퇴 트랜잭션(유저 행 배타 락)의
 * 커밋 이전 스냅샷을 보고 통과해 <b>탈퇴자 명의 user_focus_tags 행</b>이 탈퇴 커밋 이후에 남는다.
 * 공유 락({@code findActiveByIdForShare})이 탈퇴의 배타 락과 직렬화되면 유효한 종착지는 둘뿐이다:
 * ① 탈퇴 선커밋 → READ COMMITTED 재평가로 빈 결과 → 채택이 NOT_FOUND 로 거절(자원 없음),
 * ② 채택 선커밋 → 탈퇴는 그 뒤에 완료(태그는 활성 시절 산물로 잔존 — 유령 아님).
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@link
 * com.oneorthree.phone.group.service.GroupCreateWithdrawRaceIntegrationTest} 와 같다 — 레이스는
 * 별도 스레드의 별도 트랜잭션 커밋을 전제한다. 데이터는 {@code @AfterEach} 에서 직접 지운다.
 */
class FocusTagSetupWithdrawRaceIntegrationTest extends IntegrationTestBase {

    @Autowired
    FocusService focusService;
    @Autowired
    AccountWithdrawalService accountWithdrawalService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;
    @Autowired
    UserFocusTagRepository userFocusTagRepository;
    @Autowired
    DefaultTagRepository defaultTagRepository;

    private User user;
    /** default_tags 는 이름 전역 유일이라 다른 테스트와 충돌하지 않도록 실행별 고유 이름을 쓴다. */
    private String tagName;

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("경합채택자").isGuest(false).build());
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).balance(100).build());
        tagName = "경합태그" + UUID.randomUUID().toString().substring(0, 4);
    }

    @AfterEach
    void tearDown() {
        userFocusTagRepository.deleteAll(
                userFocusTagRepository.findByUserAndDeletedAtIsNull(user));
        defaultTagRepository.findByName(tagName).ifPresent(defaultTagRepository::delete);
        userWalletRepository.findById(user.getId()).ifPresent(userWalletRepository::delete);
        userRepository.delete(user);
    }

    @Test
    @DisplayName("탈퇴 ↔ 태그 채택 동시 실행 — 공유 락 직렬화로 '탈퇴 확정 이후 생성'이 불가능하다")
    void withdrawAndSetupFocusTagRaceLeavesNoPostWithdrawResource() throws Exception {
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        // true = 채택 트랜잭션이 커밋됨(종착지 ②), false = NOT_FOUND 거절(종착지 ①).
        boolean setupCommitted;
        try {
            Future<Boolean> setupCall = pool.submit(() -> {
                await(startTogether);
                try {
                    focusService.setupFocusTag(user.getId(), new FocusTagSetupRequest(tagName));
                    return true;
                } catch (UserException e) {
                    // 탈퇴가 먼저 커밋됐으면 공유 락 조회가 재평가로 빈 결과 → 404 거절이 정상이다.
                    assertThat(e.getErrorCode()).isEqualTo(UserErrorCode.USER_NOT_FOUND);
                    return false;
                }
            });
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                // 채택이 먼저 커밋됐어도 탈퇴는 성공해야 한다(태그는 탈퇴를 막는 자원이 아니다).
                accountWithdrawalService.withdraw(user.getId());
            });
            setupCommitted = setupCall.get(30, TimeUnit.SECONDS);
            withdrawCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 어느 순서로 끝났든 탈퇴 자체는 완료돼 있다.
        assertThat(userRepository.findById(user.getId()).orElseThrow().isDeleted()).isTrue();

        List<UserFocusTag> tags = userFocusTagRepository.findByUserAndDeletedAtIsNull(user);
        if (setupCommitted) {
            // 종착지 ② 채택 선커밋 — 활성 시절에 만든 태그 1개가 남는다(직렬화 순서상 탈퇴 이전 산물).
            assertThat(tags).hasSize(1);
            assertThat(tags.get(0).getDefaultTag().getName()).isEqualTo(tagName);
        } else {
            // 종착지 ① 탈퇴 선커밋 — 채택이 404 로 거절돼 탈퇴자 명의 태그가 만들어지지 않았다.
            assertThat(tags).isEmpty();
        }
    }

    private void await(CyclicBarrier barrier) {
        try {
            barrier.await(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("동시 출발 대기 실패", e);
        }
    }
}
