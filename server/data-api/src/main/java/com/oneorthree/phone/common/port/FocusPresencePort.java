package com.oneorthree.phone.common.port;

import java.time.Instant;
import java.util.UUID;

/**
 * 집중·휴식 상태를 공유 Redis 리스로 제공하는 포트.
 *
 * <p>{@code FocusPresenceProjection}이 섬 투영과 함께 호출하며, 구현은 커밋 이후 리스를 반영한다.
 * 저장소 장애가 집중 명령을 실패시키지 않도록 처리하고, 누락된 리스는 재구축으로 복구한다.
 *
 * <p>세션 간 순서는 DB가 발급한 {@code focus_sessions.presence_order}로 판단하고, 같은 세션의
 * 전이는 {@code focus_session_details.version}으로 비교한다. 이 쌍보다 오래된 쓰기는 무시한다.
 * 종료는 해당 순번 이하의 리스만 지워 다음 세션을 보호한다.
 *
 * <p>순번이 없는 이전 기록은 변경하지 않는다. 상세가 없는 기록의 전이 번호는 0으로 취급한다.
 * 리스 만료 기준은 갱신 시각이 아닌 세션 시작 시각이므로 휴식·재개·재구축으로 수명이 늘지 않는다.
 */
public interface FocusPresencePort {

    /**
     * 시작·휴식·재개의 절대 상태를 순번과 전이 번호로 비교해 반영한다.
     *
     * @param userId 사용자 id
     * @param presenceOrder 세션 순번. null이면 변경하지 않는다
     * @param controlVersion 세션의 전이 번호. 상세가 없는 이전 기록은 0
     * @param state 현재 절대 상태
     * @param startedAt 리스 만료 기준인 세션 시작 시각
     */
    void focusStateChanged(UUID userId, Long presenceOrder, long controlVersion, FocusPresenceState state,
                           Instant startedAt);

    /**
     * 커밋된 정본을 바탕으로 없는 리스만 복구한다. 기존 리스의 수명은 연장하지 않는다.
     *
     * <p>종료 표식이 있으면 복구하지 않는다. 저장소 연산 실패를 반환해 호출자가 해당 회차를 중단하고
     * 다음 회차에 재시도할 수 있게 한다.
     *
     * @param userId 사용자 id
     * @param presenceOrder 정본의 세션 순번
     * @param controlVersion 정본의 전이 번호. 상세가 없는 이전 기록은 0
     * @param state 정본의 절대 상태
     * @param startedAt 리스 만료 기준인 세션 시작 시각
     * @return 연산에 성공했으면 true. 변경이 필요하지 않은 경우도 포함한다
     */
    boolean restoreLeaseIfMissing(UUID userId, Long presenceOrder, long controlVersion, FocusPresenceState state,
                                  Instant startedAt);

    /**
     * 재구축 중 종료된 세션의 리스를 즉시 해제한다.
     *
     * <p>더 새로운 세션의 리스는 유지한다. 커밋된 정본에 대한 복구이므로 커밋 콜백으로 미루지 않는다.
     *
     * @return 연산에 성공했으면 true. false이면 다음 회차에 다시 시도한다
     */
    boolean releaseLeaseNow(UUID userId, Long presenceOrder);

    /**
     * 종결된 세션의 리스를 커밋 이후 해제한다.
     *
     * <p>같거나 오래된 순번만 지우고, 더 새로운 세션의 리스는 유지한다.
     *
     * @param presenceOrder 끝난 세션의 순번. null이면 변경하지 않는다
     */
    void focusEnded(UUID userId, Long presenceOrder);

    /**
     * 탈퇴했다 — 리스·종료 표식을 지우고 <b>탈퇴 tombstone</b> 을 남긴다 (GROMO-1943 · 계정 LLD §4).
     *
     * <p>tombstone 이 있는 동안 {@link #focusStateChanged}·{@link #restoreLeaseIfMissing} 은 리스를 놓지
     * 않는다 — 탈퇴 커밋 전에 걸어 둔 시작 콜백이 늦게 도착해도 탈퇴자의 리스가 되살아나지 않는다.
     *
     * <p>커밋 이후에만 반영하고 실패는 삼킨다(다른 쓰기와 같은 규율). 여러 번 불러도 결과가 같다.
     */
    void userWithdrawn(UUID userId);
}
