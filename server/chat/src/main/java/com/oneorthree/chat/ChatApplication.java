package com.oneorthree.chat;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 채팅 서비스 진입점.
 *
 * <p>이 서비스가 지키는 규칙은 둘뿐이고, 둘 다 관문에서 판정한다.
 * <ol>
 *   <li><b>같은 섬 안에서만 대화한다</b> — 섬은 세계관 표현이고 저장소 실체는 그룹이다.
 *       그룹의 활성 멤버가 아니면 구독도 발신도 못 한다.</li>
 *   <li><b>집중 중에는 채팅에 들어가지 못한다</b> — 판정 근거는 Data API 가 쓰는
 *       Redis 프레즌스 리스({@code presence:focus:{userId}})다.</li>
 * </ol>
 *
 * <p><b>채팅은 푸시 알림을 보내지 않는다.</b> 접속하지 않은 사람에게 알리지 않고, 메시지는 방에
 * 쌓여 있다가 다음 접속 때 읽힌다. 그래서 집중 중 차단이 「알림을 못 받는 손해」로 이어지지 않는다 —
 * 안 읽은 양은 읽음 커서로 세어 배지로만 보여 준다.
 *
 * <p>Redis 는 이 서비스의 <b>하드 의존성</b>이다 — 인스턴스 간 팬아웃·멤버십 캐시·집중 프레즌스가
 * 전부 Redis 에 얹혀 있어 Redis 가 없으면 채팅은 뜨지 않는다. Data API 쪽 사정은 반대다(그쪽 Redis
 * 쓰기는 전부 best-effort 라 Redis 가 죽어도 집중은 계속 돌아간다).
 */
@SpringBootApplication
public class ChatApplication {

    public static void main(String[] args) {
        SpringApplication.run(ChatApplication.class, args);
    }
}
