package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.repository.GroupJoinCodeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.service.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 탈퇴 ↔ 그룹 생성 동시 실행 통합 테스트 (GROMO-1226) — 유령 그룹이 생기지 않음을 실 DB 로
 * 고정한다.
 *
 * <p>createGroup 이 락 없는 findById 로 요청자를 읽으면, 탈퇴 트랜잭션의 정리 스캔(멤버십 0 확인)
 * 이후·커밋 이전에 생성이 끼어 <b>탈퇴자가 OWNER 인 is_left=false 그룹</b>이 영구 잔존한다 —
 * 탈퇴자는 재탈퇴가 불가하고(이미 is_deleted) 위임도 불가해 복구 불능이다. 공유 락
 * ({@code findActiveByIdForShare})이 탈퇴의 배타 락과 직렬화되면 유효한 종착지는 둘뿐이다:
 * ① 탈퇴 선커밋 → 생성이 NOT_FOUND 로 거절, ② 생성 선커밋 → 탈퇴의 A-2 정리가 solo 오너
 * 그룹을 자동 종료(ENDED)·이탈 마킹한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는 이유는 {@link GroupBetCancelWithdrawIntegrationTest} 와
 * 같다 — 레이스는 별도 스레드의 별도 트랜잭션 커밋을 전제한다. 데이터는 {@code @AfterEach} 에서
 * 직접 지운다.
 */
class GroupCreateWithdrawRaceIntegrationTest extends IntegrationTestBase {

    @Autowired
    GroupService groupService;
    @Autowired
    UserService userService;
    @Autowired
    GroupRepository groupRepository;
    @Autowired
    GroupMemberRepository groupMemberRepository;
    @Autowired
    GroupJoinCodeRepository groupJoinCodeRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    UserWalletRepository userWalletRepository;

    private User user;
    /** 생성이 이겼을 때만 채워진다 — tearDown 정리와 종착지 분기 판정에 쓴다. */
    private final AtomicReference<UUID> createdGroupId = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        user = userRepository.save(User.builder().nickname("경합생성자").isGuest(false).build());
        userWalletRepository.save(UserWallet.builder().userId(user.getId()).balance(100).build());
    }

    @AfterEach
    void tearDown() {
        UUID groupId = createdGroupId.get();
        if (groupId != null) {
            groupJoinCodeRepository.findById(groupId).ifPresent(groupJoinCodeRepository::delete);
            groupRepository.findById(groupId).ifPresent(group -> {
                groupMemberRepository.findAnyByUserAndGroup(user, group)
                        .ifPresent(groupMemberRepository::delete);
                // Group 은 @Version 낙관락이 있어 close() 이후엔 재조회 인스턴스로 지워야 한다.
                groupRepository.delete(group);
            });
        }
        userWalletRepository.findById(user.getId()).ifPresent(userWalletRepository::delete);
        userRepository.delete(user);
        createdGroupId.set(null);
    }

    @Test
    @DisplayName("탈퇴 ↔ 그룹 생성 동시 실행 — 공유 락 직렬화로 '탈퇴자가 OWNER 인 활성 그룹'이 남지 않는다")
    void withdrawAndCreateGroupRaceLeavesNoGhostGroup() throws Exception {
        CyclicBarrier startTogether = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> createCall = pool.submit(() -> {
                await(startTogether);
                try {
                    CreateGroupResponse response = groupService.createGroup(user.getId(),
                            CreateGroupRequest.builder().name("경합스터디").maxMembers(5).build());
                    createdGroupId.set(response.groupId());
                } catch (UserException e) {
                    // 탈퇴가 먼저 커밋됐으면 활성 조회(공유 락)가 빈 결과 → 404 거절이 정상이다 (D9).
                    assertThat(e.getErrorCode()).isEqualTo(UserErrorCode.NOT_FOUND);
                }
            });
            Future<?> withdrawCall = pool.submit(() -> {
                await(startTogether);
                // 생성이 먼저 커밋됐어도 탈퇴는 성공해야 한다 — solo 오너 그룹은 A-2 가 자동 종료한다.
                userService.withdraw(user.getId());
            });
            createCall.get(30, TimeUnit.SECONDS);
            withdrawCall.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        // 어느 순서로 끝났든 탈퇴 자체는 완료돼 있다.
        assertThat(userRepository.findById(user.getId()).orElseThrow().isDeleted()).isTrue();
        // 유령 그룹 불가 — 탈퇴 완료 유저가 OWNER 로 남은 활성(is_left=false) 멤버십은 존재할 수 없다.
        assertThat(groupMemberRepository.findActiveOwnerMembershipsByUserId(user.getId())).isEmpty();

        UUID groupId = createdGroupId.get();
        if (groupId == null) {
            // 종착지 ① 탈퇴 선커밋 — 생성이 404 로 거절돼 그룹도 멤버십도 만들어지지 않았다.
            assertThat(groupMemberRepository.findByUser(user)).isEmpty();
        } else {
            // 종착지 ② 생성 선커밋 — 탈퇴가 solo 오너 그룹을 자동 종료(ENDED)하고 이탈 마킹했다.
            Group group = groupRepository.findById(groupId).orElseThrow();
            assertThat(group.getStatus()).isEqualTo(GroupStatus.ENDED);
            assertThat(groupMemberRepository.findAnyByUserAndGroup(user, group).orElseThrow().isLeft())
                    .isTrue();
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
