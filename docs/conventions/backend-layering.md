# 백엔드 계층·패키지 배치 규약

`server/data-api` 는 도메인 17개가 각자 계층 패키지를 갖는 도메인 우선 구조다.
그런데 같은 성격의 클래스가 도메인마다 다른 자리에 있어서, **패키지 경로만 보고는
그 클래스가 어느 계층인지 알 수 없는** 상태가 오래 굳어 있었다 — 리스너가 한 곳은
`listener/`, 다른 곳은 `service/` 에 있고, 순수 계산기가 서비스 빈들 사이에 섞여
있었다. 그래서 배치 판단이 리뷰 때마다 반복됐다.

이 문서가 **백엔드 배치의 정본**이다. `server/data-api/CLAUDE.md` 의 "Layout &
domains" 절은 이 문서의 요약이며, 둘이 어긋나면 **이 문서가 맞다**.

계층 배치는 `group`·`user`·`notification` 을 가로지르는 저장소 전체 규약이라
`docs/prd/<기능>/` 에 담을 수 없다 — `docs/README.md` 의 "기능 문서가 아닌 팀 전체
규약은 `docs/conventions/`" 규정을 따른다.

관련 티켓: **GROMO-1654(이 문서·전 도메인 배치 정리)** → GROMO-1655(repository
service 계층) → GROMO-1656(도메인 간 의존·순환 정리) → GROMO-1657(응답·예외 규약)
→ GROMO-1662(ArchUnit 으로 규칙 고정). 상위 에픽 GROMO-1643.

---

## 1. 표준 레이아웃

```
com.oneorthree.phone.<domain>/
├── XxxController.java          컨트롤러 — 도메인 루트에 평평하게
├── XxxControllerDocs.java      Swagger 애노테이션 전용 인터페이스
├── dto/                        요청·응답 타입 (API 계약)
├── service/                    비즈니스 로직 · 트랜잭션 경계
├── support/                    순수 헬퍼·정책·계산기·값 타입
├── repository/                 Spring Data 인터페이스 + 커스텀 구현
│   └── domain/                 @Entity · 영속 enum
├── event/                      이 도메인이 발행하는 이벤트 payload
├── listener/                   이 도메인이 구독하는 핸들러
├── client/                     외부 API 클라이언트
├── scheduler/                  @Scheduled 진입점
└── exception/                  <Domain>ErrorCode enum + <Domain>Exception

com.oneorthree.phone.config/    @Configuration · 서블릿 필터 (도메인 아님)
com.oneorthree.phone.common/    소유 도메인이 없는 공유물
```

**모든 하위 패키지를 다 만들 필요는 없다.** 해당하는 게 생길 때 만든다. 다만 만들
때는 위 이름을 쓰고, 목록에 없는 이름(`util/`·`handler/`·`facade/`·`search/`·
`policy/`)을 새로 만들지 않는다 — 계층이 이름에 드러나지 않기 때문이다.

### 컨트롤러가 도메인 루트에 있는 이유

`api/` 패키지를 한 겹 더 두는 안도 검토했지만, 이미 16개 도메인 중 15개가 루트에
평평한 상태였다(GROMO-1654 시점 실측). 다수파를 정본으로 삼아 이동량을 최소화했다.
`XxxController` 라는 이름 자체가 계층을 드러내므로 패키지로 한 번 더 표시할 실익이
적다는 판단도 함께 들어갔다.

### 엔티티가 `repository/domain/` 에 있는 이유

엔티티는 JPA 매핑이 붙은 **영속성 계층의 산물**이다. 도메인 최상위에 두면 "이건
순수 도메인 모델"이라는 신호를 주지만 실제로는 `@Entity`·`@Table`·페치 전략이
박혀 있어 신호가 거짓이 된다. `repository/` 아래에 두면 영속성 관심사가 한 덩어리로
묶이고, 서버를 분리할 때(GROMO-1661) 잘라낼 경계가 패키지로 드러난다.

---

## 2. 배치 판정 기준

경계가 헷갈릴 때는 아래 질문 하나로 가른다. **클래스 이름이 아니라 의존성이 기준이다.**

| 갈림길 | 질문 | 판정 |
| --- | --- | --- |
| `service/` vs `support/` | repository 나 다른 service 를 **주입받는가** | 주입받으면 `service/`, 입력만 받아 계산하면 `support/` |
| `dto/` vs `repository/domain/` | **DB 에 저장되는가** | 저장되면 `repository/domain/`, API 계약에만 쓰이면 `dto/` |
| `event/` vs `listener/` | 이 도메인이 **발행**하는가 **구독**하는가 | 발행 payload 는 `event/`, 구독 핸들러는 `listener/` |
| `client/` vs `service/` | **프로세스 밖**(HTTP·FCM·OpenAI)으로 나가는가 | 나가면 `client/`, 아니면 `service/` |
| `config/` vs 도메인 | 스프링 컨텍스트를 **조립**하는가 | 조립이면 최상위 `config/` — **도메인별 `config/` 는 두지 않는다** |
| `common/` vs 도메인 | **소유 도메인이 있는가** | 있으면 그 도메인, 진짜 없을 때만 `common/` |

`support/` 는 테스트가 가벼워지는 자리다. 스프링 컨텍스트 없이 `new` 해서 단위
테스트할 수 있는 것들이 여기 모인다.

---

## 3. 허용 의존 방향

```
Controller  →  Service  →  Repository  →  Entity
                  ↓
              Support · Client · Event
```

- **컨트롤러는 엔티티를 주고받지 않는다.** 요청·응답은 전부 `dto/` 타입이다.
  영속 enum(`Provider`·`Occupation` 등)을 그대로 노출하는 것도 같은 위반이다 —
  DB 값이 바뀌면 API 계약이 따라 깨진다.
- **트랜잭션 경계는 `service/` 에만 있다.** `@Transactional` 을 컨트롤러나
  repository 인터페이스에 붙이지 않는다.
- **`repository/` 에는 쿼리만 둔다.** 서비스에서 `EntityManager` 를 직접 잡고
  `flush()`·`clear()`·`detach()` 를 부르거나 네이티브 쿼리를 조립하지 않는다.
- **도메인 간 접근은 service 를 통한다.** 남의 `repository/` 를 직접 주입하면
  트랜잭션 경계가 도메인 밖으로 새고, 나중에 서버로 잘라낼 때 컴파일 단위가
  갈라지지 않는다.
- 그래도 순환이 생기면 이벤트(`event/`)나 포트 인터페이스(`common/port/`)로 끊는다.
  선례: `common/port/PushNotificationPort` — notification 을 거꾸로 참조하지 않기
  위해 만든 것이다.

### 아직 지켜지지 않는 항목 (숨기지 않고 적는다)

GROMO-1654 는 **패키지 배치만** 정리했다. 아래는 규약이지만 코드가 아직 못 따라온
구간이고, 각각 후속 티켓이 있다. 새로 쓰는 코드는 규약을 지키고, 기존 위반을
넓히지 않는 것이 현재 기준이다.

| 항목 | 실측(2026-09) | 이관처 |
| --- | --- | --- |
| 타 도메인 repository 직접 주입 | 약 120건 / 44개 service | GROMO-1655 |
| `repository/` 의 `@Transactional` | 11개 메서드 (group 4 · notification 6) | GROMO-1655 |
| service 의 `EntityManager` 직접 조작 | 5개 파일 | GROMO-1655 |
| 도메인 간 양방향 순환 | user↔group · user↔stats | GROMO-1656 |
| 컨트롤러의 영속 enum 노출 | 6건 | GROMO-1657 (앱 계약 변경 동반) |
| 규칙의 테스트 강제 | 없음 (ArchUnit 미도입) | GROMO-1662 |

---

## 4. 인정된 예외

규약을 어기지만 그대로 두기로 한 것들이다. 새 예외를 만들려면 여기에 **이유와 함께**
추가한다.

| 예외 | 이유 |
| --- | --- |
| `analytics/domain/` 이 `repository/domain/` 이 아님 | analytics 는 영속성이 없다(repository 자체가 없음). 없는 계층 아래에 넣을 수 없다. **영속성 없는 도메인은 `domain/` 을 쓴다.** |
| `common/api/HealthController` | 도메인 밖 유일한 컨트롤러. 헬스체크는 소유 도메인이 없고, 이것 하나 때문에 도메인을 신설할 이유가 없다 |
| `bot/` 에 컨트롤러·dto·exception 없음 | 외부 API 표면이 없는 내부 시뮬레이터다. 없는 계층을 억지로 만들지 않는다 |
| `support/` 가 `service/` 의 static 메서드 호출 | `GroupBetSessionFactory` → `WindowFocusAggregator.windowStartOn/windowEndOn`. 주입이 없어 배치 기준상 `support/` 가 맞지만 컴파일 타임 `support → service` 방향이 생긴다. 런타임 빈 의존이 아니라 순환·트랜잭션 문제는 없다. **ArchUnit 규칙(GROMO-1662) 도입 시 이 방향을 예외로 명시할 것** |
| `auth/` 에 `repository/`·`domain/` 없음 | 인증은 `user` 도메인의 데이터를 쓴다. 자기 테이블이 없다 (다만 현재 user repository 를 직접 주입하고 있어 GROMO-1655 대상) |

---

## 5. 패키지를 옮길 때 — 컴파일러가 안 잡는 곳

**`import` 만 고쳐서는 안 된다.** 컴파일러가 검사하지 않는 자리에 FQCN 이 문자열로
박혀 있으면, 빌드는 초록인데 애플리케이션 기동에서 터진다.

GROMO-1654 직전 커밋이 정확히 이 함정에 빠졌다. `<domain>/domain/` 을
`<domain>/repository/domain/` 으로 옮기면서 `@Query` JPQL 안의 enum 리터럴 39개가
낡은 경로를 가리킨 채 남았고, 컴파일은 통과했지만 Hibernate 가 쿼리를 해석하는
시점에 `SemanticException` 이 났다. 테스트 1881개 중 434개가 무너졌다
(ApplicationContext 로딩 실패 4건 → 임계치 초과로 430건 연쇄 스킵).

이동 후 반드시 확인한다:

```bash
grep -rn "com\.oneorthree\.phone\.<도메인>\.<옛경로>\." src/main src/test
```

FQCN·클래스명이 문자열이나 문서 참조로 박히는 자리는 세 종류다:

1. **`@Query` JPQL 의 enum 리터럴** — JPQL 은 enum 을 FQCN 으로 쓴다
2. **`src/main/resources/logback-spring.xml`** 의 `converterClass`
   (현재 `common/logging/MaskingConverter` 하나)
3. **Javadoc `{@link}`** — 같은 패키지라 짧은 이름으로 걸려 있던 링크는 패키지가 갈리는
   순간 끊긴다. `compileJava`·`checkstyleMain`·테스트가 **전부 초록인 채 통과**하므로
   `./gradlew javadoc` 을 돌려야만 드러난다(CI 는 이 태스크를 돌지 않는다). 해소는 javadoc
   전용 import 로 한다 — Checkstyle `UnusedImports` 는 이를 미사용으로 잡지 않는다

`@ComponentScan`·`basePackages`·`@EntityScan`·`@EnableJpaRepositories` 는 한 곳도
없다 — `PhoneApplication` 기준 기본 스캔이라 `com.oneorthree.phone` 아래면 잡힌다.

**컴파일만으로 끝내지 마라.** 컨텍스트가 실제로 뜨는지는 테스트를, 문서 참조가 살아
있는지는 `./gradlew javadoc` 을 돌려야 안다.

### 패키지가 갈리면 가시성도 갈린다

같은 패키지였던 두 클래스가 나뉘면, package-private 멤버 접근이 끊긴다. 이때
가시성을 넓히는 것은 동작 변경이 아니므로 허용하되, **커밋 메시지에 남긴다**.
GROMO-1654 에서는 `GroupBetSettler.effectiveJoinDeadline` 하나가 여기 해당했다
(리스너를 `listener/` 로 빼면서 `public` 으로).

---

## 6. 새 도메인을 만들 때

1. `com.oneorthree.phone.<domain>/` 아래에 **필요한 계층만** 만든다
2. 컨트롤러는 도메인 루트, 엔티티는 `repository/domain/`
3. 실패 응답이 필요하면 `exception/` 에 `<Domain>ErrorCode` + `<Domain>Exception`
   쌍을 만들고 `common/exception/GlobalExceptionHandler` 에 등록한다
   (공통 베이스 신설은 GROMO-1657 에서 다룬다)
4. 다른 도메인의 데이터가 필요하면 **그 도메인의 service 를 주입한다** — repository 가 아니라
5. `/back-endpoint` 스킬이 이 배치대로 골격을 잡아준다
