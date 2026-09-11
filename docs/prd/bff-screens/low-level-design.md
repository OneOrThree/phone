# BFF 상세 계약

13개 모두 신규 Business GET이다. 원본22개 GET 재료와13개 BFF 매핑은 [source-contracts.json](source-contracts.json)에 보존한다. 여기의 공개 응답은 **새 BFF 계약**이며 원본 JSON을 수정한 것이 아니다. 단일 Data read-model snapshot·R/N·TTL0은 [정책](policy.md)의 승인된 초기 기술 선택이다.

## 1. 호출·입력·공개 DTO

성공200 `{data:ScreenDto}`, Cache-Control:no-store, 현재 요청의 서버 X-Request-Id를 반환한다. 내부 조각의 `{data}`를 중복 중첩하지 않는다. 실패는 `{error:{code,message,field,retryable},requestId}`, A0의409 전용 선택 current만 허용한다. 한 화면 오류를 내부 SQL/route/caller 명세로 설명하지 않는다.

모든 ScreenDto의 `asOf:UTC instant`는 **Data가 실제로 사용한 한 읽기 snapshot의 관측 시각**이다. Business 응답 직전에 Instant.now()로 바꾸지 않는다. 내부 Data snapshot 식별자는 공개 asOf와 다르며 여러 HTTP 결과에 같은 asOf를 붙여 원자 읽기라고 만들지 않는다. 조각의 기존 serverNow/asOf/updatedAt은 원래 의미를 유지한다. 집중/랭킹의 산정 anchor는 화면 snapshot 생성 시 정한 asOf와 일치하고 측정 updatedAt/재생 effectiveAt은 과거 원 시각일 수 있다.

UUID 입력은 하이픈 포함36자 필수, v4/v7 생성 권고다. userId/currentIslandId/role/isMember/sessionId/가격/잔액/version을 BFF query/header로 받아 서버 context를 바꾸지 않는다. 현재 세션/섬은 검증 주체에서 Data가 확정한다. 명시 islandId 경로가 있는 travel/visit은 그 대상의 권한을 검사하고 현재 섬으로 치환하지 않는다.

| BFF | 허용 query | 대상/제공자 |
| --- | --- | --- |
| `/screens/home` | date?,timezone? | 현재 섬 + 본인, HomeScene |
| `/screens/travel/{islandId}` | 없음 | 명시 목적지의 활성 소속, TravelScene |
| `/screens/focus` | 없음 | 본인 세션의 고정 섬, 없으면 검증 현재 섬, FocusScene |
| `/screens/sound` | 없음 | 현재 섬 + gram, SoundScene |
| `/screens/rest` | 없음 | 본인 세션의 고정 섬, 없으면 검증 현재 섬, RestScene |
| `/screens/hall` | from,to,scope 필수; timezone? | 현재 섬 + hall, HallRecords |
| `/screens/island-manage` | 없음 | 현재 섬 주민/host 조건, ManageScene |
| `/screens/board` | 없음 | 현재 섬 + board, BoardLists |
| `/screens/tower` | week 필수 | 현재 섬 + tower/승인 참가조건, RankingScene |
| `/screens/explore` | q? | 현재 섬 tower 검색가드 + 본인소속, SearchMemberships |
| `/screens/visit/{islandId}` | 없음 | 대상 공개 미리보기 + 본인요청, VisitState |
| `/screens/shop` | category? | 현재 섬 + shop, ShopScene |
| `/screens/boat` | 없음 | 본인만, BoatScene. 현재 섬 요구 없음 |

첫 페이지는 도메인 정본의 기본limit(목록에 명시 없으면30,상한100)로 만든다. BFF에는cursor/offset/limit을 추가하지 않는다. 반환된 조각의 nextCursor는 원 도메인 endpoint에서 그대로 이어받을 수 있게 동일kind/scope/filter/limit/snapshot으로 발행한다. 직접 도메인 GET과 이어질 수 없는 BFF 전용 cursor를 같은 문자열 형식으로 위장하지 않는다. 후속 페이지에서 또 모든 화면재료를 새로 읽지 않는다.

home의 date 누락은 서버 KST 오늘. hall from/to/scope와31일 기술 상한, tower ISOweek는 PR743/748 규약을 따른다. timezone 누락은Asia/Seoul, 다른 값·별칭·빈값·null/중복은400 INVALID_PARAMETER. from/to는KST 날짜 포함 범위이고 시각창은[from00:00,to+1일00:00)이다. 같은 값을 두 하위 query가 각각 다른 시각/locale로정규화하지 않는다. 요청에 쓸 수 없는 field·중복query·GET body는400 INVALID_PARAMETER로거절하고 enum/기간범위는 원 도메인의422 OUT_OF_RANGE를 보존한다. q의 검색 길이/문자와 category의 허용집합은1759/1781 정본을 재사용한다.

### 조각 타입

아래 조각은 각 도메인의 승인된 **공개 data DTO**다. 내부 JPA entity나 상류원문 Map을 그대로 직렬화하지 않는다.

- island(home/travel/manage): MemberIslandDetail의 공통 공개요약+role/buildings/assetVersion/initialConstruction/constructionTarget/buildingThemes/version. **island.appearanceVersion은 이번 승인된 필수 응답 확장**이며 원본 또는 기존 부분 응답에 있었다고 가정하지 않는다.1759/1783 제공자가 같은 snapshot에서 실제 island appearance.version을 직접 매핑해야 한다. 값이 준비되지 않았다고island.version을복사하지 않는다.
- island(visit): PublicIslandSummary whitelist만. id/name/intro/visibility/approvalRequired/memberCount/membershipStatus/growthStage/themeId/joinRequestId. **role/permissions/초기기여/목표/지갑/집중·기록/편지/다른주민·신청자 키 부재**를 검사한다. 호출자가주민이어도visit은이projection만쓴다.
- session: PR743 current-session DTO 또는 명시 정상null. 빈HTTP200/204는 정상null증거가아니다. focus/rest members는 items/serverNow/**watermarks**를보존한다. rest row에원본에 없는sessionId를만들지않는다.
- focusMembers.items[].appearanceVersion: 같은 snapshot의 실제 user appearance.version을 직접 매핑하는 필수 안전 정수(0~9007199254740991)다. 현재 PR737/743의 표시용 Appearance={clothes,decor,hull,position}에는 version이 없으므로 주민 항목에 붙인다. PR742 equipped.version과 **같은 개인 외양 정본 값**이며 새 버전 카운터를 만들지 않는다. BFF를 위해 본인전용 GET /me/inventory를 다른 주민에게 호출하거나 개인 보유 목록을 노출하지 않는다.1765의 주민 GET과1783의 외양 제공자를 동기화하는 명시 확장이고 원본22개 GET JSON은 보존한다.
- focusStatistics: PR748 scope=me/island DTO와asOf. screenTimeStatistics는 measurementStatus/nullableminutes/series/updatedAt을보존한다. scope=island에개인records/subject를넣지 않는다.
- members: items/nextCursor/**version**. joinRequests: items[{id,applicantId,name,status,version}]/nextCursor. 일반주민에게는후자를조회하지 않는다.
- quests/notices:1773/1771 목록공개 DTO. 카드마다progress/detail을추가HTTP로조회하지 않는다. 각item의실제 버전/회차/페이지정보를보존한다.
- memberRankings/islandRankings: PR748의같은관측시각·승인된cohort/순위정책. myRank는현재페이지번호가아니라전체snapshot순위다.
- products:1781목록의ownerType/productVersion/owned/available/reason 포함. wallets의fishVersion/villagePointsVersion은각지갑축이다. sharedInventory의inventoryVersion/appearance.version, inventory의inventoryVersion/equipped.version도 유지한다. 이 ownerType·productVersion·inventory/외양 버전은 원본 HTML에 있던 필드라는 뜻이 아니라 [1780 상점 설계](../island-shop/low-level-design.md)와 [1782 보유품 설계](../island-appearance/low-level-design.md)의 명시 확장을 BFF가 상속한다는 뜻이다.
- me:1757의id/name/catColor/linkedProviders/onboardingComplete. 공개색상/온보딩정책이 미결이면기본값을발명하지 않는다.

### N 상태 불변식

travel/focus의 playbackAvailability는 available|facility_locked 두값이다. available이면playback 객체필수이며trackId=null의정상미선택도이객체로표현한다. facility_locked이면gram미해금을같은 snapshot에서확인하고playback조회 생략+null이다. sound는gram필수라미해금이면전체403이다.

manage의 joinRequestsAvailability는 available|host_only다. available은현재host의실제조회결과(빈items허용), host_only는일반활성주민에게조회 생략+null이다. visit의 joinRequestAvailability는 available|none, available은본인최신요청조회결과, none은본인joinRequestId가없음을확인한null이다. 임의403/404를이상태로접지않는다. availability불일치(null인데available등)는502 UPSTREAM_CONTRACT_ERROR다.

## 2. 화면 13개 응답 예시

각 예시는 **독립된 설명용 fixture**이며 동일한시각/사용자ID가나와도모든예시가하나의운영DB상태라는뜻은아니다. 가격·보상·색·가입/분모등목업값을운영정책으로승인하지 않는다. 계정/건설/퀘스트/랭킹미답정책이필요한조각은해당gate완료전활성화하지 않는다. 원본22개 GET예시는source-contracts.json에변경없이따로남겼다.

### 1. GET `/screens/home`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "island": {
      "id": "019f16a0-0000-7000-8000-000000000010",
      "name": "소다 섬",
      "intro": "각자의 속도로 집중해요",
      "visibility": "public",
      "approvalRequired": false,
      "membershipStatus": "active",
      "role": "host",
      "buildings": [
        "hall",
        "board"
      ],
      "growthStage": "02-notice-board",
      "assetVersion": "R61",
      "initialConstruction": null,
      "constructionTarget": null,
      "themeId": "default",
      "buildingThemes": {
        "hall": "default",
        "board": "default"
      },
      "version": 4,
      "memberCount": 3,
      "joinRequestId": null,
      "appearanceVersion": 2
    },
    "focusSummary": {
      "date": "2026-09-11",
      "completedSeconds": 3600,
      "currentSessionSecondsToday": 600,
      "totalSeconds": 4200,
      "serverNow": "2026-09-11T09:10:00Z"
    },
    "session": {
      "id": "019f16a0-0000-7000-8000-000000000020",
      "islandId": "019f16a0-0000-7000-8000-000000000010",
      "subject": "수학 문제 풀기",
      "targetMinutes": 25,
      "status": "active",
      "activeSeconds": 600,
      "serverNow": "2026-09-11T09:10:00Z",
      "startedAt": "2026-09-11T09:00:00Z",
      "restStartedAt": null,
      "version": 1
    }
  }
}
```

### 2. GET `/screens/travel/{islandId}`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "island": {
      "id": "019f16a0-0000-7000-8000-000000000010",
      "name": "소다 섬",
      "intro": "각자의 속도로 집중해요",
      "visibility": "public",
      "approvalRequired": false,
      "membershipStatus": "active",
      "role": "host",
      "buildings": [
        "hall",
        "board"
      ],
      "growthStage": "02-notice-board",
      "assetVersion": "R61",
      "initialConstruction": null,
      "constructionTarget": null,
      "themeId": "default",
      "buildingThemes": {
        "hall": "default",
        "board": "default"
      },
      "version": 4,
      "memberCount": 3,
      "joinRequestId": null,
      "appearanceVersion": 2
    },
    "playbackAvailability": "facility_locked",
    "playback": null
  }
}
```

### 3. GET `/screens/focus`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "session": {
      "id": "019f16a0-0000-7000-8000-000000000020",
      "islandId": "019f16a0-0000-7000-8000-000000000010",
      "subject": "수학 문제 풀기",
      "targetMinutes": 25,
      "status": "active",
      "activeSeconds": 600,
      "serverNow": "2026-09-11T09:10:00Z",
      "startedAt": "2026-09-11T09:00:00Z",
      "restStartedAt": null,
      "version": 1
    },
    "focusMembers": {
      "items": [
        {
          "userId": "019f16a0-0000-7000-8000-000000000001",
          "name": "수빈",
          "catColor": "black",
          "appearance": {
            "clothes": "scarf",
            "decor": "flag",
            "hull": "sailboat",
            "position": "front"
          },
          "sessionId": "019f16a0-0000-7000-8000-000000000020",
          "subject": "수학 문제 풀기",
          "activeSeconds": 600,
          "status": "active",
          "appearanceVersion": 10
        },
        {
          "userId": "019f16a0-0000-7000-8000-000000000002",
          "name": "민지",
          "catColor": "ginger",
          "appearance": {
            "clothes": "scarf",
            "decor": "flag",
            "hull": "sailboat",
            "position": "front"
          },
          "sessionId": "019f16a0-0000-7000-8000-000000000021",
          "subject": "영어 단어",
          "activeSeconds": 1320,
          "status": "active",
          "appearanceVersion": 11
        }
      ],
      "serverNow": "2026-09-11T09:10:00Z",
      "watermarks": [
        {
          "projection": "focus.member",
          "islandId": "019f16a0-0000-7000-8000-000000000010",
          "aggregateId": "019f16a0-0000-7000-8000-000000000001",
          "version": 2
        },
        {
          "projection": "focus.member",
          "islandId": "019f16a0-0000-7000-8000-000000000010",
          "aggregateId": "019f16a0-0000-7000-8000-000000000002",
          "version": 2
        }
      ]
    },
    "playbackAvailability": "available",
    "playback": {
      "trackId": "waves",
      "playing": true,
      "positionSeconds": 12,
      "effectiveAt": "2026-09-11T09:10:00Z",
      "changedBy": "019f16a0-0000-7000-8000-000000000002",
      "version": 2,
      "serverNow": "2026-09-11T09:10:00Z",
      "durationSeconds": 120.5
    }
  }
}
```

### 4. GET `/screens/sound`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "sharedInventory": {
      "audio": [
        "waves",
        "campfire",
        "forest-wind"
      ],
      "islandThemes": [
        "soda-theme"
      ],
      "buildingThemes": [
        {
          "buildingId": "hall",
          "themeId": "strawberry-roof"
        }
      ],
      "inventoryVersion": 3,
      "appearance": {
        "islandThemeId": "default",
        "buildingThemes": {
          "hall": "default",
          "board": "default",
          "gram": "default"
        },
        "version": 4
      }
    },
    "playback": {
      "trackId": "waves",
      "playing": true,
      "positionSeconds": 12,
      "effectiveAt": "2026-09-11T09:10:00Z",
      "changedBy": "019f16a0-0000-7000-8000-000000000002",
      "version": 2,
      "serverNow": "2026-09-11T09:10:00Z",
      "durationSeconds": 120.5
    }
  }
}
```

### 5. GET `/screens/rest`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "session": {
      "id": "019f16a0-0000-7000-8000-000000000020",
      "islandId": "019f16a0-0000-7000-8000-000000000010",
      "subject": "수학 문제 풀기",
      "targetMinutes": 25,
      "status": "paused",
      "activeSeconds": 600,
      "serverNow": "2026-09-11T09:10:00Z",
      "startedAt": "2026-09-11T08:57:00Z",
      "restStartedAt": "2026-09-11T09:07:00Z",
      "version": 1
    },
    "restMembers": {
      "items": [
        {
          "userId": "019f16a0-0000-7000-8000-000000000001",
          "name": "수빈",
          "catColor": "black",
          "restSeat": 1,
          "restStartedAt": "2026-09-11T09:07:00Z"
        }
      ],
      "serverNow": "2026-09-11T09:10:00Z",
      "watermarks": [
        {
          "projection": "rest.member",
          "islandId": "019f16a0-0000-7000-8000-000000000010",
          "aggregateId": "019f16a0-0000-7000-8000-000000000001",
          "version": 3
        }
      ]
    }
  }
}
```

### 6. GET `/screens/hall`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "focusStatistics": {
      "scope": "me",
      "totalSeconds": 1500,
      "series": [
        {
          "date": "2026-09-11",
          "seconds": 1500
        }
      ],
      "records": [
        {
          "id": "019f16a0-0000-7000-8000-000000000020",
          "subject": "수학",
          "activeSeconds": 1500,
          "completedAt": "2026-09-11T09:10:00Z"
        }
      ],
      "nextCursor": null,
      "asOf": "2026-09-11T09:10:00Z"
    },
    "screenTimeStatistics": {
      "scope": "me",
      "measurementStatus": "unavailable",
      "totalMinutes": null,
      "series": [],
      "updatedAt": null
    }
  }
}
```

### 7. GET `/screens/island-manage`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "island": {
      "id": "019f16a0-0000-7000-8000-000000000010",
      "name": "소다 섬",
      "intro": "각자의 속도로 집중해요",
      "visibility": "public",
      "approvalRequired": false,
      "membershipStatus": "active",
      "role": "member",
      "buildings": [
        "hall",
        "board"
      ],
      "growthStage": "02-notice-board",
      "assetVersion": "R61",
      "initialConstruction": null,
      "constructionTarget": null,
      "themeId": "default",
      "buildingThemes": {
        "hall": "default",
        "board": "default"
      },
      "version": 4,
      "memberCount": 3,
      "joinRequestId": null,
      "appearanceVersion": 2
    },
    "members": {
      "items": [
        {
          "id": "019f16a0-0000-7000-8000-000000000001",
          "name": "수빈",
          "catColor": "black",
          "role": "member"
        },
        {
          "id": "019f16a0-0000-7000-8000-000000000002",
          "name": "민지",
          "catColor": "ginger",
          "role": "host"
        },
        {
          "id": "019f16a0-0000-7000-8000-000000000003",
          "name": "수아",
          "catColor": "gray",
          "role": "member"
        }
      ],
      "nextCursor": null,
      "version": 6
    },
    "joinRequestsAvailability": "host_only",
    "joinRequests": null
  }
}
```

### 8. GET `/screens/board`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "quests": {
      "items": [
        {
          "id": "019f16a0-0000-7000-8000-000000000040",
          "occurrenceId": "019f16a0-0000-7000-8000-000000000041",
          "title": "저녁 30분 집중",
          "type": "focus",
          "windowStart": "18:00",
          "windowEnd": "23:00",
          "timezone": "Asia/Seoul",
          "date": "2026-09-11",
          "targetMinutes": 30,
          "myRate": 60,
          "reward": {
            "currency": "village_points",
            "amount": 10
          },
          "settlementStatus": "in_progress",
          "claimable": false,
          "claimBlockedReason": "MEMBERS_INCOMPLETE",
          "claimed": false,
          "version": 1
        }
      ]
    },
    "notices": {
      "items": [
        {
          "id": "019f16a0-0000-7000-8000-000000000050",
          "title": "환영해요",
          "commentCount": 1
        }
      ],
      "nextCursor": null
    }
  }
}
```

### 9. GET `/screens/tower`

예시는 해당 fixture에서 집계 모수3명이 승인되었다고 가정한 3600초/3=1200초 계산이다. 운영 분모·가입 처리 정책을 채택한 것이 아니다.

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "memberRankings": {
      "eligibility": "eligible",
      "items": [
        {
          "rank": 1,
          "userId": "019f16a0-0000-7000-8000-000000000001",
          "name": "수빈",
          "catColor": "black",
          "focusSeconds": 1320
        },
        {
          "rank": 2,
          "userId": "019f16a0-0000-7000-8000-000000000002",
          "name": "민지",
          "catColor": "ginger",
          "focusSeconds": 1200
        },
        {
          "rank": 3,
          "userId": "019f16a0-0000-7000-8000-000000000003",
          "name": "수아",
          "catColor": "gray",
          "focusSeconds": 1080
        }
      ],
      "myRank": 1,
      "nextCursor": null,
      "asOf": "2026-09-11T09:10:00Z"
    },
    "islandRankings": {
      "items": [
        {
          "rank": 1,
          "islandId": "019f16a0-0000-7000-8000-000000000010",
          "name": "소다 섬",
          "averageFocusSeconds": 1200
        }
      ],
      "nextCursor": null,
      "asOf": "2026-09-11T09:10:00Z"
    }
  }
}
```

### 10. GET `/screens/explore`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islands": {
      "items": [
        {
          "id": "019f16a0-0000-7000-8000-000000000010",
          "name": "소다 섬",
          "intro": "각자의 속도로 집중해요",
          "visibility": "public",
          "approvalRequired": false,
          "memberCount": 3,
          "membershipStatus": "active",
          "growthStage": "02-notice-board",
          "themeId": "default",
          "joinRequestId": null
        }
      ],
      "nextCursor": null
    },
    "memberships": {
      "items": [
        {
          "id": "019f16a0-0000-7000-8000-000000000010",
          "name": "소다 섬",
          "intro": "각자의 속도로 집중해요",
          "visibility": "public",
          "approvalRequired": false,
          "memberCount": 3,
          "membershipStatus": "active",
          "growthStage": "02-notice-board",
          "themeId": "default",
          "joinRequestId": null
        }
      ],
      "nextCursor": null
    }
  }
}
```

### 11. GET `/screens/visit/{islandId}`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "island": {
      "id": "019f16a0-0000-7000-8000-000000000011",
      "name": "딸기 섬",
      "intro": "각자의 속도로 집중해요",
      "visibility": "public",
      "approvalRequired": true,
      "memberCount": 3,
      "membershipStatus": "pending",
      "growthStage": "02-notice-board",
      "themeId": "default",
      "joinRequestId": "019f16a0-0000-7000-8000-000000000030"
    },
    "joinRequestAvailability": "available",
    "joinRequest": {
      "id": "019f16a0-0000-7000-8000-000000000030",
      "islandId": "019f16a0-0000-7000-8000-000000000011",
      "status": "pending",
      "version": 1
    }
  }
}
```

### 12. GET `/screens/shop`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "islandId": "019f16a0-0000-7000-8000-000000000010",
    "wallets": {
      "fish": 500,
      "villagePoints": 1500,
      "fishVersion": 4,
      "villagePointsVersion": 7
    },
    "products": {
      "items": [
        {
          "id": "rain",
          "title": "오두막의 빗소리",
          "kind": "audio",
          "price": 30,
          "currency": "village_points",
          "owned": false,
          "available": true,
          "reason": null,
          "ownerType": "island",
          "productVersion": 5
        }
      ],
      "nextCursor": null
    },
    "sharedInventory": {
      "audio": [
        "waves",
        "campfire",
        "forest-wind"
      ],
      "islandThemes": [
        "soda-theme"
      ],
      "buildingThemes": [
        {
          "buildingId": "hall",
          "themeId": "strawberry-roof"
        }
      ],
      "inventoryVersion": 3,
      "appearance": {
        "islandThemeId": "default",
        "buildingThemes": {
          "hall": "default",
          "board": "default",
          "tower": "default",
          "mail": "default",
          "gram": "default",
          "shop": "default"
        },
        "version": 8
      }
    }
  }
}
```

### 13. GET `/screens/boat`

```json
{
  "data": {
    "asOf": "2026-09-11T09:10:00Z",
    "me": {
      "id": "019f16a0-0000-7000-8000-000000000001",
      "name": "수빈",
      "catColor": "black",
      "linkedProviders": [
        "apple"
      ],
      "onboardingComplete": true
    },
    "inventory": {
      "clothes": [
        "scarf"
      ],
      "decor": [
        "flag"
      ],
      "hulls": [
        "raft",
        "sailboat"
      ],
      "equipped": {
        "clothes": "scarf",
        "decor": "flag",
        "hull": "sailboat",
        "position": "front",
        "version": 4
      },
      "inventoryVersion": 2
    }
  }
}
```

## 3. Data 제공자와 처리 순서

### 단일 read-model 제공자

**A9 예외의 범위:** [아키텍처 A9](../../architecture/decisions.md)의 기본은 정규 리소스와 `ids` 배치다. 기술 결정 D42는 아래 13개 화면에서 적용되는 R 재료와 현재 인가를 같은 DB snapshot으로 읽는 접근 패턴에 한해 원자 read-model을 채택했다. 단순 새 화면·필드 조합만으로 내부 API를 늘리는 일반 허가는 아니다. 기존 query 모듈을 단일 Data TX 안에서 재사용하고, 아래 정확 GET 경로 외 추가·변경은 원자 조회 필요성과 A9 예외 범위를 다시 검토한다. Business의 화면 DTO·N 상태 매핑 책임과 공개 도메인 GET은 유지한다.

Business 화면 usecase는 필터가 검증한 subject/자격과 서버 requestId를 받고, **currentcontext 조회 전에** `ScreenComposer.start`로 전체 deadline을 시작한다. 기존 InternalHttpClient를 통해 화면별R read-model 한 개를 부른다.13개 내부 GET 경로를 다음처럼 제안하며 아직 존재하는 endpoint라고 주장하지 않는다.

| 공개 화면 | 내부 GET 제안 | 같은 Data snapshot에서 읽을 모듈 |
| --- | --- | --- |
|home|`/internal/screen-read-models/home`|사용자/current/session,섬상태·외양버전,집중일합|
|travel|`/internal/screen-read-models/travel/{islandId}`|목적지활성소속·섬상태·외양버전,조건부재생|
|focus|`/internal/screen-read-models/focus`|사용자/current/session,focus주민·watermarks,조건부재생|
|sound|`/internal/screen-read-models/sound`|현재 섬gram,공동보유음원·외양,재생|
|rest|`/internal/screen-read-models/rest`|사용자/current/session,rest주민·watermarks|
|hall|`/internal/screen-read-models/hall`|현재 섬hall,동일기간/scope의집중·측정집계|
|island-manage|`/internal/screen-read-models/island-manage`|현재role·섬·주민,host일때신청목록|
|board|`/internal/screen-read-models/board`|현재board,퀘스트summary와공지목록|
|tower|`/internal/screen-read-models/tower`|현재tower/참가,동일주/관측시각의주민·섬순위snapshot|
|explore|`/internal/screen-read-models/explore`|현재tower검색,공개결과·본인소속bulk조인|
|visit|`/internal/screen-read-models/visit/{islandId}`|공개whitelist·본인joinRequestId/상태|
|shop|`/internal/screen-read-models/shop`|현재shop,두지갑·상품publication/owned·공동보유|
|boat|`/internal/screen-read-models/boat`|본인프로필·보유/장착;현재 섬검사없음|

내부 endpoint는 기존 service credential과 business caller의 정확 method/path allowlist를 사용한다. 임의 `/internal/**` 권한을 늘리지 않는다. `X-User-Id`는 검증 subject에서만 생성하고 사용자 원시 헤더를 복사하지 않는다. session/authGeneration proof는1757의 검증·직렬화 계약을 재사용하며 없는 claim을0/null로 통과시키지 않는다. 구체 legacy세션 승격/자격연결이 완료되지 않았으면 BG07로닫는다. 인증에 필요한 proof를URL/query에 넣거나 GET body로 우회하지 않는다.

Data는 단일 SELECT 또는 REPEATABLE READ의 일관된 snapshot에서 다음을 처리한다.

1. service caller와 위임 subject/proof를 검증한 뒤 현재 계정 활성·세션/세대·현재 섬을 읽는다. 현재 섬이필수인화면만 이를요구한다. travel/visit은명시대상을사용한다.
2. 활성 membership·역할·시설·세션의고정islandId를 검사한다. current/session이모순되면 STATE_CONFLICT 또는현재인가오류로끝내며다른섬재료를붙이지않는다.
3. 같은 snapshot의도메인상태에서N을결정하고N조각은query자체를생략한다. 데이터가늦거나정책이미정이라는이유로N을고르지않는다.
4. 적용되는R재료를각 도메인 query모듈의bulk조회로읽는다. DB하나의TX에서query모듈을호출하고자기자신에게HTTP를보내지않는다. 주민/상품/공지/퀘스트마다GET하는N+1금지다.
5. 같은 asOf를순수ACTIVE계산·처음생성한기록/랭킹snapshot의anchor로사용하고각resource version·watermark를실제행에서읽는다. 이미 저장된재생effectiveAt/측정updatedAt을덮지않는다.
6. 인가된공개 DTO와정합성을검증해반환한다. Business도필수 필드/자원식별자/가용상태/버전타입/전체 deadline을확인한후data로감싼다.

인가철회와직렬화가필요한lifecycle/session/membership조회는기존 공통 잠금 순서를지킨다. PostgreSQL의DB READ ONLY TX에서 `FOR SHARE/UPDATE`가모두허용된다고가정하지 않는다. 필요한 경우SQL잠금을허용하는TX설정을쓰되 **이 usecase는업무상태를변경하지않는논리 읽기**로제한하고조회/잠금만수행한다. 사용자→세션/현재 context→섬/멤버십→도메인조회순서를writer와대조하며그룹잠금뒤새 사용자잠금을역순으로잡지않는다. 실제read-model회귀에서logout/강퇴/위임경합을검증한다.

장시간HTTP사이에DB TX를열어두지않는다. 도메인 cursor가필요한불변snapshot은한 DB읽기에서계산한결과를자체조회projection/cache로발행한다. 이것은순수 조회재현용이며원장·세션전이·명령receipt·도메인outbox를쓰지 않는다. BFF별새snapshot저장소를중복구축하지않고PR748등도메인제공자를재사용한다. snapshot의조회부수효과와실제업무명령을구분하여경제지급/정산0을검증한다.

### 왜항상2~3개HTTP를병렬로보내지않는가

1785의병렬조합은독립재료의성능방향이다. 주요재료가서로같은 snapshot이어야하면내부 GET하나가정확한구현이다. 같은requestId/asOf/deadline을붙인별도HTTP는각자DB TX를열어홈의완료+진행,상점의차감후잔액+차감전owned,위임뒤host목록을섞을수있다. Business `@Transactional`로다른서비스DB TX를합칠수없다.

향후독립O를정의하면ScreenComposer로별도병렬화하되동일인가/대상proof·시간차허용·공개실패상태를함께개정한다. 하나의DB TX가SQL오류로abort된뒤그조각만null로꾸며나머지를성공처리하지 않는다. 초기 13개는R read-model묶음과검증N뿐이며가장느린하위HTTP시간과응답시간이항상같다는성능약속을하지 않는다.

## 4. 권한·개인정보·상태 충돌

- **home/current없음**: IM-D06 미결복구를새로선택하지 않는다. 자동첫소속·섬생성·discover호출금지다. 현재 섬이필수아닌boat/공개visit까지차단하는전역guard도금지다.
- **travel**: 원래출발섬과목적지경로를구분한다. GET은switch하지 않는다. 목적지비소속은visit와다른권한이며MemberIslandDetail을공개하지 않는다.
- **focus/rest**: session=null이정상이면명시null을유지한다. focus화면에서임의세션생성,rest조회에서pause,resume/finish를하지 않는다. 집중중채팅가드를playback/CONNECT전체에적용하지 않는다.
- **manage**: 일반주민은N으로신청조회없음. host라는과거응답/캐시를근거로현재신청자를읽지않는다. Data가403을주면BFF도전체 실패다.
- **visit**: 사용자가멤버라고upstream의MemberIslandDetail을그대로내리지않는다. publicwhitelist에초기건설기여/목표/role/개인주민/기록/채팅/지갑/다른신청자는키자체가없어야한다. joinRequest는verifiedUser+requestId+targetIsland가모두맞아야한다.
- **privatevisit**: PR741의private비소속무자격GET403을보존한다. invitationToken을query/log에노출하거나rawheader를자동복사하지 않는다. 초대resolve는별도사용자행동이며공개요약/검증읽기자격연결은BG05후속이다. 이 설계가토큰없는privateBFF예외를만들지않는다.
- **explore**: 이름검색현재tower가드와첫소속discover를구분한다. q가초대코드처럼생겨도POST resolve를GET조합기에서자동실행하지 않는다. 검색결과별membershipStatus는같은본인소속snapshot에서계산하고실패를none으로바꾸지않는다.
- **hall/tower**: scope=island는공개주민합계이지개인subject/상세기록공개권한이아니다. 원문친구/공개토글을새집계에끼워넣거나반대로legacy정책을전역으로풀지않는다. 미결랭킹eligibility를임의eligible/0점으로반환하지 않는다.
- **shop/boat**: 개인fish는본인전용이다. 공동소유/지갑과섞은응답을다른사용자에게캐시공유하지 않는다. raft는기본표시이며ownedgrant를발명하지 않는다. 원시 인벤토리나가격필드가누락되면운영샘플값으로채우지않는다.

실제변경명령은이화면 snapshot이성공했더라도원 도메인의인가/expectedVersion/유일성/가격조건을TX에서다시검사한다. BFFGET은멱등키를소비하거나새명령키를발급하지 않는다. 충돌후새버전과새키로재확정할지는사용자가선택한다.

## 5. 오류·deadline·현재 core의 활성화 조건

현재기반의 ScreenComposer는독립GET·bounded executor·완료순실패감지·공유deadline·취소를 제공한다. `start`는context조회전에호출하고R read-model한개에도같은예산을쓴다. 초기설정pool16/queue64/3초는안전상한출발값이며운영SLO실측보장이아니다. 인증·context·큐/연결/읽기·재시도중어느경계에서예산이끝나도전체504이며마지막응답직전에도검사한다.

| 결과 | 초기 13개처리 |
| --- | --- |
| 인가된N 또는명시정상null/[] | 정의된200data/state,오류로그로오인하지않음 |
| R재료일시503/조각timeout | 전체503/504. 빈조각200으로대체없음 |
| 전체 deadline소진 | 전체504 UPSTREAM_TIMEOUT,남은실제I/O·worker취소 |
| 예산남았으나큐포화 | 전체503 SERVICE_UNAVAILABLE |
| 사용자401/도메인403 | 전체원오류,현재인가복구필요 |
| 서비스credential거절 | 전체502 UPSTREAM_AUTH_FAILED,앱로그아웃유도금지 |
| 상류DTO/상태·오류계약위반 | 전체502 UPSTREAM_CONTRACT_ERROR |
|400/404/409/422/429 도메인실패|등록된공개status/code보존. 자동N/null로변환하지않음|

retryable은A0표를사용한다. 명시된409stateconflict는false, REQUEST_IN_PROGRESS는범용명령용이며BFF가새명령receipt를만들어발생시키지않는다.503/504/429는일시분류와알려진Retry-After에따라유한재조회한다.500/계약502/auth실패를무한반복하지 않는다.405/413/415/빈406도공통정본을유지한다.

**PR744후속검증 gate**: 조사시점InternalHttpClient는구조화된영구500/502를일시5xx로접을수있었고현재엄격분류수정중이다. 신규 public+composition은서버판정context로strict분류,legacy 동기 호환은별도유지한다. 앱헤더로strict/legacy를선택하게하지 않는다. 실제 TCP에서영구500/502·미지원구조화5xx·known503·부분본문/EOF가각각 계약대로 처리되고 영구·계약 실패에는 재시도/optional 축소가 없으며 알려진 일시503은 공통 한도 안에서 재시도한다는 최신 회귀가통과하기전BFF활성화하지 않는다. 이 문서에그수정/배포가끝났다고기록하지 않는다.

`required=true`는결과의nonnull/도메인불변식검증을대신하지 않는다. 기존 HTTP의빈2xx→null과정상`data:null`은adapter에서구분하고,필수 필드누락·타입 coercion·ID불일치·version범위·watermark누락·availability불일치를502로거절한다. 초 단위/정수·UUID·enum은원 도메인의strict DTO로검증한다. ReadFragment.responseType만등록하고Map을그대로신뢰하지 않는다.

## 6. 버전·실시간·페이지 복구

island.version은(island,islandId), **island.appearanceVersion은(island.appearance,islandId)의실제appearance.version**이다. 둘을비교하지않고appearance사건payload.version과appearanceVersion을비교한다. 이추가필드는1759/1783제공자통합전존재한다고가정하지않으며원본 source에는없다. 더작은외양사건을버리고더큰사건의전체buildingThemes를적용하는실제역순회귀가활성화조건이다.

focusMembers의 개인 외양은 `(member.appearance,userId)`로 비교한다. `appearanceVersion`은 해당 사용자 전체 외양의 watermark이며 다른 섬에서도 같은 개인 축이다. `focus.member` watermark나 session.version, island.appearanceVersion을 대신 쓰지 않는다. 같은 snapshot에서 외양 v10을 받으면 늦은 외양 사건 v9/v10은 버리고 v11 전체 상태만 적용한다. 이미 v11을 적용한 뒤 도착한 v10 GET/BFF 응답도 같은 연결 generation에서 개인 외양과 그 watermark를 되감지 않는다. 새 연결/섬 이동은 PR737의 connection generation에 따라 이전 요청 결과를 폐기하고 새 snapshot으로 초기화한다. 미지 주민은 인가된 주민 정본 GET으로 복구하며 본인전용 inventory API로 타인 정보를 조회하지 않는다.1765 주민 GET과1783 개인 외양 정본, BFF DTO/앱 병합에 이 필드를 함께 적용하고 누락/불일치·역순 사건·늦은 응답 회귀를 통과하기 전 focus 화면을 활성화하지 않는다.

session.version은집중세션명령축이다. focus/rest snapshot은각사용자projection의watermarks를별도로보존한다. playback.version,inventoryVersion,equipped.version,공동appearance.version,지갑별version,productVersion,request.version도각자따로비교한다. BFF전체의maxversion이나Dataoutbox전역sequence를공개낙관버전으로대체하지 않는다.

앱은현재목적지구독을설정하고사건을버퍼링한뒤BFFsnapshot을적용한다. 이후같은aggregate축의더큰version만적용하며eventId중복을제거한다. 종료tombstone/미지사용자/gap/미지원schemaVersion은PR737/743의정본GET복구를따른다. 필요하면특정조각만그도메인GET로재조회하고화면전체를무조건중복호출하지 않는다. 소속변경/만료소켓은현재인가와재접속복구를따른다.

playback.positionSeconds는effectiveAt에서의위치다. BFFasOf를effectiveAt로치환하거나이미현재위치로계산한뒤옛anchor를붙여두번더하지 않는다. durationSeconds확장과producer/validator동기화는PR746/1779선행gate이며로컬volume/mute를공유상태로바꾸지않는다.

다음페이지는해당도메인nextCursor를사용한다. 사용자/섬/기간/scope/category/limit·정렬/snapshot결합과15분만료를유지한다. focusStatistics/rankings의asOf와불변snapshot,상품catalogpublication과동적owned/available의의미차이를보존한다. 페이지변경으로다른조각의총합/분모/인가를섞지않으며도메인이첫페이지재조회요구하면기존페이지를완성된snapshot처럼합치지않는다.

## 7. 캐시·로그·구현 검증

13개응답은TTL0/no-store다. 불변catalogpublication/asset/media메타데이터·도메인15분cursor snapshot은내부정본규칙으로재사용할수있지만현재인가/소속/시설검사를생략하지 않는다. 개인wallet/profile/records·host신청목록이결합된전체응답을공용CDN캐시로보내지않는다. no-store와서버snapshotPII파기는다른의무이며탈퇴/권한상실의역색인·무효화·CURSOR_EXPIRED복구를연결한다.

로그는서버requestId,screen13종,context검증단계,read-model이름,phase/outcome/durationMs,timeout/cancel과하위도메인추적식별자의허용된연결만남긴다. JWT/서비스token/원시 헤더·query/cursor/초대token·전체payload·개인과목/신청자목록은남기지않는다. metric label은화면/단계/결과의유한집합이고사용자/섬/요청ID를label로쓰지 않는다. N은`not_applicable`의정상처리로계측하고실제403·일시실패와구분한다.

구현순서:

1. 각 도메인의미결정책/typed공개 DTO·현재session/context/물리aggregate를완료한다. source22개GET를기계적인alias로만들지않는다.
2. Data화면 read-model13종과query모듈재사용·정확GETallowlist·lifecycle인가·단일 snapshot을구현한다. 원 도메인 public endpoint를HTTP재호출하지 않는다.
3. PR744strict5xx·취소/queue회귀를확인하고Business1785/1786/1787의typedDTO와R/N응답매퍼를연결한다. Controller/registry/공통조합기소유중복을조정한다. PR744의 `/screens` ingress 설정도 통합하고 실제 배포 구성에서 무접두 URI가 Business에 도달하는지 BG08을 검증한다.
4. 앱에N상태·watermark/기존도메인 cursor복구를연결하고BFF후즉시중복GET를제거한다. 사용자쓰기 행동은기존API로유지한다.
5. 실제 HTTP·PostgreSQL·WebSocket/부하에서아래케이스를검증한후화면별활성화한다.

| 실제검증 | 실패를찾는지점 |
| --- | --- |
|실제 ingress의 `/screens`·하위 URI/쿼리 보존, `/screens-other` 제외·내부 경로 차단|Nginx 미연결·잘못된 prefix 재작성·내부 노출|
|13화면정상·각R실패·N미호출조회횟수|누락재료·권한없는query실행·오류null축소|
|영구500/502·known503·403부분본문·빈200/204·깨진DTO|strict분류·실제null의미·조기전체 실패|
|전체 deadline/큐포화/형제작업취소·연결반환|초과뒤200·유휴worker/소켓누수|
|home/focus/rest와finish/pause/switch경합|ACTIVE중복/휴식가산·다른섬session혼합|
|manage와위임/강퇴,visit회원/비회원/타인request/private|신청자PII·민감키누출·권한403을N으로숨김|
|shop구매중wallet/owned/inventory,boat현재 섬없음|불일치snapshot·가짜잔액/보유·불필요시설강제|
|hall기간/timezone/scope·towerasOf/cohort/분모|개인records누출·페이지합중복·랭킹정책가정|
|섬/집중 주민 appearanceVersion 각 정본·개인 v10 snapshot 뒤 v9/v11 사건·v11 적용 뒤 늦은 v10 응답·focus/restwatermarks·playbackanchor|잘못된축비교·누락된초기버전·시간이중가산|
|원 도메인 cursor다음페이지·15분만료·PII파기·scope변조|BFF전용cursor위장·옛권한재생|
|주민/상품/퀘스트수가늘어도HTTP횟수고정|서버N+1·최초화면중복재조회|
|GET/재조회/cache복구 전후원장·세션·receipt·outbox|경제지급/구매/건설/종료부수효과0|

문서작성에서위서비스테스트를실행하거나성공했다고주장하지 않는다. 문서검증은원본hash/22개재료·13개매핑,13개JSON예시,로컬링크/fence정합으로한정한다.

## 8. 실제 코드 근거와 미구현 경계

- [ScreenComposer:47~49](https://github.com/OneOrThree/phone/blob/2e11b50b4/server/business-api/src/main/java/com/oneorthree/business/common/http/ScreenComposer.java#L47):현재 context조회전전체 예산시작.52~115는bounded조합/취소,119~135는optional예외분류. 이클래스가화면 13개나DBsnapshot을구현했다는뜻은아니다.
- [UpstreamRequestContext:20~24/89~96](https://github.com/OneOrThree/phone/blob/2e11b50b4/server/business-api/src/main/java/com/oneorthree/business/common/http/UpstreamRequestContext.java#L20):subject/deadline/취소/GET-only는있지만currentIslandId·역할·시설·sessionproof는BFF도메인context가별도로검증해야한다.
- [ReadFragment:10~22](https://github.com/OneOrThree/phone/blob/2e11b50b4/server/business-api/src/main/java/com/oneorthree/business/common/http/ReadFragment.java#L10):responseType등록은strict필드검증이아니다.
- [기준HTTP:233~288](https://github.com/OneOrThree/phone/blob/2e11b50b4/server/business-api/src/main/java/com/oneorthree/business/common/http/InternalHttpClient.java#L233):빈2xx/기존5xx분류한계를이번문서가완료구현으로포장하지 않는다. 최신보완은[PR744](https://github.com/OneOrThree/phone/pull/744)의별도검증gate다.

- [PR744 ingress 설정](https://github.com/OneOrThree/phone/blob/a0a621f1ad587048806849f3942b623da7c96fbd/server/scripts/nginx-satellites.include.conf.example#L26): `/screens` 정확 루트·하위를 Business에 연결하고 URI를 재작성하지 않는다. [실제 Nginx 회귀](https://github.com/OneOrThree/phone/blob/a0a621f1ad587048806849f3942b623da7c96fbd/.github/scripts/test_public_api_ingress.py#L129)는 루트/하위/쿼리 보존과 유사 접두어 제외·내부 차단을 검증하는 기반이다. 이 예시 파일의 존재를 운영 Nginx에 적용됐다는 증거로 쓰지 않으며 BG08은 별도 배포 검증이다.

기준main529a와core의차이,선행도메인PR문서와실제배포상태를구분한다. public route패턴에/screens가등록되어있어도이문서의13개endpoint가이미동작한다는증거는아니다.
