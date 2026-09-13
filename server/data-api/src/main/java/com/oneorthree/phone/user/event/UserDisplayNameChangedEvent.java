package com.oneorthree.phone.user.event;

import java.util.UUID;

/**
 * 닉네임이 바뀌었다 — <b>링크 표시정보 갱신의 시작점</b> (A22 ㋡).
 *
 * <h2>왜 직접 호출이 아니라 이벤트인가</h2>
 * 의존 방향 때문이다(GROMO-1656). 갱신해야 할 대상은 그 유저가 발급자인 <b>그룹 멤버십</b>인데,
 * {@code user} 는 모든 도메인의 바닥이라 {@code group} 을 참조할 수 없다. 반대로 뒤집으면
 * {@code group → user} 라 방향이 맞는다.
 *
 * <p>소비자는 <b>동기 {@code @EventListener}</b> 라 이 트랜잭션 안에서 돈다. 커밋 이후로 미루면
 * 「이름은 바뀌었는데 링크 명령은 없는」 구간이 생기고, 그 구간에서 프로세스가 죽으면 공유된 slug 가
 * 만료까지 옛 이름을 노출한다.
 *
 * @param userId      닉네임이 바뀐 유저
 * @param displayName 바뀐 뒤의 닉네임
 */
public record UserDisplayNameChangedEvent(UUID userId, String displayName) {
}
