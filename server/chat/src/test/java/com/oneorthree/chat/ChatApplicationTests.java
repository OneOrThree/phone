package com.oneorthree.chat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/**
 * 부팅 한 번으로 <b>스키마 드리프트</b>를 잡는 테스트.
 *
 * <p>「컨텍스트 로딩 테스트」는 흔히 형식적인 것으로 취급되지만 여기서는 아니다. ci 프로파일이
 * Flyway 를 켜고 {@code ddl-auto=validate} 로 두었기 때문에, 이 테스트가 초록이라는 말은
 * <b>{@code V1__baseline.sql} 이 만든 테이블과 엔티티 매핑이 실제로 일치한다</b>는 뜻이다.
 *
 * <p>이게 왜 중요한가 — 이 레포는 정확히 그 드리프트로 dev 가 죽은 적이 있다(GROMO-1506).
 * 당시 CI 는 {@code create-drop} 으로 엔티티에서 스키마를 만들어서, 마이그레이션 SQL 과 엔티티가
 * 어긋나도 초록이었고 어긋남은 배포 부팅에서야 드러났다. 채팅은 그 실패를 여기로 끌어왔다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Import(TestcontainersConfiguration.class)
class ChatApplicationTests {

    @Test
    @DisplayName("Flyway 로 만든 스키마와 엔티티 매핑이 일치하면 컨텍스트가 뜬다")
    void contextLoads() {
        // 부팅 자체가 검증이다 — validate 가 실패하면 여기 오기 전에 터진다.
    }
}
