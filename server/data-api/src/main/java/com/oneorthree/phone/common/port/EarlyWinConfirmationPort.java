package com.oneorthree.phone.common.port;

import java.time.LocalDate;
import java.util.Collection;
import java.util.UUID;

/**
 * 집중이 인정된 날짜에 대해 <b>내기 개인 승리 조기 확정</b>을 처리하는 포트 (GROMO-1268 N11 · GROMO-1656).
 *
 * <p><b>왜 포트인가.</b> 집중 세션은 사실이고 그룹 내기는 그 사실에 반응하는 쪽이라, 방향은
 * {@code group → focus} 여야 한다. 그런데 조기 확정은 <b>집중 저장 트랜잭션 안에서</b> 일어나야
 * 해서 {@code focus} 가 부를 수밖에 없었고, 두 방향이 겹쳐 순환이 됐다. 그래서 「집중 저장이 이
 * 시점에 무엇을 불러야 하는가」만 포트로 세우고 구현은 {@code group} 이 낸다.
 *
 * <p><b>왜 이벤트가 아닌가.</b> 두 메서드는 <b>서로 다른 시점</b>에 불려야 하고 그 순서가 계약이다
 * (아래 각 메서드 주석). 이벤트로 바꾸면 그 순서가 리스너 등록에 숨어, 한 줄도 고치지 않고 순서가
 * 바뀔 수 있다. 순서가 계약인 자리는 호출로 남긴다.
 *
 * <p>구현: {@code group/service/GroupBetEarlyWinConfirmer}. 유저 엔티티가 아니라 <b>id</b> 를 받는다 —
 * 구현이 실제로 쓰는 것이 id 뿐이고, 포트가 특정 도메인 엔티티에 묶이면 뒤집은 의미가 없다.
 */
public interface EarlyWinConfirmationPort {

    /**
     * 조기 확정 대상 회차를 <b>미리 잠근다</b>. 아직 아무것도 확정하지 않는다.
     *
     * <p><b>지갑을 만지기 전에</b> 불려야 한다(락 순서 계약 §3: 회차 → 지갑). 지갑을 먼저 잡고
     * 나중에 회차 락을 기다리면 정산·삭제 경로와 정확히 역순이라 교착·낙관락 충돌로 집중 세션·통계·
     * 보상 트랜잭션이 통째로 롤백된다.
     *
     * <p>회차가 사라져 있어도 <b>던지지 않는다</b> — 잠금 대기 중 마지막 참가자가 철회할 수 있고,
     * 거기서 예외가 나가면 방금 한 집중이 통째로 롤백된다.
     *
     * @param userId        집중을 저장 중인 유저
     * @param creditedDates 이 세션이 통계에 귀속된 날짜들
     */
    void lockCandidateSessions(UUID userId, Collection<LocalDate> creditedDates);

    /**
     * 목표를 채운 참가 행의 개인 승리를 확정한다.
     *
     * <p><b>통계 반영 뒤</b>에 불려야 한다 — 확정 판정이 방금 갱신된 집중 집계를 읽는다.
     * 발행 트랜잭션에 편승하므로 집중 저장이 롤백되면 확정도 함께 사라진다.
     *
     * @param userId        집중을 저장 중인 유저
     * @param creditedDates 이 세션이 통계에 귀속된 날짜들
     */
    void confirmWins(UUID userId, Collection<LocalDate> creditedDates);
}
