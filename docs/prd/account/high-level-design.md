# 계정·설정 — HLD

GROMO-1756 · [정책](policy.md) · [상세 설계](low-level-design.md)

## 쉽게 보는 구조

Business는 입구에서 신분증을 확인하고 앱이 쓰는 모양으로 답한다. Data는 계정 장부와 세션 장부를 잠근 뒤 변경한다. 알림 서버는 알림 선호를 보관한다. 계정을 지울 때 장부를 여러 서버에 나눠서 조금씩 고치지 않는다. Data에서 함께 바뀌어야 하는 항목을 한 번에 확정하고, 다른 서버에 전달할 일도 같은 순간 outbox에 기록한다.

```mermaid
flowchart LR
    App[앱] -->|공개 7개 계약| B[Business API]
    Provider[기존 소셜 제공자] -->|검증한 제공자 주체| B
    B -->|내부 인증과 검증한 사용자 위임| D[Data API]
    D --> DB[(계정·세션·명령·outbox DB)]
    B -->|설정 조회·부분 명령 전달| N[알림 서버]
    N --> NDB[(알림 선호·필드별 적용 버전)]
    DB --> Relay[outbox relay]
    Relay -->|설정 변경·탈퇴| N
    Relay -->|탈퇴·표시정보 정리| L[링크 등 위성 서비스]
    Relay -->|user.withdrawn 내구 전달| C[chat/realtime]
    C --> CDB[(읽음 커서·폐기 tombstone)]
    App --> Local[기기 음량·진동·OS 권한]
```

화살표는 통신/자료 흐름이지 DB 공유 권한이 아니다. Business에 계정 DB를 추가하지 않는다. 신규 `/me` 한 번의 조회는 Data의 계정 projection을 사용하며 섬·지갑·화면 집계를 여기 끼워 넣지 않는다. 화면 BFF 13개는 후반 배치의 책임이다.

## 현재 코드와 목표의 거리

| 영역 | 기준 main에서 확인한 것 | 미통합 1659 기반 | 1757이 연결/추가할 것 |
| --- | --- | --- | --- |
| 인증 | Data AuthService가 제공자 검증·사용자 생성·JWT 발급 | 내부 bootstrap/session 확인, auth session row | Business 검증/서명, 로그인 준비·확정, 공개 7개 경로 |
| RT | users의 단일 해시, 조건부 회전 | 세션 보조 행과 epoch, 기존 users 해시도 사용 | 세션별 정본 전환과 legacy 병행/승격·원 RT 증명의 결과 복구 receipt |
| 프로필 | nickname·기존 프로필, active user lock | 내부 사용자 위임/활성 검사 | name 매핑·catColor 저장·완료 판정 |
| 탈퇴 | 환불·익명화·PII 파기가 Data 단일 TX | 세션 폐기, authGeneration, 알림/링크 outbox | 새 프로필·로그인/명령 자료 및 chat/realtime 읽음 이력 파기·writer fencing 포함 |
| 설정 | Data의 기존 5필드 설정 | 알림 서버 정본 이관, Data outbox·직접 전달 | 1필드 공개 PATCH와 field mask·필드별 버전 |

1659 `AuthSessionService`의 존재만으로 계정 전체 이관이 완료됐다고 판단하지 않는다. 반대로 동일한 internal client, caller 인증, 위성 명령/outbox를 계정에서 다시 만들지도 않는다. 선행 공통 봉투·deadline·requestId 구현은 1751~1753 및 1659 통합에 의존한다.

## 로그인: 잠깐 준비하고, 서명 뒤 확정

```mermaid
sequenceDiagram
    participant A as 앱
    participant B as Business
    participant P as 제공자 어댑터
    participant D as Data
    A->>B: POST /auth/sessions + 로그인 시도 ID
    B->>B: 앱 키·스키마·선택 AT 검증 및 guest 구분
    B->>D: 시도 ID로 내구 상태 존재·고정 digest key ID 조회(결과 미반환)
    B->>B: 고정 key ID(없으면 현재 키)로 실제 원 code/credential keyed digest 계산
    B->>D: 시도 ID + 자격 digest + 원 선택 세션 증명으로 내구 상태 대조
    D->>D: users 먼저 잠금 → 선택 세션 활성/세대·legacy 결합 검사
    alt 검증 결과가 저장된 동일 시도
        D->>D: scope·원 자격 일치, 활성 사용자·세대/epoch·고정 만료 검사
        break 불일치·만료·INVALIDATED
            D-->>B: 기존 자격/상태 오류
            B-->>A: 실패, IdP 교환·토큰 반환 없음
        end
        D-->>B: 유효한 준비/확정 결과와 고정 claims
        Note over B,P: 제공자 재교환 없음. INVALIDATED/불일치는 여기서 거절
    else 검증 결과 없는 안전한 최초 실행
        Note over B,D: 같은 시도의 실행 소유권 확보. 다른 실행자는 재조회/진행 중 응답
        B->>P: 제공자 증명 검증 또는 code 교환
        P-->>B: 검증된 provider subject
        B->>D: prepareLogin(검증 결과, 자격 digest, 검증된 scope, 시도 ID)
        Note over D: TX1: users → 원 선택 세션 잠금/재검증, upsert<br/>검증 결과·PENDING 세션·고정 서명 재료를 함께 저장
        D-->>B: userId, sessionId, nonce, 고정 claims
    end
    B->>B: 동일 key/claims로 AT·RT 서명
    B->>D: completeLogin(nonce, RT hash)
    Note over D: TX2: users → 선택 세션 활성·결과 준비 상태/세대/epoch·CAS 대조<br/>세션 활성화·RT hash 확정
    D-->>B: 확정 결과 또는 같은 성공 시도의 결과
    B-->>A: 201 data(accessToken, refreshToken, userId, onboardingComplete)
```

선택 AT의 서명만으로 승격 권한을 인정하지 않는다. Data는 users 우선 잠금 아래 원 sid의 미폐기/현재 세대 또는 입증된 sidless legacy 결합·폐기 fence를 내구 조회·prepare·complete·성공 재생마다 검사한다. 개별 logout은 users 활성/gen이 그대로여도 해당 AT를 거절하게 한다. 비게스트 전환에서 두 사용자 잠금이 필요하면 UUID 정렬 후 session/attempt를 잠그며 IdP 대기 중에는 유지하지 않는다. [상세 관문](low-level-design.md#선택-at의-세션-폐기-관문)의 실제 구현/경합 검증 전 활성화하지 않는다. 유효한 선택 AT가 guest=false이면 기존 계정 전환을 허용하고 제공자 계정으로 로그인/가입한다. 이를 게스트 증명 실패로 거부하거나 두 소셜 계정을 합치지 않는다. guest=true일 때만 기존 승격 대상과 userId 보존 규칙을 적용한다. 제공자 자격 실패는 기존 6개 제공자별 *_TOKEN401을 유지하며 UNAUTHORIZED로 뭉개지 않는다.

제공자 네트워크 호출은 Data TX 밖이다. 모든 요청은 실제 원 code/credential을 제시하고, Business는 시도 ID로 고정 digest key ID를 먼저 조회한 뒤 그 키로 digest를 계산해 내구 시도와 대조한다. 앱이 보낸 digest나 provider subject만으로 재생하지 않는다. TX1 이후 Business가 죽으면 같은 시도 ID와 같은 자격 증명으로 준비 결과를 되찾아 재개하며, 이미 소비된 일회성 code를 다시 교환하지 않는다. 성공했는데 응답만 잃었으면 고정 claims로 같은 토큰을 복원한다. Data에는 원문 토큰 대신 해시·서명 재료만 남긴다. 재개는 원래 제공자 자격의 digest와 시도 범위가 일치해야 하며 시도 ID 하나만 알아서 토큰을 얻을 수 없다. 제공자 검증 성공 직후 TX1 저장 전에 죽으면 그 검증 결과는 내구화되지 않았으므로 이 복구로 재생할 수 없다. 교환 결과가 불명확한 실행을 안전한 최초 시도로 돌려 code를 무조건 다시 쓰지 않는다. 제공자의 검증된 복구 수단이 없으면 새 제공자 자격과 새 시도로 재인증해야 하며, guest 복구·Q06 정책을 임의 대체하지 않는다. [LLD의 재개 순서와 장애 경계](low-level-design.md#제공자-교환-전에-내구-시도를-조회한다)를 따른다.

자격 digest는 attempt에 고정한 key ID로 계산한다. Business 배포로 digest 키가 바뀌어도 재개는 그 key ID의 이전 키로 같은 digest를 재현하고, 이전 키는 완료 뒤 응답 유실을 복원하는 COMPLETED를 포함해 재생 가능한 attempt의 고정 복구 마감이 끝날 때까지 검증 전용으로 남긴다. 키 교체를 다른 자격으로 오판하지 않는다.

탈퇴·세션 폐기가 먼저 확정됐으면 성공 시도라도 토큰을 다시 발급하지 않는다. 로그인 결과가 불명확하다고 매번 새 시도를 만들면 세션이 늘고 게스트 승격 경쟁이 생기므로 앱은 먼저 같은 시도를 재개한다. 로그인 CAS의 단순 경쟁 패배는 REPREPARE_REQUIRED로 분리하고 같은 attempt/자격으로 새 generation/nonce·고정 재료를 한 번 준비한다. 동시에 재개해도 같은 새 준비를 받고, 이전 nonce의 지연 완료는 거부한다. 탈퇴·epoch 폐기나 복구 창 종료는 INVALIDATED이며 재준비하지 않는다. [LLD 상태 전이](low-level-design.md#로그인-cas-충돌의-재준비-전이)를 따른다. 이는 refresh CAS 경쟁에서 진 요청을 성공 처리하는 규칙이 아니다.

## 프로필: 상태와 전달할 사실을 같이 저장

새 PATCH는 활성 users를 배타 잠그고 완료 receipt를 먼저 확인한다. 새 실행만 기존 name 변경 primitive에 위임하고 catColor를 적용한 뒤 Q03/Q04의 승인된 동일 판정으로 완료 전이를 비교한다. false→true이면 `user.onboarded`, 실제 이름 변경이면 기존 동기 리스너를 통한 `user.displayNameChanged`가 필요하다. 프로필·전이·receipt·outbox가 같은 Data TX이므로 하나라도 저장에 실패하면 모두 rollback한다. 동일 키 재생·무변경은 전이/사건을 다시 만들지 않는다.

```mermaid
sequenceDiagram
    participant B as Business
    participant D as Data 프로필 TX
    participant O as Data outbox
    participant C as 랭킹·Link 소비자
    B->>D: PATCH /me + 검증 주체 + 동일 명령 키
    D->>D: users 배타 잠금·receipt 우선·변경 전후 비교
    opt 실제 이름 변경
        D->>D: 기존 이름 primitive → 동기 표시정보 리스너
        D->>O: user.displayNameChanged + 멤버십 snapshotVersion
    end
    opt 승인된 완료 판정 false에서 true
        D->>O: user.onboarded + 사용자 점수/상태 version
    end
    Note over D,O: 프로필·결과 receipt·필요한 사건을 같은 TX로 커밋
    D-->>B: 원 공개 프로필 응답
    O->>C: 커밋 후 기존 relay/스트림으로 재전달
    Note over C: 랭킹은 주차별 절대 점수·tombstone<br/>Link는 자기 snapshotVersion·폐기 상태
```

legacy POST/PATCH /api/v1/users/me도 같은 완료 입력인 nickname을 바꾸므로 신규 PATCH와 공통 전이 경계를 사용한다. 모든 프로필 writer가 users 배타 잠금 아래 요청 전체의 변경 전후 판정을 비교하고 false→true일 때만 같은 TX에 user.onboarded를 남긴다. 신규 color/legacy nickname의 양방향·동시 저장과 rollback을 검증하며 미결 색상/완료 정책은 그대로 둔다.

표시정보 writer는 미통합 선행에 있으므로 새 PATCH에 연결해 재사용하며 별도 이중 outbox를 만들지 않는다. `user.onboarded` 생산자와 랭킹 소비자는 후속 통합 의무다. 두 version 축은 비교하지 않는다. 이 흐름은 기존 아키텍처 ㊣/㋡의 내부 상태 계약이고 섬 STOMP 14종이나 공개 API 66종을 추가한 것이 아니다. Q03/Q04 판정 및 원자 저장·중복/역순/탈퇴 회귀 전 새 경로를 활성화하지 않는다. [LLD 원자 경계와 실제 선행 코드](low-level-design.md#프로필-변경과-기존-상태-사건의-원자-경계)를 따른다.

## RT 전환과 로그아웃

```mermaid
flowchart TD
    Entry[신규 /me 계열 진입] --> AT{검증된 AT/RT 묶음인가?}
    AT -->|sidless 또는 원 legacy RT 혼합| Refresh[기존 refresh 경로 강제 호출]
    AT -->|동일 subject·sid·gen 및 유효 자격| Ready[세션 검증을 받는 신규 요청]
    AT -->|자격 불일치·부재| Closed[gate 유지·기존 인증 복구/Q06]
    Refresh --> RT[유효 RT]
    RT --> SID{sid 존재?}
    SID -->|없음| Receipt{승격 완료 receipt 존재?}
    Receipt -->|있음| Replay[원 RT 증명·현재 세션·고정 복구창 검사]
    Replay -->|유효| Same[동일 sid AT와 RT 결과 복원]
    Replay -->|폐기 또는 불일치| Fail
    Receipt -->|없음| Legacy[legacy 해시와 활성 사용자 대조]
    Legacy --> Promote[세션·새 해시·고정 결과 receipt 원자 승격]
    SID -->|있음| Session[해당 사용자·세션 해시 대조]
    Session --> Due{회전 시점?}
    Due -->|아님| Keep[새 AT + refreshToken null]
    Due -->|맞음| CAS[기존 해시 조건부 교체]
    CAS -->|1행| New[새 AT + 새 RT]
    CAS -->|0행| Fail[401 REFRESH_TOKEN]
    Promote --> Store[AT와 RT 묶음 원자 저장·공개]
    Same --> Store
    Keep --> Store
    New --> Store
    Store --> Ready
```

현재 앱 `getFreshAccessToken`은 만료가 남은 AT를 바로 반환하므로 서버의 legacy RT 승격만으로 새 `/me` 진입이 보장되지 않는다. 새 앱은 이 빠른 반환 전에 AT/RT의 타입·subject·sid·authGeneration 및 만료를 함께 검사하는 전환 gate를 둔다. AT만 sid가 있어도 원 legacy RT가 남은 구 앱 혼합 저장은 Ready가 아니다. AT 만료를 기다리지 않고 원 RT 승격 receipt를 복구하고 기존 sid AT와 복구 결과의 주체·세션·세대를 대조한다. 기존 `/api/v1/auth/refresh`를 single-flight로 호출하고 로그인/로그아웃 generation을 대조한 뒤, AT/RT를 하나의 커밋된 인증 묶음으로 원자 저장·공개해야 gate가 열린다. 현행 두 번의 `AsyncStorage.setItem`은 이 원자성을 보장하지 않는다. 강제 승격에서는 새 sid AT와 sid RT가 모두 필요하며 클라이언트가 sid를 만들어 붙이지 않는다. 응답 유실·저장 실패 시 부분 토큰으로 진행하지 않고 같은 원 legacy RT로 승격 전용 receipt의 동일 AT/RT를 복원한다. 이 receipt는 현재 main/조사한1659에 없는 구현 의존이다. 현재 세션·epoch/gen·새 RT hash·원 RT 및 고정 토큰 만료·복구창이 모두 유효해야 재생하며, 소비된 bootstrap은 되살리지 않는다. 복구창 밖의 소셜 계정은 제공자 재인증이 가능하지만 제공자 없는 게스트의 대체 복구는 승인되지 않았다. Q06 결정과 서버 복구 검증 전에 강제 승격을 출시하지 않는다. [상세 진입 gate](low-level-design.md#유효한-sidless-at를-가진-기존-앱-설치의-진입-gate)를 따른다.

기기 A와 B는 서로 다른 sessionId를 가진다. B 로그인은 A 세션의 RT를 교체하지 않는다. sid 없는 legacy RT를 이름만 바꿔 폐기하지 않고, 기존 토큰의 최대 유효 수명과 실제 만료 시각을 기준으로 호환 창을 닫는다. prod/dev의 AT TTL이 다르므로 임의의 1시간을 전체 환경 공통 전제로 삼지 않는다.

`DELETE /auth/sessions/current`는 정확한 경로·메서드만 AT 필수 검사에서 제외하고 RT 전용 검증으로 인증한다. `X-Refresh-Token`은 필수이며 AT를 보냈다면 유효하고 같은 세션이어야 한다. 만료된 AT를 아예 보내지 않고 유효 RT만으로 종료할 수 있다. Data 한 TX에서 해당 세션과 bootstrap만 폐기한다. RT에는 대상 FCM 토큰/소유권 값이 없어 기기 삭제 outbox를 여기서 만들지 않는다. 잘못된 RT는 기존 401 REFRESH_TOKEN을 유지한다. 응답을 잃고 같은 RT를 다시 보낸 경우, 아직 유효한 원 RT의 폐기 증명 해시가 일치하고 사용자도 활성일 때만 200을 재생한다.

기기 등록 삭제는 별도 `DELETE /api/v1/users/me/device-token`이 `X-Device-Token`·`X-Device-Ownership`을 받아 처리한다(장부 ㊲·㊨·㊪). 새 앱은 큐 생성 시 대상과 고정 `Idempotency-Key`를 함께 저장한다. Data outbox 생성은 `K:device-delete-outbox`, 알림 직접 전달과 relay는 동일 `K:device-delete`를 사용한다. 원 사용자·명령 scope·fingerprint 검증 후 완료된 같은 키를 과거 ownership 거절보다 먼저 재생한다. 성공 후 바뀐 ownership으로 원 삭제가 실패하지 않으며 새 등록을 다시 삭제하지 않는다. 기존 클라이언트의 키 생략 호환과 이 새 앱의 필수 키 계약은 구분한다. 앱은 기기 자격·원 사용자·고정 키를 내구 큐에 보존하고 DELETE를 시도하되, 실패해도 원 세션 RT 폐기와 로컬 인증 정리를 독립적으로 계속한다. 미완료 큐는 보존하며 logout 200을 기기 삭제 성공으로 간주하지 않는다. AT가 만료돼 DELETE를 재전송할 수 없어도 검증된 sid/bootstrap 연결 등록은 같은 Data TX의 auth.session.revoked outbox와 알림 서버의 로컬 세션 fence·비활성화로 정리한다(㋗·㋞·㋨). 선행 PR745에 있는 이 전달은 독립 DELETE 성공을 뜻하지 않으며 relay 적용 전 지연도 남는다. 미연결 legacy 등록을 현재 검증된 세션에 연결하고 경합을 검증하는 것은 새 앱 전환 활성 조건이며, 이를 이유로 RT 폐기 자체를 대기시키지 않는다. 알림 서버는 기기 삭제 때도 토큰별 tombstone·최대 ownershipVersion을 남기고 등록도 같은 잠금에서 이를 대조하여 다른 키의 지연 등록 부활을 막는다(㉴·㋓). 비동기 도중 새 로그인이 시작되면 기존 generation 검사로 새 세션을 보존한다. 사용자 전체 등록을 지우지 않고 대상 토큰의 ownership을 대조해 다른 기기와 재등록을 보존한다.

비게스트 A→B 전환과 같은 사용자 s1→s2 재로그인도 이전 기기·ownership·주체·고정 키를 내구 큐에 먼저 준비한다. 준비만으로 DELETE/RT 폐기를 실행하지 않으며, 새 세션과 내구 commit 표지가 확정된 뒤에만 같은 삭제/outbox 경로와 원 세션 폐기를 실행한다. 부분 저장·rollback은 A의 등록을 보존하고, commit 뒤 재전달은 B의 자격과 새 ownership을 보존한다(LLD 계정 전환 절).

## 탈퇴: 중앙 원자 처리와 위성 정리

```mermaid
sequenceDiagram
    participant A as 앱
    participant B as Business
    participant D as Data
    participant DB as Data DB
    participant R as relay
    participant S as 알림·링크·chat/realtime 서버
    A->>B: DELETE /me, confirmation, Idempotency-Key
    B->>D: 검증한 주체로 withdraw 명령
    D->>DB: BEGIN + 활성 users 배타 잠금
    D->>DB: 멱등/권한 검사 + 세션 폐기·위성 명령·랭킹 및 chat/realtime user.withdrawn·GA4 사용자 삭제 작업 내구 기록
    D->>DB: 방장 조건·내기 해제/환불·증거 동결
    Note over D,DB: 필요한 판정 근거가 불명확하면 전체 롤백
    D->>DB: group_challenge_members 사용자 측정 원본 hard delete
    D->>DB: 멤버십 이탈·개인 설정 초기화, group_invites 양방향 삭제<br/>집중/통계 및 개인 태그 연결 파기
    D->>DB: group_announcements.user_id nullify
    D->>DB: 알림 발송 이력의 수신자·사용자 상대 연계 파기
    D->>DB: 리그 일간 삭제·주간 개인 결과 파기와 최소 완료 마커 분리
    D->>DB: 양방향 user_blocks·friendships(상태 무관)·pin, 본인 user_streaks 삭제
    D->>DB: character_generation 본인 전체 이력·character_equipment 장착 행·지갑·설정 삭제, 직접 PII·신규 프로필 파기
    D->>DB: soft delete + 결과 receipt + COMMIT
    D-->>B: deleted true
    B-->>A: 200 data(deleted true)
    R->>DB: 커밋된 outbox 읽기
    R->>S: 사용자 폐기·개인자료 정리 재전달
    Note over R: GA4 사용자 삭제 요청(user_id·app_instance_id)도 outbox로 재시도하고 지연 수용 기간 뒤 재요청
    Note over S: chat/realtime 로컬 TX: 사용자 잠금 → tombstone/version + 읽음 커서 DELETE + 수신 완료<br/>커밋 뒤 멤버십 캐시 삭제·전 인스턴스 소켓 종료, 인가·전달·발신은 fence 재검사
    S-->>R: 로컬 커밋 뒤 대상별 적용 확인
    Note over R,S: 랭킹은 tombstone/version + 모든 주차 ZSET·presence 원자 제거
```

기존 `freezeEvidenceForAccountErasure`는 달성 결과를 참가 행에 확정하지만 판정 target이 없으면 건너뛴다. 이 skip을 파기 준비 완료로 취급하지 않는다. OPEN 내기의 필요한 판정 근거가 확정되었는지 검증한 다음 원본 `group_challenge_members`를 삭제한다. 해당 `user_id`는 NOT NULL FK라 nullify할 수 없다. 최소 정산 결과는 별도 참가 행에 남으며 측정 이력이나 프로필로 공개하지 않는다. 측정 보고의 users 공유 잠금과 탈퇴의 배타 잠금으로 삭제 후 재생성도 차단한다. 새 검증/삭제는 후속 구현 사항이다.

차단 관계는 blocker/blocked 어느 쪽이 탈퇴자여도 삭제하고 본인의 user_streaks 행도 hard delete한다. 현재 차단 생성 서비스는 없지만 후속 writer는 두 활성 users를 UUID 오름차순으로 공유 잠근 뒤 관계를 기록해야 한다. 스트릭의 현 writer인 FocusService 완료 TX는 users 공유 잠금을 사용하며 독립 writer도 같은 규칙을 적용한다. UserStreakService가 받은 오래된 User 객체만으로 파기 후 재생성할 수 없게 한다. 현 탈퇴 코드에는 이 두 삭제가 없어 후속 구현과 동시성 검증이 필요하다.

친구 관계는 from/to 어느 쪽이 탈퇴자여도 status나 기존 soft delete 여부와 무관하게 hard delete하고 pin도 양방향 삭제한다. 현재 탈퇴는 활성 행에 deleted_at만 기록해 NOT NULL 사용자 연결과 요청 상태·시각을 남기므로 활성 조회 필터를 파기로 취급하지 않는다. 요청·pin 생성은 두 활성 users 공유 잠금, 수락·거절은 행 배타 잠금으로 이미 직렬화된다. 잠금 없이 읽고 UPDATE하는 친구 삭제는 행 잠금 재조회로 바꿔 삭제된 행에 500 대신 기존 `NOT_FRIEND`를 반환한다.

공지 생성은 users 공유 잠금, 탈퇴는 같은 users 배타 잠금을 먼저 사용한다. 생성 선행이면 새 공지도 nullify하고 탈퇴 선행이면 생성은 404 `USER_NOT_FOUND`로 거부한다. 공지 내용은 기존 보존 규칙을 유지한다.

내기 참가 행은 정산 증거를 보존하되 개인 열람/표시 lease 3열만 같은 탈퇴 TX에서 nullify한다. claim·renew·ack는 활성 users 공유 잠금으로 탈퇴와 직렬화하고, 탈퇴 뒤 미확인 결과나 발송 대상으로 부활시키지 않는다.

활성 수신자의 추월 알림은 상대 탈퇴 때 target_user_id만 nullify하여 기존 주간 발송 횟수를 보존한다. 수신자 본인의 탈퇴 이력 삭제와 구분하고, 위성 파기·동시 writer도 같은 규칙을 적용한다.

소비된 초대 클릭의 claimed_user_id를 익명화해도 claimed_at 소진 표지를 유지한다. Data 후보 조회와 claim은 두 값이 모두 null인 미소비 클릭만 허용하고 이관/복원도 같은 표지를 보존하여 재귀속·보상 중복을 막는다.

claim 클릭의 matched_device_id·app_instance_id·ip_hash·user_agent도 같은 탈퇴 TX에서 파기한다. 두 식별자는 설치 device_id·GA4 기기 식별자와 같아 남기면 익명화한 클릭이 분석 자료로 다시 연결된다. app_instance_id는 지우기 전에 GA4 삭제 작업 입력으로 기록하고 소진 표지·퍼널 근거는 보존한다. 보존하는 group_members 행도 관계 증거만 남기고 그룹 알림·공지 권한·상태·역할을 비개인 기본값으로 초기화한다.

본인 발급 링크의 inviter_id도 같은 중앙 TX에서 nullify한다(nullable 스키마 확장 필요). 링크/종속 클릭은 타인 퍼널의 FK 앵커로 보존하고, 발급자 없는 링크는 랜딩·매치·claim·이관에서 폐기로 취급한다. 활성 users 공유 잠금 아래의 모든 발급 writer를 탈퇴 배타 잠금과 직렬화하며 현재 미구현인 조회/이관 호환까지 검증한 뒤 활성화한다.

방장 위임 조건 실패나 환불·outbox 기록 실패는 중앙 TX 전체를 롤백한다. 지갑을 먼저 삭제해서 내기 환불 경로를 끊지 않는다. 위성 전송 실패는 이미 확정된 중앙 탈퇴를 되돌리지 않고 대상별 미전달 상태로 남긴다. 그러므로 200은 중앙 계정 폐기 완료이며, 모든 위성의 물리 파기가 같은 순간 끝났다는 뜻은 아니다. 지연 요청은 각 위성의 generation/epoch tombstone으로 차단한다.

사용자 활동 로그도 정상적으로 UUID를 기록하므로 별도 파기 대상이다. 중앙 TX는 내구 작업만 남기고 후속 처리자가 실제 파일/회전본/호스트/외부 sink의 연결 제거와 완료를 확인한다. sink 직전 폐기 fence와 기존 큐·지연 업로드의 완료 장벽으로 재부착을 막는다. 운영 주석만으로 S3 구성·보존 기간·파기 완료를 확정하지 않으며 구현·운영 연결을 활성 조건으로 둔다.

GA4도 User-ID·app_instance_id·설치 device_id로 같은 사용자를 잇는다. 중앙 TX는 GA4 사용자 삭제 작업을 내구 기록하고, TX 밖에서 삭제 요청·지연 이벤트 뒤 재요청·완료 증거를 관리한다. 앱은 탈퇴 성공 뒤 식별자를 해제·재설정하기 전에는 사용자 연결 이벤트를 보내지 않는다.

공통 인증 검사는 AT 서명·타입·만료(401) → 사용자 활성(404 `USER_NOT_FOUND`) → 세션·authGeneration(401) 순서다. 탈퇴 뒤 옛 AT는 세션 폐기와 비활성이 함께 참이라 404가 우선하며, 앱은 최초 200이나 같은 `DELETE /me` 재시도의 404를 탈퇴 확정으로 본다. 그때만 일반 로그아웃과 별도로 그 userId의 기기 로컬 버킷·마커·누끼 파일을 writer drain 뒤 지운다. 일반 로그아웃과 계정 전환의 보존 정책은 그대로다.

chat/realtime은 별도 DB이므로 Data의 중앙 TX에서 커서를 직접 지우지 않는다. 읽음 보고가 먼저 로컬 잠금을 얻으면 탈퇴 소비자가 그 커서까지 삭제하고, 탈퇴가 먼저면 늦은 보고는 tombstone을 보고 거절한다. Redis 멤버십 캐시가 최대 120초 남거나 늦은 응답이 캐시를 다시 채워도 DB writer는 폐기를 재검사한다. 현 markRead는 캐시 검사 후 별도 UPSERT만 실행하므로 이 보호가 아직 없다. 소비자·모든 cursor writer 통합과 실제 경합 검증 전 파기 완료로 표시하지 않는다. 기존 메시지 본문/sender_id의 보존 정책과 우체통 읽음 표시 여부는 이 개인 이력 파기와 별개다.

같은 tombstone과 개별 로그아웃의 `auth.session.revoked` 세션 fence는 읽음 커서뿐 아니라 REST·STOMP 인가, 기존 구독의 메시지 전달, 메시지 저장 writer에도 적용한다. 멤버십 캐시 hit나 열린 소켓이 탈퇴·로그아웃 뒤 발신·열람 통로가 되지 않도록 소비자 커밋 뒤 캐시를 지우고 모든 인스턴스의 해당 소켓을 끊되, 그 정리가 실패해도 fence 재검사가 막는다.

초대 claim은 claimant와 현재 발급자의 users를 UUID 순서로 공유 잠근 뒤 링크를 다시 읽어 발급자 연결을 확인하고서야 클릭을 잠근다. 무잠금으로 먼저 읽은 발급자 값으로 탈퇴한 발급자의 링크에 늦게 귀속하지 않는다. 링크 이관 뒤에는 Link가 Data users를 잠글 수 없으므로 claim을 pending으로만 기록하고, Data가 잠금 아래 남긴 `link.claimConfirmed`가 relay로 와야 확정하며 `(groupId, inviterId)` 전이 tombstone보다 낮은 confirm은 거부한다.

## 설정: 한 필드만 바꾸기

```mermaid
sequenceDiagram
    participant A as 앱
    participant B as Business
    participant D as Data
    participant N as 알림 서버
    A->>B: PATCH /me/settings {notifications:false} + key
    B->>D: 활성 주체·세션 확인 + 부분 명령 기록
    Note over D: 사용자 잠금, 명령 ID/버전/outbox 한 TX
    D-->>B: commandId, version, mask, authGeneration
    B->>N: 동일 부분 명령 적용
    Note over N: tombstone 대조 + 선택 필드별 version 비교<br/>notificationEnabled만 원자 변경
    N-->>B: 해당 명령 적용 결과
    B->>D: 전달 완료 기록
    B-->>A: 200 data(notifications:false)
```

알림 서버가 아직 적용하지 못하면 outbox에 넣었다는 이유만으로 성공을 반환하지 않는다. 동일 키 재시도는 같은 명령을 재전달한다. 완료 표시만 실패했으면 relay 재전달이 멱등 처리된다. 이미 적용된 false 명령의 재시도 뒤 최신 설정이 true로 바뀌었어도 원 명령의 결과는 false이며 현재 상태는 별도 GET으로 읽는다. 버전은 모든 설정 필드에 공통 순서를 부여하되 적용 여부는 선택 필드마다 비교한다.

## 관측과 구현 순서

로그에는 requestId, route, 안전한 error code, commandId, 단계, 처리 시간, 재시도 횟수, outbox 대상별 상태를 남긴다. Authorization, X-Refresh-Token, 제공자 자격, 이름·색상·동의 본문, RT 해시·서명 재료·bootstrap nonce는 기록하지 않는다. 본문 전체와 내부 오류 원문을 무차별로 로깅하지 않는다.

1. 1659 및 공통 계약 통합 상태를 대조하고 중복 엔드포인트/저장소를 막는다.
2. Q03~Q06 입력을 연결하며 catColor·온보딩·약관 스키마와 세션 expand migration을 준비한다.
3. 로그인 준비/확정·RT 세션 전환 및 최초 legacy 승격 결과 복구 서버를 먼저 구현한다. 응답 유실·앱 crash·폐기 경쟁·게스트 복구창 경계를 검증한 뒤 앱 sidless 진입 gate·인증 묶음 원자 저장을 연결한다.
4. 프로필·동기 활성 조회·logout을 연결하고 탈퇴 전수 파기와 경쟁을 검증한다.
5. 알림 부분 명령·field mask·필드별 version을 양쪽 서비스에 연결한다.
6. 앱 계약 7종과 legacy 호환을 함께 검증한 뒤 세션 정본을 전환한다. legacy 읽기 제거는 호환 창 종료 후 별도 단계다.

리그 개인 이력 파기와 최소 완료 마커 보존은 중복 정산 방지와 함께 검증한다. 랭킹 user.withdrawn outbox도 중앙 탈퇴와 같은 TX이며, 모든 주차 ZSET/presence와 지연·DLT 재생의 차단은 [LLD의 리그 파기 경계](low-level-design.md#리그-이력랭킹-투영-파기)를 따른다. 현재 main에서 완료됐다고 주장하지 않는다.

캐릭터 생성 이력은 기존 recordGeneration의 users 배타 잠금 → 사용자 advisory → 이력 순서를 유지하고 같은 중앙 탈퇴 TX에서 본인 전체 행을 hard delete한다. 생성 선행이면 해당 행까지 삭제하고 탈퇴 선행이면 동일 client_generation_id 재시도도 거절한다. fixture에는 null/값 키·과거/현재·타인 행을 넣고 삭제 직후 실패의 전체 rollback을 검증한다. 이 삭제 배선은 후속 구현이며 현 코드에 있다고 간주하지 않는다.

태그 생성뿐 아니라 updateFocusTag의 새 채택/과거 세션 재연결과 복원·관리 writer도 활성 users 공유 잠금을 먼저 확보한다. 탈퇴 배타 잠금 아래의 태그 연결 파기·character_equipment hard delete와 같은 순서로 직렬화한다. 기존 EquipmentService의 equip/unequip 공유 잠금은 유지하고 user_items 보유 증거는 장착 설정과 구분해 보존한다. 실제 양방향 경합·늦은 flush·rollback 검증 전 전수 파기 완료로 표시하지 않는다.

정상 RT 회전은 원자 credential bundle뿐 아니라 서버 commit 뒤 응답 전체 유실의 안전 복구까지 검증해야 활성화한다. 같은 subject/sid/gen은 새 AT·옛 RT 혼합을 증명하지 못한다. 미검증 호환 경로는 원 RT 만료를 늘리지 않고 미회전을 유지하며, 정상 CAS0→401·최초 legacy 승격 receipt 한정·Q06 미결 규칙은 그대로다. 이는 목표 전환 조건으로 현재 서버 구현 완료가 아니다.
