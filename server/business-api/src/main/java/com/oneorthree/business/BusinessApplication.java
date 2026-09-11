package com.oneorthree.business;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Business API — 앱이 들어오는 유일한 표면이자 코어·위성 조합의 주체다(목표 아키텍처 §2 · A22 ㊫).
 *
 * <h2>두 가지 일을 한다</h2>
 * <ol>
 *   <li><b>파일 링크 미리보기</b>(GROMO-1747) — 채팅에 공유한 공개 URL 의 파일명·유형·썸네일을 만든다.
 *       결과는 전용 Redis 에 TTL 로만 담는다.</li>
 *   <li><b>링크·알림 위성 조합</b>(GROMO-1659) — 위성을 조합해야만 성립하는 기존 외부 경로와,
 *       이관 정지 창의 구·신 조합.</li>
 * </ol>
 *
 * <p><b>이 서비스는 최소 구현이다.</b> 1661 의 전체 BFF/IdP 이전과 구분한다 — 인증 발급(AT 서명·refresh·
 * logout)과 그 밖의 패스스루는 아직 Data API 에 남아 있다. 전환 기간에는 legacy issuer 가 서명한 AT 를
 * 이 서비스가 <b>검증만</b> 한다.
 *
 * <p><b>없는 것이 계약이다.</b> 도메인 DB · 트랜잭션 · 크론 · 메시지 브로커가 없다(§2 「안 하는 일」).
 * 그래서 이 서비스는 도메인 상태를 이어 줄 수 없고, 두 요청에 걸친 <b>도메인</b> 값은 전부 앱이나 Data 가
 * 들고 있어야 한다 — 기기 토큰 삭제 outbox 를 「DELETE 를 처리하는 자리」에서 만드는 이유(A22 ㊲)가 그것이다.
 *
 * <p><b>미리보기 캐시는 그 예외가 아니라 「사본」이다.</b> A19 네임스페이스 표의 {@code cache:business:*}
 * 소유자로서 자기 Redis 를 갖지만, 정본이 없고 비워도 다음 요청이 다시 만들며 어떤 도메인 판정도 거기에
 * 의존하지 않는다. 「DB 가 없다」는 계약과 「캐시가 있다」는 사실은 함께 성립한다 — 캐시에 도메인 상태를
 * 얹는 순간 그 구분이 무너지므로, 저장되는 것은 미리보기 메타데이터와 축소 PNG 뿐이어야 한다.
 */
@SpringBootApplication
public class BusinessApplication {

    public static void main(String[] args) {
        SpringApplication.run(BusinessApplication.class, args);
    }
}
