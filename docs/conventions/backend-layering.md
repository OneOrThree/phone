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
│   ├── XxxQueryService.java    조회 계층 — id 조회 전담 (§3)
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

## 3. 조회 계층 (`<domain>QueryService`)

service 가 repository 를 직접 들면 **영속성 관심사와 비즈니스 로직이 한 클래스에 섞인다**.
`findById(...).orElseThrow(...)` 보일러플레이트가 service 마다 반복되고, 같은 엔티티를
여러 service 가 제각기 조회하면서 **필터·락·예외가 도메인 안에서도 갈린다**.
`repository/` 안에 조회 전담 클래스를 두어 그 갈래를 하나로 접는다 (GROMO-1655).

**선례**: `user/repository/UserQueryService` — 31개 service 의 User 조회 66건을 흡수했고,
25개 파일에서 `userRepository` 필드가 사라졌다. 새 도메인은 이 형태를 따른다.

### 규칙

| | |
| --- | --- |
| 이름 | `<Domain>QueryService` |
| 위치 | `<domain>/repository/` — 영속성 관심사라 `service/` 가 아니다 |
| 애노테이션 | `@Service` + `@RequiredArgsConstructor`. **`@Transactional` 을 붙이지 않는다** |
| 책임 | **id 로 하는 조회만.** 저장·수정·범위 스캔·검색·프로젝션은 repository 직행 |

**트랜잭션을 시작하지 않는다.** 호출한 service 의 트랜잭션에 참여할 뿐이다.
락 메서드는 트랜잭션 밖에서 부르면 아무 일도 하지 않으므로, 호출측이 `@Transactional`
안에 있는지 확인할 책임을 진다.

### 시그니처가 감추면 안 되는 것 두 가지

**① 락 등급.** 락 선택은 취향이 아니라 정확성 결정이다(§4 「허용 의존 방향」과 `UserRepository` 의 상세 논증 참조). 조회 계층이 락을 자동으로
고르면 그 규칙이 코드에서 사라지고, **"이 경로가 어떤 락을 쓰는가"를 테스트로 강제할
방법도 없어진다**. 메서드 이름에 남긴다 — 접미사 없음(무락) · `ForShare` · `ForUpdate`.

**② 실패의 의미.** 같은 "없음"이라도 <b>요청이 지목한 대상</b>의 부재와 <b>요청자 본인</b>의
부재는 클라이언트의 탈출구가 다르다(전자는 "없는 대상", 후자는 "재로그인"). 앱이 응답의
code 문자열로 분기하므로 합치면 계약이 깨진다 — `getTarget*` / `getCaller*` 로 가른다.

### 표준 메서드 모양

```java
Optional<Xxx> findActive(UUID id);          // 부재가 정상 흐름
Xxx getTarget(UUID id);                     // 지목 대상 부재 → 도메인 NOT_FOUND
Xxx getCaller(UUID id);                     // 요청자 본인 부재 → 재로그인 코드
Xxx getTargetForShare(UUID id);             // 공유 락 — 그 트랜잭션이 이 행을 안 고칠 때
Xxx getTargetForUpdate(UUID id);            // 배타 락 — 이 트랜잭션이 이 행을 고칠 때
Optional<Xxx> findActiveForUpdate(UUID id); // 배타 락인데 부재가 정상 흐름(배치 스킵 등)
List<Xxx> findAllActive(Collection<UUID> ids);
```

**필요한 것만 만든다.** 도메인마다 쓰는 조합이 다르니 위를 그대로 복사하지 말고,
실제 호출부가 요구하는 것만 둔다.

**동사는 둘뿐이다 — `get*` 은 없으면 던지고, `find*` 는 `Optional` 을 준다.** 도메인마다
`require*`·`ensure*` 같은 동사를 새로 만들지 않는다. 세 번째 동사가 생기는 순간 다음 도메인이
네 번째를 만들고, "이 메서드가 던지는가"를 이름으로 알 수 없게 된다. 반환값을 버리는
호출부가 있어도 마찬가지다 — 그건 그 호출부의 사정이지 메서드의 계약이 아니다.

### 관계 조회 — id 하나로 끝나지 않는 자리

위 표준형은 전부 **단일 id 조회**다. 하지만 "이 유저가 이 그룹의 멤버인가"처럼 **이미 조회한
엔티티 둘 사이의 관계**를 묻는 조회도 같은 계층에 든다. 형태만 다를 뿐 접는 이유가 같기 때문이다
— 같은 쿼리가 도메인 곳곳에서 제각기 다른 예외로 갈린다.

```java
GroupMember getMembership(User user, Group group);            // 부재 → 도메인 코드로 거절
Optional<GroupMember> findMembership(User user, Group group); // 부재가 정상이거나 다른 코드로 거절
```

- **동사 규칙은 그대로다.** 인자가 id 가 아니라 엔티티라고 해서 `require*` 로 바꾸지 않는다.
- **명사를 짝 맞춘다.** `getMembership`/`findMembership` 처럼 같은 명사를 쓴다 —
  `getMember`/`findMembership` 이면 둘이 같은 쿼리라는 사실이 이름에서 사라진다.
- **`find*` 판이 필요한 이유가 관계 조회에서 특히 자주 생긴다.** 존재 자체가 거절 사유이거나
  (`ALREADY_MEMBER`), 부재를 기본 코드가 아닌 다른 코드로 거절하거나(요청자가 아니라 지목한
  대상이라 `NOT_FOUND`), 부재가 정상이라 boolean 으로만 쓰는 자리들이다. 그 예외 의미는
  **호출부에 남긴다** — 계층이 삼키면 같은 쿼리가 다시 갈래를 잃는다.
- 관계 조회를 **락 등급까지 계층에 올릴지는 별개 판단**이다. `group` 은 올리지 않았다 —
  잠금판이 `(userId, groupId)` 로 활성 행을 잠그는 다른 시그니처라 인자부터 다르고,
  호출부가 repository 를 직행한다. 감춘 게 아니라 그 조합을 안 만든 것이므로,
  **왜 없는지를 클래스 Javadoc 에 적는다.**

### 예외 축 — "일부러 필터를 안 거는" 조회

소프트딜리트 필터를 **일부러 걸지 않아야** 하는 경로가 있다. 예: 친구·핀 **해제**는 상대가
탈퇴해도 되어야 한다 — 활성 검증을 걸면 잔존 관계를 영구히 못 지운다(GROMO-801).
이런 자리는 `getAny(id)` 로 따로 두고, **호출부에 "왜 탈퇴자도 대상인지"를 적을 수 있을
때만** 쓴다. 상태를 만들거나 바꾸는 경로에는 쓰지 않는다.

### 옮기지 않는 것

`repository/` 직행이 맞는 것들이다 — 프로젝션 조회(엔티티 전량 로드가 낭비인 자리),
범위·조건 스캔(id 조회가 아님), 닉네임 등 검색, 저장·수정, 그리고 도메인 전용 술어가
붙은 조회(예: 게스트 한정 락 — 범용 계층에 넣으면 그 술어의 근거가 사라진다).

**"단일 진입점"이라고 쓰지 마라.** 위 예외들이 남으므로 사실이 아니고, 그렇게 적으면
다음 사람이 계층만 감사하고 남은 경로를 놓친다. `user` 의 경우 **탈퇴자 401 게이트가
계층이 아니라 `config/JwtFilter` 에 있다**(GROMO-827).

### 계층을 만들면 테스트가 하나 사라진다 — 그 자리에 다시 세워라

조회를 계층으로 접으면 **호출부 테스트의 검증력이 조용히 줄어든다.** 종전에는
`given(xxxRepository.findById(id)).willReturn(Optional.empty())` 로 **행 부재를 입력**해
"부재 → 어떤 예외 코드"를 증명했는데, 이관 후에는 계층을 목으로 세우므로
`given(xxxQueryService.getXxx(id)).willThrow(...)` 가 된다. 그건 **목에게 답을 알려주고 그
답이 돌아오는지 보는 동어반복**이라 매핑을 더는 증명하지 않는다. 통과하는데 증명하지
않으므로 눈에 띄지도 않는다 — `group` 에서는 이 상태로 예외 코드를 바꾸거나 배타 락을
무락으로 내려도 스위트 전체가 초록이었다.

**계약이 계층 한 곳으로 모였으니 증인도 거기 둔다.** `<Domain>QueryServiceTest` 를 만들고
리포지토리 목에 **부재를 입력**해 세 가지를 단언한다 — 부재 시 예외 코드, 던지는 것과
안 던지는 것의 구분, 그리고 **어떤 리포지토리 메서드를 부르는가**.

마지막 항목은 보통이라면 구현 세부에 대한 과적합이지만 **여기서는 그것이 계약이다** —
락 등급이 계층의 그 한 줄에만 남아 있어서, 호출 대상을 검증하지 않으면 계층을 만든
목적 자체가 검증되지 않는다.

**단, 이 정당화는 `<Domain>QueryServiceTest` 안에서만 성립한다.** 호출부(service) 테스트에서
같은 스타일로 리포지토리 조회를 `verify` 하기 시작하면 그건 계층이 아니라 비즈니스 로직에
대한 과적합이다. 호출부 테스트는 계층을 목으로 세워 **값과 예외만** 다루고, 리포지토리
`verify` 는 저장·삭제 같은 쓰기 부작용에만 쓴다.

새 테스트가 실제로 회귀를 잡는지는 **구현을 되돌려 확인한다.** 통과는 근거가 아니다.

---

## 4. 허용 의존 방향

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

  **단 하나의 예외는 무트랜잭션 진입점이다.** 의도적으로 무트랜잭션인 `@Scheduled` 크론이
  벌크 `@Modifying` 메서드를 직접 부르면, 호출부가 트랜잭션을 열어 줄 수 없으므로 그
  리포지토리 메서드에 `@Transactional` 을 붙인다 — 안 붙이면 `@Modifying` 이
  `InvalidDataAccessApiUsageException` 으로 죽는다. 그 외 모든 `@Modifying` 은 호출부
  (반드시 `@Transactional` service)의 트랜잭션에 편승하고 리포지토리엔 애노테이션을 두지 않는다.
  현재 예외는 1건뿐이며 §5 에 적혀 있다 (GROMO-1655).

### 도메인 사이의 방향 — 레이어 (GROMO-1656)

위 규칙(“도메인 간 접근은 service 를 통한다”)은 **누구를 통하는가**만 말하고 **어느 쪽으로
가는가**를 말하지 않는다. 그래서 A 가 B 의 service 를, B 가 A 의 service 를 부르는 구성이
규약을 지키면서도 순환이었다. 방향을 다음 한 문장으로 고정한다.

> **사실은 아래에 있고, 그 사실에 반응하거나 조립하는 것이 위에 있다.
> 참조는 위에서 아래로만 간다.**

| 레이어 | 도메인 | 왜 이 높이인가 |
| --- | --- | --- |
| L0 | `user` | 계정. 다른 무엇도 전제하지 않는다 — **아무도 참조하지 않는다** |
| L1 | `currency` · `item` | 유저에게 달린 원장·보유 |
| L2 | `focus` · `screentime` | 유저가 만든 기록 |
| L3 | `friend` | 유저 사이의 관계 |
| L4 | `stats` · `league` | 기록·관계를 집계한 파생 |
| L5 | `group` | 모임·챌린지·내기 — 위 전부를 소비한다 |
| L6 | `invitelink` | 그룹을 가리키는 초대 |
| L7 | `notification` | 전 도메인의 사건을 구독해 발송한다 |
| L8 | `auth` · `character` · `bot` · `analytics` | 진입·부가 |
| L9 | `profile` · `withdrawal` | **조립·오케스트레이션 전용** — 자기 테이블이 없고, 아래 도메인의 조회 결과를 합치거나(`profile`) 정리를 정해진 순서로 부른다(`withdrawal`) |

`common/` 과 `config/` 는 레이어 밖이다 — 누가 참조해도 된다.

**세 가지를 이 표로 판정한다.**

1. **엔티티 연관관계도 참조다.** `User` 에 `@OneToMany List<UserItem>` 을 두면 user 가 item 을
   컴파일 단위로 끌어온다. 역방향 컬렉션은 소유측(`@ManyToOne`)이 있는 쪽에만 둔다.
2. **화면 조립은 아래에 두지 않는다.** “프로필에 통계·티어·장착을 붙여 내려준다”는 것은
   user 의 일이 아니라 **위에서 조립하는 일**이다. 조립하는 코드가 기반 도메인 안에 있으면
   기반이 파생을 참조하게 된다 — 순환의 가장 흔한 원인이다. 실제로 `ProfileService` 가
   `user/` 에 있는 동안 계정 도메인이 item·friend·league·stats 넷을 참조했고, 그 넷이 다시
   user 를 참조해 순환이 넷이었다. `profile/` 로 올리자 그 넷이 한 번에 사라졌다.

   **조립 도메인의 표식은 «영속성이 없다»는 것**이다. 자기 테이블·리포지토리가 없고 아래
   도메인의 조회 결과만 받아 합친다. 그 자리에 뭔가 저장하고 싶어지면 그것은 조립 도메인의
   것이 아니라 아래 어느 도메인의 것이다.
3. **클래스가 있는 자리가 소유를 말한다.** `LeagueTierLookup` 은 `league/` 에 있었지만 읽는
   것은 `users.tier_level` 뿐이었고 호출자도 friend 였다. 위치가 거짓이면 그 거짓이 그대로
   의존 간선이 된다 — `user/service/UserTierLookup` 으로 옮겨 `friend → league` 를 없앴다.

**여러 도메인을 «정해진 순서로» 정리해야 하면 오케스트레이터를 위에 둔다.** 회원 탈퇴가
그렇다 — 계정·그룹·집중·통계·스크린타임·친구를 순서대로 정리하는데, 그 전부가
`UserService.withdraw` 한 메서드(90줄) 안에 있어서 가장 아래 도메인이 위의 다섯을 참조했다.
정리하는 **방법**은 각 도메인이 알고, 정리하는 **순서**는 그 위에서 정한다
(`withdrawal/AccountWithdrawalService`).

**이벤트는 «누가 받든·순서가 상관없는» 알림에 쓴다.** 다만 이벤트가 곧 «나중에»는 아니다 —
의존 방향만 뒤집고 실행 시점은 그대로 두어야 할 때가 있다. `BetResultAcknowledgedEvent` 가
그렇다: group 이 notification 을 참조하지 않게 하려고 이벤트로 바꿨지만, 소비자는
`@EventListener`(동기, 발행 트랜잭션 안)다. `AFTER_COMMIT` 으로 미루면 그 사이에 이미 본 결과의
푸시가 나간다. **이벤트로 바꿀 때 실행 시점까지 함께 바꾸고 있지 않은지 확인하라** — 한 줄 수정으로
컴파일되고 기능 테스트도 전부 초록으로 남으므로, 그런 자리는 애노테이션 자체를 테스트로 못박는다.

이런 절차를 **이벤트로 뒤집지 마라.** 순서가 계약인데 이벤트로 바꾸면 그 순서가 리스너 등록
순서에 숨는다 — 리스너 하나가 추가되는 것만으로 순서가 바뀌고, 컴파일도 테스트도 잡아 주지
못한다. 이벤트는 «누가 받든 상관없고 순서도 상관없는» 알림에 쓴다.

**아래에서 위로 가야만 하는 일이 생기면** 이벤트(`event/`)나 포트(`common/port/`)로 뒤집는다.
선례: `common/port/InviteAttributionPort` — 그룹 참여 로그가 초대 slug 를 남겨야 해서
`group → invitelink` 가 생겼는데, 필요한 것은 “이 slug 가 누구의 어느 그룹 링크인가” 하나뿐이라
그 질문만 포트로 세우고 답은 `invitelink` 가 낸다.

### 아직 지켜지지 않는 항목 (숨기지 않고 적는다)

GROMO-1654 는 **패키지 배치만** 정리했다. 아래는 규약이지만 코드가 아직 못 따라온
구간이고, 각각 후속 티켓이 있다. 새로 쓰는 코드는 규약을 지키고, 기존 위반을
넓히지 않는 것이 현재 기준이다.

| 항목 | 실측(2026-09) | 이관처 |
| --- | --- | --- |
| 타 도메인 repository 직접 주입 | 약 120건 / 44개 service | GROMO-1655 |
| service 의 `EntityManager` 직접 조작 | 5개 파일 | GROMO-1655 |
| 도메인 간 레이어 역행 참조 | 5쌍 / import 8건 (2026-09-08, 착수 시 15쌍/49건) | GROMO-1656 진행 중 |
| 컨트롤러의 영속 enum 노출 | 6건 | GROMO-1657 (앱 계약 변경 동반) |
| 규칙의 테스트 강제 | 없음 (ArchUnit 미도입) | GROMO-1662 |

---

## 5. 인정된 예외

규약을 어기지만 그대로 두기로 한 것들이다. 새 예외를 만들려면 여기에 **이유와 함께**
추가한다.

| 예외 | 이유 |
| --- | --- |
| `analytics/domain/` 이 `repository/domain/` 이 아님 | analytics 는 영속성이 없다(repository 자체가 없음). 없는 계층 아래에 넣을 수 없다. **영속성 없는 도메인은 `domain/` 을 쓴다.** |
| `common/api/HealthController` | 도메인 밖 유일한 컨트롤러. 헬스체크는 소유 도메인이 없고, 이것 하나 때문에 도메인을 신설할 이유가 없다 |
| `bot/` 에 컨트롤러·dto·exception 없음 | 외부 API 표면이 없는 내부 시뮬레이터다. 없는 계층을 억지로 만들지 않는다 |
| `support/` 가 `service/` 의 static 메서드 호출 | `GroupBetSessionFactory` → `WindowFocusAggregator.windowStartOn/windowEndOn`. 주입이 없어 배치 기준상 `support/` 가 맞지만 컴파일 타임 `support → service` 방향이 생긴다. 런타임 빈 의존이 아니라 순환·트랜잭션 문제는 없다. **ArchUnit 규칙(GROMO-1662) 도입 시 이 방향을 예외로 명시할 것** |
| `auth/` 에 `repository/`·`domain/` 없음 | 인증은 `user` 도메인의 데이터를 쓴다. 자기 테이블이 없다 (다만 현재 user repository 를 직접 주입하고 있어 GROMO-1655 대상) |
| `GroupChallengeBetSessionRepository.recordFailure` 의 `@Transactional` | 리포지토리에서 트랜잭션을 여는 저장소 유일 사례. 호출부 `GroupBetScheduler.retryDueSessions` 가 **건별 격리를 위해 의도적으로 무트랜잭션**인 `@Scheduled` 진입점이라, 리포지토리가 자기 트랜잭션을 열지 않으면 정산 실패를 기록할 때마다 `InvalidDataAccessApiUsageException` 이 난다. 스케줄러가 이 호출을 감싸는 대안도 되지만, "벌크 UPDATE 는 자기 트랜잭션이 필요하다"는 것은 쿼리 자체의 속성이라 쿼리 옆에 선언적으로 두는 편이 발견 가능성이 높다 (GROMO-1655) |

---

## 6. 패키지를 옮길 때 — 컴파일러가 안 잡는 곳

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

## 7. 새 도메인을 만들 때

1. `com.oneorthree.phone.<domain>/` 아래에 **필요한 계층만** 만든다
2. 컨트롤러는 도메인 루트, 엔티티는 `repository/domain/`
3. 실패 응답이 필요하면 `exception/` 에 `<Domain>ErrorCode` + `<Domain>Exception`
   쌍을 만들고 `common/exception/GlobalExceptionHandler` 에 등록한다
   (공통 베이스 신설은 GROMO-1657 에서 다룬다)
4. 다른 도메인의 데이터가 필요하면 **그 도메인의 service 를 주입한다** — repository 가 아니라
5. `/back-endpoint` 스킬이 이 배치대로 골격을 잡아준다
