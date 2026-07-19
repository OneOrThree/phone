---
description: spec md를 읽어 빈 골격 파일을 생성한다 — 코드는 절대 작성하지 않고 주석 가이드라인만
argument-hint: "<spec 파일명, e.g. bfeat-group-read>"
allowed-tools: Bash, Read, Edit, Write
---

`back/docs/skeleton/$ARGUMENTS.md` 를 읽고 거기에 명시된 파일 목록대로 골격을 생성한다.

## 생성 규칙

**Java 파일 (Controller · Service · Repository · DTO · Entity · Enum · Exception)**
- 다음은 작성한다:
  - 패키지 선언
  - 클래스/인터페이스/enum 타입에 맞는 어노테이션 (`@Entity`, `@Getter`, `@Builder` 등)
  - 상속/구현 관계 (`extends JpaRepository<Foo, UUID>`, `extends RuntimeException` 등)
  - 기존 파일에서 패턴을 읽어 맞춘다
- 다음은 작성하지 않는다: 필드, 메서드 본문, 생성자, enum 값
- 클래스 본문에 `// TODO <티켓>:` 주석으로 해야 할 일 목록만 적는다:
  - 필요한 필드 이름과 타입 (참고할 기존 파일 포함)
  - 필요한 메서드 시그니처 (매개변수, 반환타입)
  - 주의사항 (nullable 여부, 권한 체크 순서 등)
- 주석 안에도 실제 동작하는 코드 조각을 넣지 않는다.

### 타입별 껍데기 형태

**Entity** — GroupMember.java 패턴 참고:
```java
@Entity @Table(name = "foo") @Getter @Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED) @AllArgsConstructor
public class Foo {
    // TODO: PK는 @Id @GeneratedUuidV7 UUID id (common/id — 프로젝트 UUID v7 규칙)
    // TODO: 필드 목록
}
```

**Repository** — GroupMemberRepository.java 패턴 참고:
```java
public interface FooRepository extends JpaRepository<Foo, UUID> {
    // TODO: 메서드 목록
}
```

**DTO (응답)** — GroupSummaryResponse.java 패턴 참고:
```java
@Getter @Builder
public class FooResponse {
    // TODO: 필드 목록
}
```

**Enum**:
```java
public enum FooStatus {
    // TODO: 값 목록
}
```

**Service** — GroupService.java 패턴 참고:
```java
@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class FooService {
    // TODO: 필드(repository 주입) 목록
    // TODO: 메서드 목록
}
```

**migration SQL 파일 (Flyway)**
- 완성 코드로 작성한다 (골격 아님 — DDL은 TODO로 미룰 수 없다).
- `back/src/main/resources/db/migration/V<N+1>__<desc>.sql` — 버전은 기존 파일의
  **숫자 max+1** (사전순 정렬 금지: `V9`가 `V15`보다 뒤에 온다).
- 최근 `V<N>__*.sql` 스타일을 따른다: 한국어 헤더 주석(`-- GROMO-####: ...`) + forward DDL.
- 이미 적용된 마이그레이션은 절대 수정하지 않는다 (Flyway 체크섬).

**기존 파일 수정이 필요한 경우**
- 해당 파일을 Read 한 뒤, 수정할 위치에 `// TODO <티켓>:` 주석만 추가한다.
- 기존 코드는 건드리지 않는다.

## spec md 형식

```markdown
# <브랜치명 또는 기능명>

## 커밋 순서
1. GROMO-XXX: <한 줄 설명>
2. ...

## GROMO-XXX: <티켓 제목>

### 신규 파일
- `domain/group/Foo.java` — <목적>
- `service/dto/group/FooResponse.java` — <목적>

### 기존 파일 수정
- `exception/GroupErrorCode.java` — FOO_ERROR 추가
- `service/GroupService.java` — fooMethod() 추가

### migration
- `src/main/resources/db/migration/V<N+1>__create_foo.sql` — foo 테이블 생성

## GROMO-YYY: ...
```

---

spec md가 없으면 생성을 중단하고 먼저 논의해서 spec을 작성하라고 안내한다.
