package com.oneorthree.phone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * data-api 서버의 부팅 진입점. com.oneorthree.phone 이하 전체가 컴포넌트 스캔 범위가 되므로,
 * 새 도메인 패키지는 이 패키지 아래에 두기만 하면 별도 등록 없이 잡힌다.
 */
@SpringBootApplication
public class PhoneApplication {

    /**
     * 스프링 컨텍스트를 띄운다.
     *
     * @param args JVM 실행 인자 — {@code --spring.profiles.active=ci} 처럼
     *             프로퍼티를 덮어쓰는 통로로 쓰인다
     */
    public static void main(String[] args) {
        SpringApplication.run(PhoneApplication.class, args);
    }

}
