package com.oneorthree.business;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Business API — 앱이 들어오는 유일한 표면이자 코어·위성 조합의 주체다(목표 아키텍처 §2 · A22 ㊫).
 *
 * <p><b>이 서비스는 최소 구현이다.</b> 1661 의 전체 BFF/IdP 이전과 구분한다 — 지금 여기 있는 것은
 * 「링크·알림 위성을 조합해야만 성립하는 기존 외부 경로」와 「이관 정지 창의 구·신 조합」뿐이고,
 * 인증 발급(AT 서명·refresh·logout)과 그 밖의 패스스루는 아직 Data API 에 남아 있다. 전환 기간에는
 * legacy issuer 가 서명한 AT 를 이 서비스가 <b>검증만</b> 한다.
 *
 * <p><b>없는 것이 계약이다.</b> DB · 트랜잭션 · 크론 · 메시지 브로커가 없다(§2 「안 하는 일」).
 * 그래서 이 서비스는 어떤 상태도 이어 줄 수 없고, 두 요청에 걸친 값은 전부 앱이나 Data 가 들고 있어야
 * 한다 — 기기 토큰 삭제 outbox 를 「DELETE 를 처리하는 자리」에서 만드는 이유(A22 ㊲)가 그것이다.
 */
@SpringBootApplication
public class BusinessApplication {

    public static void main(String[] args) {
        SpringApplication.run(BusinessApplication.class, args);
    }
}
