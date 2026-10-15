package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * lease 획득 결과.
 *
 * <h2>왜 lease 가 필요한가</h2>
 * CLI 를 두 번 실행하거나 이전 실행이 중간에 죽었을 때 같은 의도를 두 프로세스가 동시에 재생하면,
 * 링크 claim 은 멱등 키로 막히더라도 <b>Data confirm 이 두 번 들어가 시도 횟수와 감사 기록이 갈린다</b>.
 * 만료되는 lease 라야 죽은 소유자의 것을 회수할 수 있다.
 *
 * <h2>왜 {@code leaseToken} 이 필요한가 — {@code leased} 만으로는 안 닫힌다</h2>
 * 만료 시각만 있으면 <b>임대가 만료된 뒤 깨어난 옛 작업자가 「새 임대 소유자의 작업」을 완료 표시</b>
 * 할 수 있다: 작업자 A 의 lease 가 만료되고 B 가 새로 잡아 재생 중인데, 느려진 A 가 자기 작업이
 * 끝났다고 보고 {@code completed} 를 부르면 B 의 진행 여부와 무관하게 큐에서 빠진다. 그러면 실제로는
 * 확정되지 않은 claim 이 「완료」로 기록돼 <b>귀속이 조용히 유실</b>된다.
 *
 * <p>그래서 lease 는 <b>그 임대에 묶인 opaque 토큰</b>을 발급하고, {@code completed} 는 그 토큰으로
 * <b>CAS</b> 한다 — 현재 임대의 토큰과 다르면 완료 표시가 거부된다. 기기 토큰 소유권의
 * {@code ownershipToken}(A22 ㊚)과 같은 패턴이다: 서버 쪽 상태만 보면 「지연된 옛 요청」과 「정상적인
 * 새 요청」을 구별할 수 없으므로 <b>값을 요청에도 실어야</b> 순서를 가른다.
 *
 * @param leased     이번 호출이 lease 를 쥐었는가. false 면 다른 소유자가 쥐고 있으니 건너뛴다
 * @param leaseToken 이 임대에 묶인 CAS 값. {@code completed} 에 그대로 실어 보낸다.
 *                   {@code leased=false} 면 null 이다
 */
public record ClaimIntentLease(boolean leased, UUID leaseToken) {
}
