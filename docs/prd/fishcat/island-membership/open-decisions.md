# 섬 소속 — 남은 제품 결정 2건 (결정표)

> GROMO-1805 · 2026-09-18 · **결정표. 이 문서는 아무것도 확정하지 않는다.**
> [PRD](./prd.md) · [HLD](./high-level-design.md) · [LLD](./low-level-design.md) · [섬 관리 LLD §5](../island-management/low-level-design.md#5-이탈강퇴와-세션보상-결정-표) · [집중·휴식 policy](../focus-rest-session/policy.md)

## 0. 이 문서의 지위

소유자는 **재영님**이고 둘 다 제품 판단이다. 아래 표의 「추천」은 **근거를 붙인 제안**이지 채택된 규칙이 아니다.
PRD의 원칙을 그대로 따른다 — **미답은 승인으로 간주하지 않는다. 해당 정책이 없으면 그 분기를 활성화하지 않는다.**
([prd.md:71](./prd.md))

이 문서는 기존의 `IM-D01~D03` · `FR-D03` 표기를 **대체하지 않는다**. 그 ID들이 정본이고, 이 문서는 그 칸을
채우는 데 필요한 선택지·결과·선례를 한자리에 모은 **작업용 부록**이다.

| 미결 | 정본 ID가 적힌 곳 | 이 문서 |
|---|---|---|
| ① 초대 코드 형식·정규화·만료·재발급 | `IM-D01`~`IM-D03` — [prd.md:64~66](./prd.md) | [§1](#1-미결--초대-코드-im-d01d03) |
| ② 강퇴·탈퇴 × 진행 세션 · 미수령 보상 | `FR-D03` — [focus-rest-session/policy.md:51](../focus-rest-session/policy.md) · [관리 LLD §5](../island-management/low-level-design.md#5-이탈강퇴와-세션보상-결정-표) · [관리 HLD §3](../island-management/high-level-design.md) | [§2](#2-미결--강퇴탈퇴가-진행-세션과-미수령-보상에-미치는-영향-fr-d03) |

---

## 1. 미결 ① — 초대 코드 (IM-D01~D03)

### 1.1 지금 문서에 적힌 상태

| ID | 문서 | 적힌 내용 | 상태 |
|---|---|---|---|
| IM-D01 | [prd.md:64](./prd.md) | 코드 = 발급자별 active 초대의 **입력용 별칭** 추천. 기존 8자 참가코드 기능을 자동 복원하지 않음 | 사용자 결정 대기 |
| IM-D02 | [prd.md:65](./prd.md) | 재발급·폐기 수명은 **기존 링크 정책 유지**. 「사람이 입력하는 코드의 형식·시간 TTL은 별도 확정」 | 일부 기존 정본 / **새 값 대기** |
| IM-D03 | [prd.md:66](./prd.md) | 비공개 발견·초대자격만 주고 `approvalRequired`는 그대로 적용 추천. 정원·강퇴 이력은 어떤 경우에도 우회 안 함 | 사용자 결정 대기 |

구현을 막고 있는 자리도 문서에 명시돼 있다:

- [low-level-design.md:52](./low-level-design.md) — 「`InviteCode` … 구체 형식/대소문자 정규화/기간은 IM-D01~03 미정이다. 형식이 확정되기 전 샘플 `SODA`를 고정 길이4로 구현하지 않는다」
- [low-level-design.md:137](./low-level-design.md) (§3.10 invite-resolve) — 「정확 code 형식/TTL이 정해져야 **validator가 완성된다**. token 검증의 기술 TTL과 사용자 공유 code 수명을 혼동하지 않는다」
- [low-level-design.md:72](./low-level-design.md) — 이름 검색 vs 정확 코드 히트 분기는 「IM-D01의 코드/slug 관계 결정 **후 활성화**한다」
- [low-level-design.md:145](./low-level-design.md) (§3.11 invite) — 「새 코드 alias와 `expiresAt=null` 허용 정책은 IM-D01/02 확정 전 **가정하지 않는다**」

### 1.2 한 숫자로 합치면 안 되는 두 축

`invite-resolve`가 돌려주는 값은 **둘**이다 — 사람이 카톡으로 받아 눈으로 읽는 `code`와, 앱이 가입 명령에
실어 보내는 불투명 `invitationToken`. ([low-level-design.md:133~139](./low-level-design.md))

| 축 | 무엇의 수명인가 | 누가 본다 | 길면 생기는 위험 | 짧으면 생기는 비용 |
|---|---|---|---|---|
| **A. 코드 수명** | 공유된 `code`가 섬을 가리키는 기간 | 사람 (카톡·구두·손으로 받아적기) | 폐기 못 한 코드가 비공개 섬 자격으로 남음 | 「링크가 안 열려요」 — 초대가 상시 재발급 필요 |
| **B. token 기술 TTL** | `invitationToken` 서명의 유효 기간 | 앱만 (URL·로그에 복사 금지) | 탈취된 token의 사용 창이 넓어짐 | resolve→join 사이에 만료되면 정상 사용자가 실패 |

**B는 resolve 호출부터 join 커밋까지의 왕복만 덮으면 된다**(분 단위). **A는 초대라는 사회적 행위의 수명**
(시간~무기한)이다. 두 값을 하나로 쓰면 둘 중 하나는 반드시 잘못된 값이 된다.
`expiresAt`은 §3.11 응답에서 **A**를 가리킨다.

### 1.3 결정할 칸 — A1~A5

각 칸은 독립적으로 고를 수 있다. 「추천」은 제안이다.

#### A1. 코드 알파벳·길이 (IM-D01/D02)

| 선택지 | 결과 — 가능해지는 것 / 막히는 것 | 필요한 스키마·코드 |
|---|---|---|
| **A1-a. 기존 slug 알파벳 그대로 재사용** (31자 `23456789abcdefghjkmnpqrstuvwxyz`, 8자) | 코드 = slug 그 자체가 되어 IM-D01의 「별칭」 관계가 **1:1**로 단순해짐. 혼동 글자 문제가 **이미 해결돼 있음**. 대신 8자 소문자는 구두 전달이 길다 | 없음 — 생성기·컬럼 그대로 |
| **A1-b. 같은 알파벳, 더 짧게** (예: 6자, 31^6 ≈ 8.9×10^8) | 구두·수기 전달이 쉬워짐. 충돌 재시도 빈도가 올라가고 **무작위 훑기(enumeration) 표면이 넓어짐** — slug만 알면 그룹명이 노출된다는 게 `SecureRandom`을 쓰는 이유다 | 생성기 상수 1줄. **비공개 섬에서는 resolve 시도 rate-limit 필수** |
| **A1-c. 새 알파벳을 설계** (예: 대문자+숫자, Crockford Base32) | 기존 slug와 다른 문자공간이라 코드·slug를 **눈으로 구분** 가능 | 생성기 신설 + 두 공간을 모두 아는 resolve 분기 |
| **A1-d. 기존 8자 참가코드(`CHARS`) 부활** | 기존 `group_join_codes` 재사용 | **비추천** — 아래 선례 참조 |

**레포 선례 (파일·줄)**

- `server/data-api/src/main/java/com/oneorthree/phone/invitelink/support/SlugGenerator.java:19~20`
  ```java
  private static final String ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
  private static final int LENGTH = 8;
  ```
  같은 파일 javadoc(8~10행)이 이유를 못박아 뒀다 — 「알파벳에서 `0·1·o·l·i` 를 뺐다 — slug 는 카톡으로 받아
  눈으로 읽고 때로는 받아 적는 문자열이라, 서로 헷갈리는 글자가 섞이면 "링크가 안 열려요" 가 된다」.
  `SecureRandom`을 쓰는 이유도 「암호 강도가 필요해서가 아니라, 예측 가능한 난수면 남의 그룹 초대 링크를
  훑을 수 있기 때문」이라고 적혀 있다.
- `server/data-api/src/main/java/com/oneorthree/phone/group/service/GroupService.java:106~108` — **반대 선례**.
  ```java
  private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  ```
  36자 전부라 `0/O`·`1/I` 가 **모두 들어 있다**. 같은 파일 104~105행 javadoc: 「미사용 — 초대 링크(groupId)
  방식 전환으로 폐기(2026-07-31). 참가 코드 생성 전용 상수다」.
- `GroupService.java:912` — `@Deprecated private String generateUniqueCode()`, 바로 위 javadoc:
  「8자 참가 코드 생성 … createGroup 이 아직 호출하지만 발급된 코드를 조회하는 경로가 없다.
  CHARS/RANDOM 도 같이 dead 다」. (`createGroup`은 `:155`에서 여전히 호출한다.)
  `GroupJoinCode.java:29~31`은 더 직설적이다 — 「링크가 groupId 를 직접 담으므로 **8자 코드·3시간 만료
  개념 자체가 사라졌다**」.
- ⚠️ **새 알파벳을 고르면 걸리는 기존 검증식이 있다.**
  `server/data-api/src/main/java/com/oneorthree/phone/group/service/LinkMembershipEventService.java:87`
  ```java
  private static final Pattern LINK_SLUG = Pattern.compile("^[a-z0-9]{1,12}$");
  ```
  **소문자+숫자 1~12자만** 통과한다. **A1-c(대문자 포함 알파벳)를 고르면 이 패턴을 같이 고쳐야 하고**,
  고치지 않으면 멤버십 전이가 발행하는 `link.revoked` 명령 경로에서 새 코드가 거절된다.
  입력 DTO 쪽 제약은 길이뿐이다 — `invitelink/dto/ClaimInviteRequest.java:11`
  (`@NotBlank @Size(max = 12) String slug`).

> ⚠️ **문서 드리프트**: [low-level-design.md:19](./low-level-design.md)의 근거표는 이 메서드를
> `GroupService.java:859~864`로 적었지만 현재 main 기준 실제 위치는 **912행**이다. 859행 부근은 지금
> `noticeGrantedUserIds`다. 근거표의 줄 번호를 정정해야 한다.

**추천: A1-a(기존 31자 알파벳·8자 유지).** 혼동 글자 결정은 이 레포가 이미 한 번 내렸고, 그 근거가 코드
주석에 남아 있다. 같은 사용자·같은 전달 경로(카톡)에 두 번째 답을 만들 이유가 없다. 길이를 줄이는
A1-b는 **비공개 섬 resolve에 rate-limit이 들어간 뒤에** 별건으로 검토한다.

#### A2. 대소문자·공백 정규화 (IM-D02)

| 선택지 | 결과 | 필요한 코드 |
|---|---|---|
| **A2-a. 정규화 없음 (현행)** | 알파벳이 소문자 전용인데 iOS 키보드는 첫 글자를 대문자로 올린다 → 정상 코드가 404. 사용자에겐 「만료」와 구분되지 않는다 | 없음 (현행 유지) |
| **A2-b. 입력만 `strip()` + `toLowerCase(Locale.ROOT)` 후 조회** | 대소문자·앞뒤 공백 실수가 모두 흡수됨. 저장값·유일성 제약은 손대지 않음 | resolve 입력 검증에 2줄. `Locale.ROOT` 고정 필수 (터키어 `I`) |
| **A2-c. DB를 `citext`/함수 인덱스로 대소문자 무시** | 모든 조회 경로가 자동으로 덮임 | 마이그레이션 + 유일성 제약 재작성. A1-a에선 **이득 없음** (생성 알파벳이 소문자뿐이라 충돌 불가) |

**레포 선례 (파일·줄)**

- **정규화는 현재 어디에도 없다.** `server/data-api/.../invitelink/` 와 `server/business-api/` 전체에서
  slug에 `toLowerCase`/`trim`/`strip`을 적용하는 자리는 **0건**이다. 검색에 걸린 `toLowerCase` 호출은 전부
  다른 대상이다 — `LandingRenderer.java:212`(URL), `UserAgentClassifier.java:45,80`(User-Agent),
  `DriveLink.java:21`·`PublicAddressPolicy.java:31,37`(호스트). 즉 slug 조회는 **바이트 정확 일치**다.
  조회는 경로 변수를 그대로 넘긴다 — `invitelink/LinkPublicController.java:56~58` →
  `InviteLinkService.java:113` `inviteLinkRepository.findBySlug(slug)`.
- **DB도 대소문자를 구분한다.** `server/data-api/src/main/resources/db/migration/V21__group_invite_links.sql:11`
  ```sql
  slug        character varying(12) NOT NULL UNIQUE,
  ```
  기본 collation이고 `citext`·`lower()` 함수 인덱스가 없다. 즉 A2-a를 유지하면 대문자 입력은 **404**로
  떨어지고, 사용자에겐 「만료」와 구분되지 않는다.
- 정규화 자체의 선례는 인접 도메인에 있다 — `LinkCapabilityVerifier.java:83`이 `value.trim()`,
  `RequestIdempotencyKeys.java:58`이 `headerValue.trim()`으로 입력을 다듬는다. 새 패턴이 아니다.
- 확장 여지도 이미 잡혀 있다 — `GroupInviteLink.java:45~47`, slug 컬럼 주석: 「8자·혼동 문자 제외
  알파벳(`SlugGenerator`), **컬럼은 규칙 변경 여지로 12**」.

**추천: A2-b.** A1-a와 짝이면 저장 형태는 소문자 8자로 고정이므로, **입력만** 정규화하면 된다.
A2-c는 같은 효과를 마이그레이션으로 사는 것이라 이 조합에선 낭비다. 정규화 위치는 `InviteCode` value
object 안 **한 곳**이어야 한다 — 호출부마다 흩어지면 한 경로만 빠뜨린다.

#### A3. 코드 수명 = 축 A (IM-D02)

| 선택지 | 결과 — 가능/차단 | 필요한 스키마 |
|---|---|---|
| **A3-a. 무기한 + 사건 기반 폐기만** (기존 링크 정본과 동일) | 초대가 상시 유효 → 공유 UX가 가장 단순. 폐기는 **발급자 이탈·강퇴·그룹 종료**라는 사건으로만 일어난다. 대신 「시간이 지나면 알아서 닫힌다」는 안전망이 **없다** — 그리고 그 사건 기반 폐기조차 **아직 구현돼 있지 않다**(아래) | `expiresAt` 컬럼 불필요. §3.11의 `expiresAt:Instant?`는 `null`. **대신 폐기 구현이 선행 조건** |
| **A3-b. 유한 TTL + 만료 시 재발급** | 유출된 코드의 노출 창이 스스로 닫힘. 대신 「어제 받은 링크가 오늘 안 됨」이 상시 발생 | `expiresAt` 컬럼 신설 + 만료 판정 + 410 경로 |
| **A3-c. 공개 섬 무기한 / 비공개·승인제만 유한** | 위험이 실제로 있는 곳에만 비용을 지불 | A3-b와 같은 스키마 + `approvalRequired`·`isPrivate` 분기 |

**레포 선례 — 두 선례가 정반대다**

- **현행 초대 링크: TTL이 아예 없다.** `GroupInviteLink.java`의 전체 컬럼은
  `id`·`slug`·`groupId`·`inviterId`·`createdAt`·`updatedAt`뿐 — **`expiresAt` 필드가 존재하지 않는다**
  (`:41~63`). DDL도 같다(`V21__group_invite_links.sql:8~18`), 그리고 V21 이후 이 테이블을 건드린
  마이그레이션이 없다. 「만료」는 **저장된 상태가 아니라 파생 판정**이다 —
  `InviteLinkService.java:112~122` `resolveLanding`이 slug가 없거나 그룹이 죽었으면
  `LandingView.expired()`로 접고, 그룹 생존 판정은 `:164~167`
  `group.getDeletedAt() == null && group.getStatus() != GroupStatus.ENDED`다.
- **폐기(revocation)도 data-api DB 안에는 아직 없다.** `group_invite_links`에 `status`·`revoked_at`
  컬럼이 없고, 강퇴·탈퇴 경로가 이 테이블의 행을 지우거나 상태를 바꾸는 코드도 없다. 지금 있는 것은
  **외부 링크 서버로 나가는 outbox 명령 하나**뿐이다 —
  `group/service/LinkMembershipEventService.java:52` `EVENT_LINK_REVOKED = "link.revoked"`,
  발행은 `:102~121` `recordMembershipRevoked(GroupMember)`, 호출부는 `GroupMemberService.java:136,
  175, 184, 268, 289`. 문서도 같은 사실을 적어 뒀다:
  [link-attribution LLD:18](../link-attribution/low-level-design.md) — 「**지금 prod 에도 링크 폐기가
  없으므로** expand 기간이 현행보다 나빠지지는 않는다」, 그리고 `:14`·[HLD:198](../link-attribution/high-level-design.md)이
  「링크 폐기·재발급 **켬**」을 contract 단계로 미뤄 뒀다.
- **세대(epoch)는 이미 있다.** `GroupMember.java:125~128` `membership_epoch bigint NOT NULL DEFAULT 1`,
  javadoc `:115` 「멤버십 세대 … **탈퇴·강퇴·재가입에만** 오른다」 (스키마 `V52__satellite_core_contracts.sql:84~87`).
  `linkVersion`은 발급 시점에 epoch와 같은 값이고 「두 값이 갈리는 것은 폐기 명령뿐」이다
  (`internal/service/InternalInviteLinkService.java:94~95`). **A3-a의 사건 기반 폐기를 실제로 켤 재료는
  갖춰져 있다** — 빠진 것은 링크 쪽 상태축이다.
- **기존 링크 수명의 «정본»은 그룹 획득 문서다.**
  [gromo/group/features/01-acquisition/high-level-design.md:81~86](../../gromo/group/features/01-acquisition/high-level-design.md):
  「발급자 탈퇴·강퇴·계정 탈퇴 → 해당 그룹에서 발급한 active 링크를 멤버십 전이와 함께 **논리 폐기**」 ·
  「발급자 재가입 뒤 발급 → 폐기된 slug는 **부활하지 않고** 새 버전의 slug 발급」 ·
  「그룹 종료 → 그룹의 모든 링크를 만료로 취급」. IM-D02의 「기존 링크 정책 유지」가 가리키는 것이 이 표다.
- 설정에 있는 유일한 시간창은 **링크 TTL이 아니다** — `LINK_MATCH_WINDOW_HOURS`(기본 3)는 설치
  어트리뷰션의 클릭 매치 창이다(`InviteLinkMatchService.java:90`). A3의 값으로 오해하면 안 된다.
- **폐기된 참가 코드: 3시간 TTL이 있었다.** `GroupJoinCode.java:74~78`
  ```java
  public void renew(String newCode) {
      this.code = newCode;
      this.status = GroupJoinCodeStatus.ACTIVE;
      this.expiresAt = Instant.now().plus(3, ChronoUnit.HOURS);
  }
  ```
  같은 파일 `:80~86` `expire()`는 **상태만** `ENDED`로 바꾸고 `expiresAt`은 손대지 않는다 — javadoc이
  「만료 시각으로 중지 여부를 판단하면 안 되는 이유다」라고 적어 뒀다. **상태축과 시간축을 분리하라**는
  선례다. 이 3h는 [low-level-design.md:20](./low-level-design.md)이 이미 「**옛 코드 사실**이지 새 초대 TTL
  확정값 아님」이라고 못박아 뒀다.
- **재사용 불가 선례**: `GroupService.java:926~928` 주석 — 「code 는 NOT NULL UNIQUE 라 구 스키마처럼
  null 로 비워 재사용하지 않는다. 즉 한 번 발급된 코드 문자열은 **영구히 재발급되지 않음**(36^8 공간이라
  고갈 우려 없음)」. A1-a(31^8 ≈ 8.5×10^11)도 같은 정책을 감당한다.

**추천: A3-a**(무기한 + 사건 기반 폐기), **단 «폐기 구현」이 같은 출시에 들어간다는 조건**으로.
「무기한」의 실질 위험은 **비공개 섬 자격**에 한정되고, 공개 섬 코드는 유출돼도 누구나 검색으로 찾을 수
있는 정보만 연다. 그리고 A3-a는 **새 스키마가 0**이 아니다 — 위에서 본 대로 폐기 상태축이 아직
없으므로, A3-a를 고르는 것은 「TTL 컬럼 대신 **status 컬럼**을 만든다」는 뜻이다. 그 상태축은
link-attribution contract 단계가 어차피 만든다.

**A3-b(유한 TTL)를 굳이 피하는 이유**: 시간 만료는 사건 기반 폐기를 **대체하지 못한다**. 강퇴당한
발급자의 코드는 TTL이 남아 있는 동안 여전히 유효하기 때문이다. 즉 A3-b를 골라도 폐기는 따로
구현해야 하고, 그러면 **두 축을 다 유지**하게 된다 — 가장 비싼 조합이다.

**A3-c(비공개만 TTL)는 A5-b를 고를 때만 의미가 있다.** 승인이 유지되면(A5-a) 코드 유출이 곧 가입이
아니므로 비공개 섬에도 추가 TTL이 필요 없다. **A3과 A5는 묶어서 봐야 한다.**

#### A4. token 기술 TTL = 축 B (IM-D02)

| 선택지 | 결과 | 비고 |
|---|---|---|
| **A4-a. 분 단위 단명 (예: 5~10분)** | resolve→join 왕복만 덮음. 탈취 창 최소 | 앱이 resolve 후 사용자를 오래 멈춰 세우면 만료 → **join 실패 시 재-resolve** UX 필요 |
| **A4-b. 시간 단위** | 화면을 오래 열어 둬도 안전 | 탈취 창이 넓어짐 |
| **A4-c. TTL 없음 — Data TX 재검증에만 의존** | 가장 단순 | **비추천** — token이 사실상 두 번째 무기한 자격이 된다 |

**레포 선례**: **근거 없음.** 새 `invitationToken`의 서명 체계는 아직 구현돼 있지 않다. 문서는
[low-level-design.md:135](./low-level-design.md)에서 「기존 링크 아키텍처의 **서명 자격을 재사용**한다 …
구체 서명 format/audience/linkVersion 규칙은 내부 링크 계약과 일치시켜 **중복 서명 체계를 만들지
않는다**」고만 정해 뒀다. 즉 **A4는 링크 계약의 기존 서명 TTL을 조사해 그 값에 맞추는 것이 먼저**이고,
이 결정표가 새 숫자를 발명할 자리가 아니다.

**추천: A4-a에 가깝게, 단 값은 내부 링크 계약의 기존 서명 TTL을 확인한 뒤 맞춘다.** 어느 값이든
[low-level-design.md:119](./low-level-design.md)의 요구는 그대로다 — 「Business의 사전 resolve 성공과 신청
당시 유효성만으로 승인하지 않는다」, 즉 **커밋 직전 Data TX 재검증이 정본이고 TTL은 보조**다.

#### A5. 재발급·재사용, 그리고 승인 우회 (IM-D02/D03)

| 선택지 | 결과 — 가능/차단 | 필요한 스키마·코드 |
|---|---|---|
| **A5-a. 1인 1코드 재사용 + 승인 유지** (현행 링크 + IM-D03 추천) | 반복 발급이 같은 코드를 돌려줌 → 어트리뷰션이 한 줄기. 코드는 **비공개 발견 + 초대 자격**만 주고, `approvalRequired`면 여전히 방장 승인 | 없음 — `uq_invite_links_group_inviter` 그대로 |
| **A5-b. 1인 1코드 재사용 + 승인 우회** | 초대받은 사람은 바로 입도 → 초대 UX가 가장 매끄러움. 대신 **코드 하나가 무제한 입장권**이 됨 — 코드가 단톡방에 붙는 순간 정원까지 채워진다 | `admissionSource=invitation` 분기 + 정원 경합 강화 |
| **A5-c. 1회용 코드** (사용 시 소진) | 유출돼도 1명. 승인 우회를 해도 피해가 한정 | 코드에 **사용 상태**축 신설. 발급 멱등성이 깨짐(누를 때마다 새 코드) → 어트리뷰션이 여러 줄기로 쪼개짐 |

**레포 선례 (파일·줄)**

- **재사용이 현행이자 의도된 설계다.** `InviteLinkService.java:69~81`, 메서드 javadoc: 「(그룹, 초대자)당
  링크 1개를 발급하거나 이미 있는 것을 그대로 돌려준다 — **멱등**이다 … 재호출해도 같은 값이다」.
  본문 `:78~81`:
  ```java
  Optional<GroupInviteLink> existing = inviteLinkRepository.findByGroupIdAndInviterId(groupId, userId);
  if (existing.isPresent()) {
      return toResponse(existing.get());
  }
  ```
  이유는 `GroupInviteLink.java:26~27` javadoc에 있다 — 「같은 사람이 같은 방을 여러 번 공유해도 링크는
  하나여야 **어트리뷰션이 한 줄기로 모인다**」. **A5-c는 이 속성을 깬다** — 그게 A5-c의 진짜 비용이다.
  최후 방어선은 DB 제약이다: `V21__group_invite_links.sql:17`
  `CONSTRAINT uq_invite_links_group_inviter UNIQUE (group_id, inviter_id)` — A5-c를 고르면 **이 제약을
  걷어내야** 하고, 그 순간 link-attribution의 expand 롤백 안전성 근거([LLD:18](../link-attribution/low-level-design.md))도
  같이 흔들린다. 충돌 재시도는 5회다(`InviteLinkService.java:44` `MAX_SLUG_ATTEMPTS = 5`,
  소진 시 `:177` `SLUG_GENERATION_FAILED`).
- **`approval_required`는 이미 스키마에 있다.**
  `server/data-api/src/main/resources/db/migration/V57__user_island_context.sql:38`
  ```sql
  ALTER TABLE groups ADD COLUMN approval_required boolean NOT NULL DEFAULT false;
  ```
  (`schema.dbml:736` · `Group.java:78~81`. 기존 행은 전부 `false` = 즉시가입.) **A5-a는 새 스키마가 0이다.**
- **우회 금지선은 이미 문서에 있다.** [low-level-design.md:109](./low-level-design.md) — 「유효 초대가
  있어도 **강퇴 이력·정원·계정 상한·계정 활성을 우회하지 않는다**」. A5-b를 골라도 이 네 가지는 그대로다.
- **A5-a를 고르면 증거 스키마가 따라온다.** [low-level-design.md:117](./low-level-design.md)이 이미
  설계해 뒀다 — `JoinRequest`에 `admissionSource=invitation`과 불변 `invitationEvidenceRef`
  (`slug, groupId, inviterId, membershipEpoch, expiresAt` + `claimId`)를 보존하고, 「외부 DTO·요청
  이벤트·로그·분석 payload에 원문 token/capability/slug/발급자 정보를 복사하지 않는다」.

**추천: A5-a.** 새 스키마 0, 기존 멱등 발급·어트리뷰션 속성 보존, 유출 코드의 최악값이 「승인 대기 줄이
길어진다」로 제한된다. A5-b를 고른다면 **A3-c(비공개 섬 TTL)를 함께 켜야** 무기한 무제한 입장권이 되지
않는다 — 이 둘은 묶인 결정이다.

### 1.4 결정 전에 알아야 할 사실 — 기존 초대 링크는 전부 폐기된다

[link-attribution LLD:22](../link-attribution/low-level-design.md) contract 단계 ①:

> 기존 ACTIVE 초대 링크를 **전부** 폐기로 확정한다(재가입 이력을 증명할 수 없다).

이유는 같은 문서 `:39`에 있다 — 재가입 시각 컬럼이 없고 링크에 발급 당시 `membership_epoch`가 기록돼
있지 않아 「이탈 전에 공유된 slug」를 가려낼 수 없다. 그래서 `REVOKED (BACKFILL_UNPROVABLE)`로 일괄
확정하고, 이미 공유된 초대 링크는 **모두 만료된다**. 이 단계는 `:41` 「**roll-forward 전용**」이다.

**이 결정에 주는 함의**: 새 코드 형식이 기존 slug와 호환될 필요가 **없다**. 운영 중인 slug 집합을
보존해야 한다는 제약이 사라지므로, A1은 순수하게 UX·보안으로만 고르면 된다. (동시에, A1-a로
알파벳을 그대로 쓰더라도 「옛 코드가 새 체계에서 되살아난다」는 걱정은 없다.)

---

## 2. 미결 ② — 강퇴·탈퇴가 진행 세션과 미수령 보상에 미치는 영향 (FR-D03)

### 2.1 지금 문서에 적힌 상태

| 문서 | 줄 | 적힌 내용 |
|---|---|---|
| [focus-rest-session/policy.md](../focus-rest-session/policy.md) | 51 | `FR-D03` — 「진행/휴식 중 강퇴·섬 종료 시 세션과 미수령 보상은?」 · 추천: 서버 시각 강제 종료 + 개인 확정 보상 보존 · 「정책 없는 강퇴가 세션을 `CANCELED`로 버리거나 임의 정산하지 않도록 **해당 교차 기능 출시 차단**」 |
| [관리 LLD §5](../island-management/low-level-design.md) | 121 | 「강퇴 + active/paused」 → **정책 대기**. 서버 시각의 원자 종료 + 개인 확정 보상 보존 추천, **임의 산식 적용 금지** |
| 같은 표 | 122 | 「미수령 퀘스트 공동 보상」 → **정책 대기**. 회차 자격 기준/분모/중도 이탈을 **퀘스트 정본에서** 확정 |
| 같은 표 | 120 | 「강퇴 + 완료 집중/개인 확정 보상」 → **이미 결론 있음**: 강퇴는 계정 삭제가 아니므로 개인 완료 기록·자산·확정 원장 유지 |
| [관리 HLD](../island-management/high-level-design.md) | 48 | 「정책 없이 `cancel()`을 호출해 집중 시간을 버리거나 임의 보상을 지급하지 않는다」 |
| [관리 PRD](../island-management/prd.md) | 42 (G06) | 「개인/공동 재화 및 미수령 보상을 이 문서가 임의 소각·환불·승계하지 않음」 |

즉 **결정은 하나가 아니라 둘**이다 — (B) 세션을 어떻게 끝낼 것인가, (C) 미수령 **공동** 보상을 어떻게
할 것인가. C는 퀘스트 정본 소관으로 이미 넘겨져 있다.

### 2.2 코드에 이미 있는 막다른 길

**머지된 GROMO-1764**가 집중 세션 전이에 섬 멤버십을 요구하면서, 탈출구 없는 상태를 코드에 만들어 놨다.

1. **전이 3종이 멤버십을 요구한다.**
   `server/data-api/src/main/java/com/oneorthree/phone/internal/service/FocusSessionLifecycleService.java:489~505`
   ```java
   private FocusSessionDetail authorizeSession(UUID userId, UUID sessionId) {
       ...
       Group island = groupQueryService.getGroup(detail.getIslandId());
       if (groupQueryService.findMembership(user, island).isEmpty()) {
           throw new FocusException(FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
       }
   ```
   `pause`(`:245`)·`resume`(`:299`)·`finish`(`:355`)가 전부 이 메서드를 거친다.

2. **여기서 자동 종결하지 않는 것은 «의도»다.** 같은 파일 `:483~487` javadoc:
   > **거절만 한다.** 소속을 잃은 진행 세션을 여기서 자동 종결하지 않는다 — 진행 중 기록을 어떻게
   > 처리할지는 FR-D03(소속 상실 복구)의 미결 제품 결정이고 … 세션은 그대로 두고 전이만 막는다.

3. **강퇴·탈퇴는 세션을 건드리지 않는다.**
   `server/data-api/src/main/java/com/oneorthree/phone/group/service/GroupMemberService.java` —
   `kickMember`(`:101`)·`withdrawGroup`(`:153`)·`detachWithdrawnUser`(`:254`). 이 파일 **312줄 전체에
   `focus`/`Focus` 문자열이 0건**이다(grep 종료코드 1로 확인). 관리 LLD `:13`도 같은 사실을 적어 뒀다 —
   「OWNER 전용, 자기 강퇴 불가, KICKED 마킹, 내기 판돈 유지 / 새 집중·퀘스트 보상 정책까지 구현됐다고
   보지 않음」.

4. **자동 정리도 이 경우엔 돌지 않는다.** `abandonIfMarkerClosed`(`:527~543`)는 **레거시 기본 마커가
   바깥에서 닫혔을 때만** `ABANDONED`로 내린다. 강퇴는 마커를 닫지 않으므로 해당 없음.

5. **그래서 새 세션도 못 연다.** `start`(`:155~157`)가 열린 기본 마커를 보고
   `FocusErrorCode.SESSION_IN_PROGRESS`를 던진다.

이 사각지대는 `FocusSessionStartGate.java`의 선행 조건 목록 **7번 항목**에 그대로 적혀 있다:

> **멤버십을 잃은 진행 세션의 «탈출 경로»를 만든다.** 이 티켓이 전이에 멤버십을 요구하면서 생긴
> 사각지대다 … `start`의 `SESSION_IN_PROGRESS`에 영원히 걸려 **새 세션도 못 연다**. 가드를 넣으면서
> 탈출구를 같이 막은 것이라, 여는 날 «소속 상실 시 세션을 종결하는 경로»를 함께 정해야 한다
> (자동 종결이 맞는지는 **제품 결정이라 이 티켓에서 고르지 않았다**).

> **정확히 해 둘 것 — 지금 당장 갇힌 사용자는 없다.** `start`의 **첫 줄**이
> `FocusSessionStartGate.isOpen()` 검사이고(`:139~141`, 닫히면 `SESSION_START_UNAVAILABLE`),
> `FocusSessionStartGate.isOpen()`은 항상 `false`를 반환한다. v0.3 세션을 시작할 수 없으니 갇힐
> `PAUSED` 상세도 아직 생기지 않는다. 이 막다른 길은 **잠재적**이며, 게이트를 여는 **GROMO-1924**가
> 그날 현실이 된다. 바꿔 말해 **이 결정이 GROMO-1924의 선행 조건**이다.

### 2.3 결정할 칸 — B1~B3 (세션 축)

세 선택지 모두 「강퇴·탈퇴 TX가 `focus_sessions`를 **어떻게든** 건드려야 한다」는 점은 같다. 지금처럼
아무것도 안 하는 것은 게이트를 연 뒤엔 선택지가 아니다.

| | **B1. 자동 종결** | **B2. 유예 — 전이만 허용** | **B3. 종결하되 보상은 보존** |
|---|---|---|---|
| **무엇을 하나** | 강퇴·탈퇴 TX가 같은 잠금 아래 진행 세션을 서버 시각으로 원자 종료 | 세션은 살려 두고, 소속을 잃은 사용자에게 `finish`(또는 `finish`만) 를 예외적으로 허용 | B1처럼 종결하되 종결 시점까지의 **개인 확정 보상은 지급·보존** |
| **가능해지는 것** | 강퇴 즉시 상태가 깨끗해짐. 라이브 랭킹·프레즌스·rest 투영이 자동 정합 | 사용자가 자기 집중 시간을 **스스로** 마무리 — 기록 손실 0 | B1의 정합 + 「강퇴당해서 30분을 날렸다」가 없음 |
| **막히는 것 / 위험** | **집중 시간이 사라진다.** 관리 HLD `:48`이 금지한 「정책 없이 `cancel()`」에 가장 가까움. 산식을 정하지 않으면 그대로 소각 | 비소속자가 자기 세션을 계속 전이시킴 → `focus.member.updated`·`rest.member.updated` 방송으로 **비소속자가 섬 화면에 뜬다**(`:481~483`이 멤버십 검사를 넣은 바로 그 이유) | 「개인 확정 보상」의 **산식**을 정해야 함. 공동 회차 기여는 여전히 미결(C축) |
| **`FocusSessionLifecycleService`의 어느 경로가 바뀌나** | **바뀌지 않는다** — `authorizeSession`(`:489`)은 거절만 하면 되고 상세는 이미 종결 상태다. 대신 **`GroupMemberService.kickMember`(`:101`)·`withdrawGroup`(`:153`)에 종결 호출이 새로 생긴다.** `abandonIfMarkerClosed`(`:527`)와 겹치지 않게 별도 lifecycle 값 필요 | **`authorizeSession`(`:489~505`)의 멤버십 검사에 예외 분기**를 판다 — 「멤버십 없음 + 요청이 `finish`」면 통과. `finish`(`:355`)만 우회시키고 `pause`·`resume`은 그대로 거절. **방송 경로(`appendFocusMemberEvent` `:575` / `appendRestMemberEvent` `:590`)를 이 경우 타지 않게** 같이 막아야 함 | B1과 같은 자리(`GroupMemberService` → 종결) + **종결 TX가 보상 원장에 확정 기록**을 남김. `finish`(`:355~390`)의 정산 경로를 종결 쪽에서 재사용할 수 있는지 확인 필요 |
| **필요한 스키마** | 종결 사유를 구분할 lifecycle/사유 컬럼(예: `MEMBERSHIP_LOST`) — `ABANDONED`와 섞으면 원인 추적 불가 | 없음 | B1 + 보상 원장 기록 |
| **관리 LLD §5 표와의 관계** | `:121` 추천안의 「원자 종료」 부분 | 표에 없는 선택지 | **`:121` 추천안 그 자체** (「서버 시각의 원자 종료 + 개인 확정 보상 보존」) |

**레포 선례 (파일·줄)**

- **원자 종료를 넣을 자리는 이미 잠금이 잡혀 있다.** `GroupMemberService`는 `membershipLocks`(`:47`)로
  멤버십 변경을 직렬화하고, `lockOpenBetSessionsForAccountWithdrawal`(`:216`)·
  `lockGroupsForAccountWithdrawal`(`:199`)처럼 **탈퇴 시 다른 도메인을 같은 TX에서 잠그는 선례**가
  이미 있다. 집중 세션도 같은 모양으로 붙일 수 있다.
- **「개인 확정은 보존, 공동은 미결」은 이 레포의 기존 패턴이다.** 관리 PRD `:29` — 「자진 탈퇴는 OPEN
  참가 해제·환불/정리, 강퇴는 판돈을 임의 변경하지 않는 기존 동작」. 관리 LLD `:127` — 강퇴 + 기존 내기
  판돈은 「기존 정산/환불 엔진에 맡김. 새 퀘스트로 변환 금지」.
- **자진 탈퇴 쪽은 이미 방향이 정해져 있다.** 관리 LLD `:116~117` — 「자진 탈퇴 + active 집중」과
  「자진 탈퇴 + paused 휴식」은 **가드로 거절**(종료 확인 후 재시도)이지 종결이 아니다. 즉
  **B1~B3는 실질적으로 「강퇴·비자발 상실」 전용 결정**이고, 자진 탈퇴는 「먼저 끝내고 나가라」로 이미
  갈렸다. (본인이 `finish`를 부를 수 있으므로 막다른 길이 생기지 않는다.)

**추천: B3.** 이유 셋.
① 관리 LLD `:121`·focus policy `:51`이 이미 같은 방향을 추천해 뒀다 — 새 방향을 만들면 두 문서를 다시
  고쳐야 한다.
② B2는 `authorizeSession`에 예외를 파는데, 그 메서드가 멤버십을 검사하는 **유일한 이유**가 비소속자
  방송 차단(`:481~483`)이다. 예외를 파는 순간 그 이유를 스스로 되돌린다.
③ B1은 관리 HLD `:48`이 명시적으로 경계한 「집중 시간을 버리는」 결과다.
**단, B3는 「개인 확정 보상 산식」이 정해져야 실행 가능하다** — 그 산식이 이 결정의 실제 미결이다.
산식 없이 B3를 채택하면 관리 LLD `:121`의 「임의 산식 적용 금지」에 걸린다.

### 2.4 C축 — 미수령 공동 보상 (분리해서 결정)

관리 LLD `:122`가 이미 **퀘스트 정본으로 넘겨** 놨다: 「회차 자격 기준/분모/중도 이탈을 퀘스트 정본에서
확정」. `docs/prd/fishcat/island-quests/`가 그 자리다.

| 선택지 | 결과 |
|---|---|
| **C-a. 회차 기여는 남기고 보상 자격만 상실** | 남은 주민의 분모가 그대로 → 회차가 깨지지 않음. 강퇴당한 사람은 자기 기여로 남을 도움 |
| **C-b. 기여를 회수하고 분모 재계산** | 「강퇴로 회차가 후퇴」 — 남은 주민이 손해. 진행 중 회차에 경합 발생 |
| **C-c. 기여 유지 + 보상 지분을 미수령으로 보존했다 재가입 시 지급** | 가장 관대. **강퇴자가 재가입으로 권한을 회복하는 자동 예외**를 만들지 않는지 확인 필요 |

**레포 선례**: **근거 없음.** 퀘스트 회차의 자격·분모 모델이 아직 문서·코드 어디에도 없다. 이 칸은
퀘스트 정본이 생긴 뒤에 채우는 것이 맞고, **여기서 고르면 존재하지 않는 도메인의 규칙을 발명하는
것**이다. 다만 경계 하나는 이미 있다 — [permissions.md:47](../island-management/permissions.md):
「강퇴자가 다시 가입해 권한을 회복하는 **자동 예외를 만들지 않는다**」. C-c는 이 줄과 충돌하지 않는지
먼저 검토해야 한다.

**추천: 이번 결정에서 C를 분리해 «퀘스트 정본 대기»로 남긴다.** B축(세션)은 GROMO-1924를 막고 있어
급하지만, C축은 퀘스트 기능 자체가 출시 전이라 지금 결정할 실익이 없다. 관리 PRD `:42`의 G06
(「임의 소각·환불·승계하지 않음」)이 그동안의 안전 기본값 역할을 한다.

---

## 3. 막고 있는 티켓과 지연 비용

| 미결 | 막고 있는 티켓 | 무엇이 못 나가나 | 지연 비용 |
|---|---|---|---|
| ① IM-D01~D03 | **GROMO-1760** — 「섬 가입 요청·초대 코드 API 구현 — 5종」 (`해야 할 일`) | `join` · `join-status` · `join-cancel` · `invite-resolve` · `invite` ([prd.md:20~24](./prd.md)) | 5종 중 `invite-resolve`·`invite`는 **코드 형식 없이는 validator를 못 만든다**([LLD:137](./low-level-design.md)). 나머지 3종도 `admissionSource`/증거 스키마가 IM-D03에 묶여 있어 join 경로를 절반만 짜게 된다. 지금 착수하면 **형식 확정 후 재작업**이 계약 테스트까지 번진다 |
| ② FR-D03 (B축) | **GROMO-1802** — 「섬 관리·주민 API 잔여 6종 — 정보 수정·주민 목록·가입 승인·강퇴·탈퇴」 (`해야 할 일`) | `DELETE /islands/{id}/members/{userId}`(강퇴) · `DELETE /islands/{id}/memberships/me`(탈퇴) 포함 6종 | 1802의 완료 조건에 **「강퇴·탈퇴의 진행 중 집중 세션·미수령 보상 처리가 확정된 정책대로 동작한다」**가 그대로 들어 있다 — 정책 없이는 그 칸을 만족시킬 수 없다 |
| ② FR-D03 (B축) | **GROMO-1924** (게이트 개방) | v0.3 집중 세션 `start` 경로 전체 | `FocusSessionStartGate` 선행 조건 7번이 이 결정이다. **결정 없이 게이트를 열면 §2.2의 막다른 길이 실제 사용자에게 발생한다** — 강퇴당한 사용자가 집중을 영영 시작하지 못한다 |

**추가 비용 — 결정이 늦을수록 커지는 쪽**: 관리 HLD `:62`가 「문서 리뷰 통과나 골격 구현이 공용 권한
확정·강퇴 보상 정책 확정을 뜻하지 않는다」고 못박아 둔 대로, 두 미결은 **문서를 더 써서 줄어들지
않는다**. 1760·1802는 둘 다 `해야 할 일` 상태이므로 지금은 **재작업 비용이 0**이다 — 착수 후에 결정이
바뀌면 그때부터 비용이 붙는다.

---

## 4. 근거를 찾지 못한 것 (「근거 없음」)

지어내지 않고 그대로 남긴다.

| 항목 | 상태 |
|---|---|
| 새 `invitationToken`의 서명 format·audience·기술 TTL (A4) | **근거 없음** — 구현이 없고, [LLD:135](./low-level-design.md)가 「내부 링크 계약과 일치시킨다」고만 적었다. 링크 계약의 기존 서명 TTL을 먼저 조사해야 값을 고를 수 있다 |
| 퀘스트 회차의 자격 기준·분모·중도 이탈 모델 (C축) | **근거 없음** — 도메인 문서·코드 모두 부재. 관리 LLD `:122`가 퀘스트 정본으로 위임 |
| 「개인 확정 보상」의 구체 산식 (B3 실행에 필요) | **근거 없음** — 관리 LLD `:121`이 「임의 산식 적용 금지」라고만 하고 산식을 정의하지 않는다 |
| 코드 resolve의 rate-limit / 무작위 훑기 방어 | **근거 없음** — `SlugGenerator` javadoc이 훑기 위험을 인지하고 `SecureRandom`으로 대응했을 뿐, 시도 횟수 제한은 레포에 없다. A1-b(짧은 코드)를 고르면 필수 |
| 기존 `group_join_codes` 행의 처리(정리/유지) | **근거 없음** — 새 체계 전환 시 옛 테이블을 어떻게 할지 적힌 문서를 찾지 못했다 |
| slug lookup의 대소문자·공백 정규화 | **근거 없음 = 구현이 0건**. 어느 경로에도 없고 DB도 case-sensitive다(`V21:11`). 「없다」가 확인된 사실이므로 A2는 **값을 고르는** 결정이 아니라 **없는 것을 넣을지** 정하는 결정이다 |
| data-api DB 안의 초대 링크 폐기(REVOKE/삭제) 구현 | **근거 없음 = 구현이 0건**. outbox `link.revoked` 명령 발행까지만 있고 로컬 테이블에 상태축이 없다. A3 어느 쪽을 골라도 이 구현이 따라온다 |
| business-api 쪽 slug 생성·정규화 | **근거 없음** — business-api는 프록시 컨트롤러 + DTO만 보유(`InviteLinkController.java:43~72`). 정규화를 넣는다면 자리는 data-api의 `InviteCode` value object다 |

---

## 5. 결정 기입란

재영님이 고른 값을 여기에 적고, 그때 정본 문서(`prd.md`의 IM-D01~03 행 · `focus-rest-session/policy.md`의
FR-D03 행 · 관리 LLD §5의 두 「정책 대기」 행)를 **같이** 갱신한다.

| 칸 | 결정 | 결정일 |
|---|---|---|
| A1 알파벳·길이 | ☐ 미정 | |
| A2 정규화 | ☐ 미정 | |
| A3 코드 수명(축 A) | ☐ 미정 | |
| A4 token TTL(축 B) | ☐ 미정 | |
| A5 재발급·재사용 / 승인 우회 | ☐ 미정 | |
| B 강퇴 시 진행 세션 | ☐ 미정 | |
| C 미수령 공동 보상 | ☐ 퀘스트 정본 대기 | |

**미답은 승인으로 간주하지 않는다.** 위 칸이 비어 있는 동안 GROMO-1760·1802·1924의 해당 분기를
활성화하지 않는다.
