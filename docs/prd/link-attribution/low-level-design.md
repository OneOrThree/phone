# 링크·어트리뷰션 상세 설계

[정책](policy.md)의 결정을 테이블·API·판정 규칙으로 옮긴다. 기준 main `875a9fd89`, PR #745 는 head `37db435d1` 을 봤다. 날짜의 타임존 축은 [날짜 축 규약](../../conventions/date-axis.md)의 KST 고정을 따르고, 기간 `from`~`to` 를 시각 구간 `[from 00:00, to+1일 00:00)` KST 로 바꾸는 규칙은 이 설계가 정한다.

## 1. 데이터 모델

### 1.1 마이그레이션 — expand / contract

prod 는 `spring.jpa.hibernate.ddl-auto: validate`(`application-prod.yml`)라 엔티티가 보는 테이블이 없으면 이미지가 기동을 거부한다. 한 번에 rename 하면 이전 이미지로 되돌릴 수 없으므로 **두 파일로 나눈다.** 데이터 이관은 없다.

| 단계 | 파일 | 내용 | 이전 이미지로 롤백 |
| --- | --- | --- | --- |
| expand ([HLD §7](high-level-design.md#7-배포-순서) 2단계) | 구현 시점 최대 번호 다음(#745 가 V51·V52 를 쓰므로 V53 이상, 열린 PR 번호까지 확인) | **기존 테이블 이름 그대로** 컬럼·제약·인덱스 추가, 신설 3개. rename·DROP 없음 | 가능. 이전 엔티티가 보는 테이블·컬럼이 그대로 있다 |
| contract (HLD §7 5단계) | 그다음 번호 | rename 2개 + V52 링크 테이블 5개 DROP | 불가. 아래 복구 SQL 로 스키마를 되돌린 뒤 롤백 |

이 문서는 개념 이름으로 최종 이름(`links`·`link_clicks`)을 쓴다. expand 부터 contract 전까지 물리 이름은 `group_invite_links`·`invite_link_clicks` 이고, 그 기간의 엔티티는 `@Table` 로 옛 이름을 가리킨다. 아래 expand DDL 은 물리 이름으로 적는다.

```sql
-- contract — 전환 뒤 7일 무사고 · 구 경로 호출 0 확인 뒤
ALTER TABLE public.group_invite_links RENAME TO links;
ALTER TABLE public.invite_link_clicks RENAME TO link_clicks;
-- V52 링크 테이블: 다섯 테이블 행 수가 모두 0 인지 먼저 확인한다. 0 이 아니면 멈추고 보고한다
DROP TABLE public.invite_claim_confirmations, public.invite_claim_intents,
           public.invite_click_frozen_rows, public.invite_link_frozen_rows, public.invite_click_migrations;
```

```sql
-- contract 복구 — 이 SQL 을 실행한 뒤 이전 이미지로 롤백한다
ALTER TABLE public.links       RENAME TO group_invite_links;
ALTER TABLE public.link_clicks RENAME TO invite_link_clicks;
-- V52 링크 테이블은 비어 있었으므로 #745 의 V52 파일에서 해당 CREATE TABLE·INDEX 문을 다시 실행한다
```

### 1.2 `campaigns` (신설)

```sql
CREATE TABLE public.campaigns (
    id                     uuid         PRIMARY KEY,
    name                   varchar(80)  NOT NULL,
    channel                varchar(16)  NOT NULL CHECK (channel IN ('ORGANIC', 'META', 'GOOGLE')),
    platform               varchar(8)   NOT NULL CHECK (platform IN ('IOS', 'ANDROID', 'ALL')),
    external_id            varchar(64),   -- Meta campaign_id. Android referrer 복호화 결과와 읽기 시점에 대조
    skan_source_identifier varchar(4),    -- 광고 네트워크가 대응을 알려준 경우만 (정책 L07)
    status                 varchar(16)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by             varchar(32)  NOT NULL,   -- 콘솔 슬롯 이름
    created_at             timestamptz  NOT NULL DEFAULT now(),
    updated_at             timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_campaigns_external CHECK (external_id IS NULL OR channel = 'META'),
    CONSTRAINT ck_campaigns_skan     CHECK (skan_source_identifier IS NULL OR (channel IN ('META', 'GOOGLE') AND platform IN ('IOS', 'ALL')))
);
CREATE UNIQUE INDEX uq_campaigns_external ON public.campaigns (external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_campaigns_skan     ON public.campaigns (channel, skan_source_identifier) WHERE skan_source_identifier IS NOT NULL;
```

### 1.3 `links` (expand 동안 물리 이름 `group_invite_links`)

```sql
ALTER TABLE public.group_invite_links
    ADD COLUMN type          varchar(16)  NOT NULL DEFAULT 'INVITE' CHECK (type IN ('INVITE', 'CAMPAIGN')),
    ADD COLUMN campaign_id   uuid         REFERENCES public.campaigns (id),
    ADD COLUMN destination   varchar(200),
    ADD COLUMN status        varchar(16)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    ADD COLUMN revoked_at    timestamptz,
    ADD COLUMN revoke_reason varchar(32),
    ALTER COLUMN group_id   DROP NOT NULL,
    ALTER COLUMN inviter_id DROP NOT NULL;

ALTER TABLE public.group_invite_links ADD CONSTRAINT ck_links_type_shape CHECK (
       (type = 'INVITE'   AND group_id IS NOT NULL AND inviter_id IS NOT NULL AND campaign_id IS NULL     AND destination IS NULL)
    OR (type = 'CAMPAIGN' AND group_id IS NULL     AND inviter_id IS NULL     AND campaign_id IS NOT NULL AND destination IS NOT NULL));
ALTER TABLE public.group_invite_links ADD CONSTRAINT ck_links_revoked CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL));

-- V21 의 전체 unique 를 「active INVITE 1개」 부분 unique 로 바꾼다 (그룹 획득 LLD §2.1)
ALTER TABLE public.group_invite_links DROP CONSTRAINT uq_invite_links_group_inviter;
CREATE UNIQUE INDEX uq_links_invite_active ON public.group_invite_links (group_id, inviter_id) WHERE type = 'INVITE' AND status = 'ACTIVE';
CREATE INDEX idx_links_campaign ON public.group_invite_links (campaign_id) WHERE campaign_id IS NOT NULL;
```

- 기존 행은 전부 `type=INVITE`·`status=ACTIVE` 가 된다. 이전 이미지는 새 컬럼을 모르고 기본값으로 INVITE·ACTIVE 행만 만들므로, 부분 unique 가 기존 멱등 발급의 최후 방어선 역할을 그대로 한다.
- `revoke_reason`: `MEMBER_LEFT` · `MEMBER_KICKED` · `ACCOUNT_WITHDRAWN` · `GROUP_CLOSED`(INVITE, 그룹 획득 문서의 전이) · `CONSOLE`(CAMPAIGN).
- 폐기 트리거·잠금 순서·재발급은 [그룹 획득 LLD §2.1](../group/features/01-acquisition/low-level-design.md) 이 정본이다. 이 마이그레이션은 그 규칙을 담을 자리만 만든다.

### 1.4 `link_clicks` (expand 동안 물리 이름 `invite_link_clicks`)

expand 에선 바꾸지 않고 contract 에서 rename 만 한다. 컬럼·인덱스(`idx_invite_clicks_match` · `idx_invite_clicks_link` · `idx_invite_clicks_device`)는 그대로다. Referrer 설치는 링크가 없을 수 있어 이 테이블에 넣지 않는다(§1.5).

### 1.5 `install_referrers` (신설 — Android)

```sql
CREATE TABLE public.install_referrers (
    id                uuid          PRIMARY KEY,
    install_key       varchar(96)   NOT NULL,   -- deviceId + ":" + 설치 시작 시각(초). §2.4-1
    device_id         varchar(64)   NOT NULL,
    app_instance_id   varchar(64),
    referrer_raw      varchar(2048) NOT NULL,
    source            varchar(16)   NOT NULL CHECK (source IN ('LINK', 'META', 'GOOGLE', 'ORGANIC', 'UNKNOWN')),
    link_id           uuid          REFERENCES public.group_invite_links (id),
    click_id          uuid          REFERENCES public.invite_link_clicks (id),
    gclid             varchar(256),
    meta_campaign_id  varchar(64),
    meta_payload      jsonb,
    decrypt_failed    boolean       NOT NULL DEFAULT false,
    referrer_click_at timestamptz,
    install_begin_at  timestamptz,
    install_version   varchar(64),
    received_at       timestamptz   NOT NULL DEFAULT now(),
    claimed_user_id   uuid,
    claimed_at        timestamptz,
    CONSTRAINT ck_ir_link    CHECK ((source = 'LINK') = (link_id IS NOT NULL)),
    CONSTRAINT ck_ir_click   CHECK (click_id IS NULL OR link_id IS NOT NULL),
    CONSTRAINT ck_ir_meta    CHECK ((meta_campaign_id IS NULL AND meta_payload IS NULL) OR source = 'META'),
    CONSTRAINT ck_ir_gclid   CHECK (gclid IS NULL OR source = 'GOOGLE'),
    CONSTRAINT ck_ir_claimed CHECK (claimed_user_id IS NULL OR claimed_at IS NOT NULL)
);
CREATE UNIQUE INDEX uq_install_referrers_install ON public.install_referrers (install_key);
CREATE INDEX idx_install_referrers_device ON public.install_referrers (device_id);
CREATE INDEX idx_install_referrers_link   ON public.install_referrers (link_id, (COALESCE(install_begin_at, received_at))) WHERE link_id IS NOT NULL;
CREATE INDEX idx_install_referrers_meta   ON public.install_referrers (meta_campaign_id, (COALESCE(install_begin_at, received_at))) WHERE meta_campaign_id IS NOT NULL;
CREATE INDEX idx_install_referrers_source ON public.install_referrers (source, (COALESCE(install_begin_at, received_at)));
```

- FK 는 contract 의 rename 을 따라간다.
- **설치 단위는 `install_key`** 다. 앱은 `android:allowBackup="true"`(`AndroidManifest.xml`)라 Auto Backup 이 `deviceId` 와 완료 플래그를 재설치 뒤에도 복원할 수 있다. 기기 단위로 멱등을 잡으면 다른 광고로 재설치한 설치가 과거 귀속에 묻힌다. 재설치는 새 설치 행이다.
- **캠페인 귀속은 읽기 시점에 한다.** LINK 는 `links.campaign_id`, META 는 `campaigns.external_id = meta_campaign_id`, GOOGLE 은 채널만. 콘솔에서 Meta 캠페인을 늦게 등록해도 그 전에 들어온 설치가 붙는다.
- `claimed_at` 은 탈퇴로 `claimed_user_id` 가 지워져도 남는다(가입 수 집계용).

### 1.6 `skan_postbacks` (신설 — iOS)

```sql
CREATE TABLE public.skan_postbacks (
    id                      uuid         PRIMARY KEY,
    transaction_id          varchar(128) NOT NULL,
    version                 varchar(8)   NOT NULL,
    ad_network_id           varchar(64)  NOT NULL,
    app_id                  bigint       NOT NULL,
    source_identifier       varchar(4),    -- 4.0 의 source-identifier, 3.0 이하는 campaign-id 를 문자열로
    source_app_id           bigint,
    source_domain           varchar(255),
    fidelity_type           smallint,
    redownload              boolean,
    did_win                 boolean,
    postback_sequence_index smallint,
    conversion_value        smallint,
    coarse_conversion_value varchar(8),
    raw                     jsonb        NOT NULL,
    received_at             timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_skan_postbacks_tx ON public.skan_postbacks (transaction_id, COALESCE(postback_sequence_index, 0));
CREATE INDEX idx_skan_postbacks_received ON public.skan_postbacks (received_at);
```

**서명 검증을 통과하고 우리 앱의 것인 포스트백만 저장한다**(§4.2). 기기·유저 식별자 컬럼이 없다. 캠페인 귀속은 §2.6 규칙으로 읽기 시점에 한다.

### 1.7 엔티티·패키지

`com.oneorthree.phone.invitelink` 를 `com.oneorthree.phone.link` 로 옮긴다. `GroupInviteLink` → `Link`, `InviteLinkClick` → `LinkClick`, 신규 `Campaign` · `InstallReferrer` · `SkanPostback`. expand 부터 contract 전까지 `Link`·`LinkClick` 은 `@Table(name = "group_invite_links")`·`@Table(name = "invite_link_clicks")` 이고, contract 이미지에서 `@Table` 을 최종 이름으로 바꾼다. 공개 컨트롤러(`LinkPublicController` · `WellKnownController` · `InviteLinkController`)는 [HLD §7](high-level-design.md#7-배포-순서) 5단계까지 남긴다.

## 2. 판정 규칙 (data-api)

### 2.1 활성 판정

| 링크 | 활성 조건 |
| --- | --- |
| INVITE | `status=ACTIVE` + 그룹 활성(현행 `findActiveGroup`) + 그룹 획득 문서의 발급자 조건 |
| CAMPAIGN | `status=ACTIVE` + 캠페인 `status=ACTIVE` |

활성이 아닌 링크는 클릭을 기록하지 않고, 매치·referrer·claim 의 대상이 되지 않는다(정책 L14).

### 2.2 방문 (`visits`)

활성이면 `link_clicks` 에 한 행을 넣고(`ip_hash = SHA-256(ip + LINK_IP_SALT)`, 현행 `IpHasher`) `LandingView` 에 **그 클릭의 id 를 `clickId` 로** 담아 돌려준다. business-api 는 DB 를 읽지 않으므로 Android 스토어 버튼의 `click` 파라미터(§4.4)는 이 값으로만 만들 수 있다. 비활성이면 행 없이 `state=EXPIRED`·`clickId=null` 뷰를 돌려준다. 없는 slug 는 404.

### 2.3 fingerprint 매치

현행 `InviteLinkMatchService` 를 그대로 쓴다(`ip_hash + os + LINK_MATCH_WINDOW_HOURS`, `PESSIMISTIC_WRITE` + `SKIP LOCKED`, 기기별 기존 매치 재반환). 후보 필터에 §2.1 활성 판정만 더한다. 응답에 `type` 과, CAMPAIGN 이면 `destination` 을 싣는다.

### 2.4 Install Referrer 저장

1. `install_key = deviceId + ":" + 설치 시작 초`. 설치 시작 초는 Play 의 `installBeginTimestampServerSeconds` 를 우선하고, 없으면 `installBeginTimestampSeconds`, 둘 다 없으면 `0` 이다. **같은 `install_key` 행이 있으면 그 행을 그대로 돌려준다**(`uq_install_referrers_install` 충돌 시 재조회). 설치 시작 시각이 다르면 재설치로 보고 새 행을 만든다.
2. `source=LINK` 로 들어왔는데 slug 가 활성 링크가 아니면 `source=UNKNOWN`, `link_id=NULL` 로 저장한다(정책 L14).
3. `source=LINK` 이면 `click_id` 를 아래 순서로 정한다. 한 설치가 fingerprint 와 referrer 양쪽에 잡히지 않게 하려는 규칙이다.
   1. 전달된 `clickId` 가 그 링크의 **미매치** 클릭이면 그 클릭을 `PESSIMISTIC_WRITE` 로 잠가 `matched=true`·`matched_at`·`matched_device_id`·`app_instance_id` 를 채우고 `click_id` 로 둔다. 같은 클릭이 fingerprint 로 다른 기기에 다시 매치되지 않는다.
   2. 아니면(전달값 없음 · 이미 매치됨 · 다른 링크의 클릭) **같은 링크에서 이미 이 `deviceId` 로 매치된 클릭**이 있으면 그 클릭을 `click_id` 로 둔다. 레이스로 `/l/match` 가 먼저 성공한 경우다.
   3. 둘 다 아니면(다른 기기에 매치된 클릭뿐) `click_id=NULL` 로 저장만 한다. 그 클릭은 별개 설치다.

   referrer 가 먼저 오고 `/l/match` 가 뒤에 오면, 매치는 현행 「기기별 기존 매치 재반환」으로 1-i 에서 소진된 클릭을 돌려줄 뿐 새 클릭을 소진하지 않는다.
4. 응답 `ReferrerResult` 는 `attributionId`·`source` 에 `MatchResult` 와 같은 필드(`matched`·`type`·`slug`·INVITE 면 `groupId`·CAMPAIGN 이면 `destination`)를 싣는다. `matched` 는 **활성 링크로 귀속된 LINK 일 때만** `true` 다. INVITE 링크를 거친 Android 설치는 `/l/match` 를 건너뛰므로(정책 L12) `groupId` 가 빠지면 앱이 초대 시트를 열 수 없다. META·GOOGLE 은 `matched=false` 지만 앱은 `source` 로 fingerprint 생략을 판단한다.

### 2.5 claim

모든 claim 은 트랜잭션 첫 조회로 **요청 유저의 활성 행을 공유 락**(`FOR SHARE`)으로 잡고, 없으면 no-op 200 으로 끝낸다. 탈퇴(`AccountWithdrawalService.withdraw`)는 `getCallerForUpdate` 로 같은 행을 배타 락으로 잡으므로, claim 은 탈퇴 커밋 뒤에 조건을 재평가해 빈 결과가 된다(`UserRepository` 의 활성 유저 공유 락 조회와 같은 방식). 이렇게 해야 §2.7 의 두 UPDATE 뒤·커밋 전에 끼어든 claim 이 `claimed_user_id` 를 남기지 않는다.

요청은 `slug` 또는 `attributionId` 중 정확히 하나를 싣는다.

| 입력 | 규칙 | 응답 |
| --- | --- | --- |
| `slug` (INVITE) | 현행 그대로: 그 링크의 가장 최근 `matched=true`·미claim 클릭에 붙인다. `deviceId` 가 오면 `matched_device_id` 가 같은 클릭을 먼저 찾는다. 셀프 초대·이미 claim·REVOKED 등 비활성 링크(§2.1)는 no-op | 200. 없는 slug 는 현행 `SLUG_NOT_FOUND`(404) 유지 |
| `slug` (CAMPAIGN) | `deviceId` **필수**. `matched_device_id = deviceId` 인 미claim 클릭에만 붙인다. 없으면 no-op | 200 |
| `attributionId` | `install_referrers.id = attributionId` 이고 `device_id = deviceId` 이고 `claimed_user_id IS NULL` 일 때만 붙인다. 그 밖엔 no-op | 200 |

캠페인 링크 클릭은 많아서, 기기를 보지 않는 현행 규칙을 쓰면 다른 사람의 클릭에 붙는다. 캠페인 링크를 아는 앱은 새 파서를 가진 앱뿐이라 `deviceId` 필수가 구 앱을 깨지 않는다.

### 2.6 SKAN 귀속 (읽기 시점)

1. **채널**: `ad_network_id` 를 코드 상수 레지스트리(`SkanAdNetworks`)로 META · GOOGLE 에 대응시킨다. 없는 값은 `UNKNOWN`.
2. **캠페인**: 그 채널에서 `campaigns.skan_source_identifier` 가 포스트백 `source_identifier` 와 같으면 그 캠페인이다. 크라우드 익명성이 낮으면 Apple 은 source-identifier 의 **끝자리(least significant digits)** 2~3자리만 보낸다 — 예를 들어 `5239` 는 `39` 또는 `239` 로 온다. 그래서 포스트백 자릿수가 더 적으면 **등록 값의 끝자리가 일치하는 캠페인이 정확히 하나일 때만** 귀속하고, 둘 이상이면 채널 단위로 남긴다.
3. 저장된 행은 모두 서명 검증을 통과한 우리 앱의 포스트백이다(§4.2).

### 2.7 탈퇴

`UserService.erasePersonalData` 를 부르기 **전에**(그 메서드는 영속성 컨텍스트를 비우는 탈퇴 절차의 마지막이다) 같은 트랜잭션에서 두 벌크 UPDATE 를 실행한다. 이 트랜잭션은 시작부터 유저 행 배타 락을 쥐고 있어 §2.5 의 claim 과 직렬화된다.

```sql
UPDATE public.invite_link_clicks SET claimed_user_id = NULL WHERE claimed_user_id = :userId;  -- contract 뒤 link_clicks
UPDATE public.install_referrers  SET claimed_user_id = NULL WHERE claimed_user_id = :userId;
```

INVITE 링크 폐기(`ACCOUNT_WITHDRAWN`)는 그룹 획득 문서의 멤버십 전이와 같은 트랜잭션에서 한다.

## 3. 내부 API (data-api `/internal/*`)

호출 규약은 #745 의 business → data 내부 호출을 따른다: `Authorization: Bearer ${SVC_TOKEN_BIZ_TO_DATA}`, `X-Request-Id`, 사용자 위임 호출은 `X-User-Id`, 콘솔 호출은 `X-Actor: console:<slot>`. 경로는 수신 측 허용목록(`internal.api.callers.business.allow`)에 하나씩 추가한다. 와일드카드로 묶지 않는다.

| 메서드·경로 | 호출자 | 요청 | 응답 |
| --- | --- | --- | --- |
| `POST /internal/links/{slug}/visits` | 랜딩 | `{clientIp, os, userAgent, refererHost}` | 200 `LandingView` · 404 |
| `GET /internal/links/{slug}` | `/l/resolve` | — | 200 `LinkView` · 404 |
| `POST /internal/links/match` | `/l/match` | `{os, deviceId, appInstanceId, clientIp}` | 200 `MatchResult` |
| `POST /internal/install-referrers` | `/l/referrer` | 아래 | 200 `ReferrerResult` |
| `POST /internal/links/claims` | claim · `X-User-Id` | `{slug}` 또는 `{slug, deviceId}` 또는 `{attributionId, deviceId}` | 200 · 404 `SLUG_NOT_FOUND`(INVITE slug 만) |
| `POST /internal/groups/{groupId}/invite-links` | 초대 발급 · `X-User-Id` | 없음 | 200 `{slug, url}` (현행 `IssueInviteLinkResponse`) |
| `POST /internal/skan-postbacks` | SKAN 수신 | 아래 | 201 신규 · 200 중복 |
| `GET /internal/campaigns?status=` | 콘솔 | — | 200 `[CampaignSummary]` |
| `POST /internal/campaigns` | 콘솔 | `{name, channel, platform, externalId?, skanSourceIdentifier?}` | 201 · 409 `CAMPAIGN_EXTERNAL_ID_TAKEN` · 409 `CAMPAIGN_SKAN_ID_TAKEN` · 422 형식 |
| `PATCH /internal/campaigns/{id}` | 콘솔 | `{name?, status?, externalId?, skanSourceIdentifier?}` | 200 · 409 위와 같음 |
| `POST /internal/campaigns/{id}/links` | 콘솔 | `{destination}` | 201 `{slug, url, playStoreUrl, destination}` · 409 `CAMPAIGN_ARCHIVED` · 422 `DESTINATION_NOT_ALLOWED` |
| `POST /internal/links/{slug}/revocations` | 콘솔 | `{}` | 204 · 422 `NOT_A_CAMPAIGN_LINK` |
| `GET /internal/campaigns/stats?from&to` | 콘솔 | — | 200 `CampaignStatsList` |
| `GET /internal/campaigns/{id}/stats?from&to` | 콘솔 | — | 200 `CampaignStats` |

### 3.1 응답 모양

```jsonc
// LandingView — INVITE, 활성
{"type": "INVITE", "slug": "k3m9x2pa", "state": "ACTIVE", "clickId": "0190d3c4-2a7e-7c11-8b3d-5e6f7a8b9c0d", "groupName": "새벽 공부방", "inviterName": "재영", "destination": null}
// LandingView — CAMPAIGN, 폐기
{"type": "CAMPAIGN", "slug": "q7w2e4rt", "state": "EXPIRED", "clickId": null, "groupName": null, "inviterName": null, "destination": null}

// LinkView — 설치된 앱의 직접 열기용. 클릭을 기록하지 않는다
{"type": "CAMPAIGN", "slug": "q7w2e4rt", "state": "ACTIVE", "destination": "gromo://"}
{"type": "INVITE", "slug": "k3m9x2pa", "state": "ACTIVE", "groupId": "0190d3a2-6c1e-7b44-9a51-3f0c2d7e8a10"}
{"type": "CAMPAIGN", "slug": "q7w2e4rt", "state": "EXPIRED"}

// MatchResult
{"matched": true, "type": "CAMPAIGN", "slug": "q7w2e4rt", "destination": "gromo://"}
{"matched": true, "type": "INVITE", "slug": "k3m9x2pa", "groupId": "0190d3a2-6c1e-7b44-9a51-3f0c2d7e8a10"}
{"matched": false}
```

`MatchResult` 는 기존 필드(`matched`·`slug`·`groupId`)를 유지하고 `type`·`destination` 만 더한다. 구 앱은 새 필드를 무시한다. CAMPAIGN 매치에는 `groupId` 가 없으므로 구 앱은 초대 시트를 띄우지 않는다.

```jsonc
// POST /internal/install-referrers 요청
{
  "deviceId": "a1b2c3", "appInstanceId": "f00d", "referrerRaw": "utm_source=...&utm_content=%7B...%7D",
  "source": "META", "linkSlug": null, "clickId": null, "gclid": null,
  "metaCampaignId": "120210000000000", "metaPayload": {"campaign_id": "120210000000000", "adgroup_id": "…", "ad_id": "…"},
  "decryptFailed": false,
  "referrerClickAt": "2026-09-13T01:02:03Z", "installBeginAt": "2026-09-13T01:04:10Z", "installBeginServer": true,
  "installVersion": "1.4.0"
}
// ReferrerResult
{"attributionId": "0190d3b1-…", "source": "META", "matched": false}
{"attributionId": "0190d3b1-…", "source": "LINK", "matched": true, "type": "CAMPAIGN", "slug": "q7w2e4rt", "destination": "gromo://"}
{"attributionId": "0190d3b1-…", "source": "LINK", "matched": true, "type": "INVITE", "slug": "k3m9x2pa", "groupId": "0190d3a2-6c1e-7b44-9a51-3f0c2d7e8a10"}
```

`installBeginServer` 는 `installBeginAt` 이 Play 서버 시각이면 `true` 다. `install_key` 는 data-api 가 `deviceId` 와 `installBeginAt`(없으면 `0`)으로 만든다.

```jsonc
// POST /internal/skan-postbacks 요청 — 서명 검증을 통과한 것만 온다. 정규화 필드 + 원문
{"transactionId": "…", "version": "4.0", "adNetworkId": "…", "appId": 6774498679, "sourceIdentifier": "5239",
 "sourceAppId": null, "sourceDomain": null, "fidelityType": 1, "redownload": false, "didWin": true,
 "postbackSequenceIndex": 0, "conversionValue": 1, "coarseConversionValue": null,
 "raw": { "…Apple 원문 그대로…": "" }}
```

### 3.2 집계 정의 (`CampaignStats`)

```jsonc
{
  "from": "2026-09-01", "to": "2026-09-13", "timezone": "Asia/Seoul",
  "campaign": {"id": "…", "name": "릴스 9월 1주", "channel": "ORGANIC", "platform": "ALL"},
  "totals": {
    "clicks": 120,
    "installs": {"fingerprint": 14, "referrer": 9, "skan": 0},
    "signups":  {"claim": 11, "skan": 0}
  },
  "links": [
    {"slug": "q7w2e4rt", "destination": "gromo://", "status": "ACTIVE", "clicks": 120,
     "installs": {"fingerprint": 14, "referrer": 9}, "signups": {"claim": 11}}
  ],
  "notes": []
}
```

| 수치 | 정의 (기간은 KST 날짜 경계) | 신뢰도 |
| --- | --- | --- |
| `clicks` | `link_clicks.clicked_at` 이 기간 안 | — |
| `installs.fingerprint` | `link_clicks.matched_at` 이 기간 안 이고 그 클릭을 가리키는 `install_referrers.click_id` 가 없음 | 확률 |
| `installs.referrer` | `COALESCE(install_referrers.install_begin_at, received_at)` 이 기간 안, LINK 는 링크의 캠페인, META 는 `external_id` 대조. 재설치는 새 설치로 센다(§1.5) | 결정 |
| `installs.skan` | `skan_postbacks.received_at` 이 기간 안, §2.6 으로 이 캠페인에 귀속, `postback_sequence_index` 가 0 또는 NULL | 집계·지연 |
| `signups.claim` | `link_clicks.claimed_at` + `install_referrers.claimed_at` 이 기간 안 | 확률 또는 결정 |
| `signups.skan` | `installs.skan` 과 같은 행 중 `conversion_value >= 1` 또는 `coarse_conversion_value IN ('medium','high')` | 집계·지연 |

- `installs.referrer` 를 첫 실행 시각(`received_at`)으로 자르면 설치 며칠 뒤에 처음 연 사용자가 다른 날·다른 캠페인 기간에 들어간다. Play 가 준 설치 시작 시각을 먼저 쓴다.
- referrer 로 귀속된 설치를 fingerprint 에서 빼기 위해 `install_referrers.click_id` 로 조인해 그 클릭을 뺀다(추가 컬럼 없음). §2.4-3 규칙으로 같은 기기의 LINK 설치는 fingerprint 매치가 먼저 났든 뒤에 오든 `click_id` 가 그 클릭을 가리키므로 두 칸에 한 번씩 잡히지 않는다. 다른 기기에 매치된 클릭은 별개 설치다.
- `signups.skan` 은 첫 측정 창(0~2일)의 포스트백만 센다. 그 뒤 가입은 누락된다 — 콘솔에 표기한다.
- `notes`: `SKAN_DELAYED`(iOS 광고 캠페인) · `GOOGLE_CHANNEL_ONLY`(GOOGLE·ANDROID) · `SKAN_CHANNEL_ONLY`(iOS 광고인데 `skan_source_identifier` 없음).
- `CampaignStatsList` 는 캠페인별 `totals` 와, 캠페인에 귀속되지 않은 채널 단위 합(`channels.META`·`channels.GOOGLE` 의 `installs.referrer`·`installs.skan`·`signups.skan`)을 준다.

## 4. 공개 표면 (business-api)

| 메서드·경로 | 인증 | 요청 | 응답 |
| --- | --- | --- | --- |
| `GET /l/{slug}` | 없음 | UA · IP | 200 HTML (활성 · 만료 · 강등 세 모양) |
| `GET /link/**` | 없음 | — | 정적 이미지(현 data-api `static/link/` 이사) |
| `POST /l/match` | 없음 | `{os, deviceId, appInstanceId?}` | 200 `MatchResult`(매치 없음은 `{matched:false}`) · 429 레이트리밋 · 503 일시 장애 |
| `POST /l/referrer` | 없음 | `{os:"android", deviceId, appInstanceId?, referrer, referrerClickTimestampSeconds?, installBeginTimestampSeconds?, referrerClickTimestampServerSeconds?, installBeginTimestampServerSeconds?, installVersion?}` | 200 `ReferrerResult` · 429 · 503 |
| `POST /l/resolve` | 없음 | `{slug}` | 200 `LinkView` · 404 없는 slug · 429 · 503. 클릭을 기록하지 않는다 |
| `GET /.well-known/apple-app-site-association` | 없음 | — | 현행 JSON 그대로(`appIDs` · `/l/*`) |
| `GET /.well-known/assetlinks.json` | 없음 | — | 신규. 패키지·서명 SHA-256 은 env |
| `POST /.well-known/skadnetwork/report-attribution/` (끝 슬래시 없는 경로도) | 없음(서명) | Apple JSON | 200 · 400 JSON 아님 · 413 16KB 초과 · 429 · 500 저장 실패 |
| `POST /api/v1/groups/{groupId}/invite-link` | JWT | — | 200 `{slug, url}` (현행) |
| `POST /api/v1/invite-links/claim` | JWT | `{slug}` · `{slug, deviceId}` · `{attributionId, deviceId}` | 200 · 404 `SLUG_NOT_FOUND` (현행) |
| `/console/**` | 콘솔 세션 | — | HTML (§6) |

`503` 에는 `Retry-After: 60` 을 붙인다. 현 앱 `deferredInvite.matchOnce` 는 2xx 를 받았을 때만 완료 플래그를 세우고, 오류·타임아웃이면 플래그 없이 끝나 다음 실행에 다시 묻는다(`deferredInvite.ts:94-108`). 그래서 일시 장애를 200 으로 접으면 귀속이 영구 유실되고, 503·429 는 구 앱에도 재시도를 준다.

### 4.1 referrer 판별

Play 가 준 `referrer` 문자열을 URL 쿼리로 읽고 위에서부터 첫 규칙을 적용한다.

| 순서 | 조건 | source | 추출 |
| --- | --- | --- | --- |
| 1 | `slug` 키가 있다 | LINK | `slug`, `click`(UUID 형식일 때만) |
| 2 | `utm_content` 가 JSON 이고 `source.data`·`source.nonce` 가 있다 | META | `META_INSTALL_REFERRER_KEY` 로 복호화 → `campaign_id` 등. 실패하면 `decryptFailed=true`, 원문만 |
| 3 | `gclid` 가 있다 | GOOGLE | `gclid` |
| 4 | `utm_source=google-play` 이고 `utm_medium=organic` | ORGANIC | — |
| 5 | 그 밖(빈 문자열 · 파싱 실패 포함) | UNKNOWN | — |

- 복호화 방식(알고리즘 · 인코딩 · payload 필드 이름)은 Meta 의 Install Referrer 문서를 구현 시점에 재확인하고 **실제 광고 1건의 referrer 원문으로 픽스처를 만든다**([§11](#11-확인-목록-구현-착수-전)).
- 시각은 `…ServerSeconds` 를 우선하고 없으면 기기 시각을 쓴다. 설치 시작 시각은 `install_key` 에도 쓰인다(§2.4-1).
- 복호화 키는 business-api 에만 둔다.

### 4.2 SKAN 수신

- 앱 Info.plist 의 `NSAdvertisingAttributionReportEndpoint` 에 적은 도메인(`https://link.oneorthree.world`)으로 Apple 이 포스트백 복사본을 보낸다.
- 이 경로는 공개·무인증이고 우리 앱 ID 도 공개돼 있다. 그래서 **서명 검증을 통과한 것만 DB 에 닿게** 한다.
- 처리 순서: 본문 16KB 초과면 413 → IP 레이트리밋 초과면 429 → JSON 파싱(실패 400) → `app-id` 가 우리 앱(`6774498679`)이 아니면 **저장 없이** 200 → `attribution-signature` 를 **버전별 Apple 공개키**로 검증, 실패하거나 모르는 버전이면 **저장 없이** 200 → data-api 저장(실패 500) → 200.
- 저장하지 않은 요청은 메트릭 카운터 `skan_postback_rejected{reason=app_id|signature|unknown_version|too_large|rate_limited}` 로 세고, 로그에는 `transaction-id` 만 샘플로 남긴다(원문 미기록).
- 서명 대상 필드의 순서·구분자는 버전마다 다르다. Apple 문서의 버전별 규칙을 코드 상수로 둔다.
- JSON 키 → 컬럼: `version` · `ad-network-id` · `source-identifier`(4.0) 또는 `campaign-id`(3.0 이하) · `app-id` · `transaction-id` · `redownload` · `source-app-id` · `source-domain` · `fidelity-type` · `did-win` · `conversion-value` · `coarse-conversion-value` · `postback-sequence-index`. 원문 전체는 `raw` 에 둔다.
- Cloudflare: 봇 챌린지·WAF 가 이 경로의 POST 를 막지 않게 예외를 두되, **같은 경로에 엣지 레이트리밋 규칙**을 함께 둔다(Infra).

### 4.3 클라이언트 IP · 레이트리밋

- data-api `ClientIpResolver` 의 규칙을 그대로 옮긴다: 원격 피어가 사설망(nginx)일 때만 `X-Real-IP` 를 믿는다. nginx 는 Cloudflare 대역 피어일 때만 `CF-Connecting-IP` 로 `$remote_addr` 을 복원한다(현행 Infra 설정).
- #745 의 business-api 설정 `link.trusted-ip-headers` 기본값 `X-Link-Client-IP` 는 Vercel 프록시 전제였다. **`X-Real-IP` 로 바꾼다.**
- **레이트리밋 키에 원본 IP 를 넣지 않는다.** business-api 전용 비밀 `RATE_LIMIT_IP_KEY` 로 `HMAC-SHA256(ip)` 한 값만 쓴다(정책 L17).
- 한도(business-api Redis, 키 `linkrl:<route>:<ipHmac>`): `/l/match`·`/l/referrer`·`/l/resolve` 는 분당 30회, SKAN 수신은 분당 60회. 초과는 429 다.

### 4.4 랜딩

- `LandingRenderer` 와 `invitelink/landing.html` 을 business-api 로 옮긴다. 단일 패스 치환 규칙은 유지한다.
- 캠페인 링크는 별도 템플릿(`link/campaign-landing.html`)을 쓴다. 자리표시자: `pageTitle` · `schemeUrl`(= 목적지) · `iosStoreUrl` · `androidStoreUrl` · `storeState` · `ogImageUrl` · `expired`.
- **Android 스토어 버튼은 신규다**(현 템플릿엔 App Store 버튼만 있다). 두 템플릿 모두 `androidStoreUrl` 을 받아, 설정값 `LINK_ANDROID_PACKAGE` 가 비어 있으면 버튼을 숨긴다. 값이 있으면 `https://play.google.com/store/apps/details?id=<패키지>&referrer=<URL 인코딩된 "slug=<slug>&click=<LandingView.clickId>">` 다. `clickId` 가 없으면(만료·강등) `referrer` 파라미터를 붙이지 않는다.
- 강등 랜딩(data-api 무응답): 그룹·캠페인 문구 없이 스토어 버튼만, 클릭 미기록.
- 목적지 허용 목록(정책 L13)은 business-api 와 data-api 가 공유하는 상수가 아니라 **data-api 가 발급 때 검증**하고, 초기값은 `gromo://`(앱 열기) 하나다.

## 5. 앱 계약 (앱 티켓)

| # | 변경 | 호환 |
| --- | --- | --- |
| 1 | 파서: `g=` 없는 `/l/{slug}` 도 유효. **앱이 설치된 상태에서 Universal Link·App Link 로 직접 열리면** `POST /l/resolve {slug}` 로 `type` 을 받아 CAMPAIGN 은 `destination` 으로, INVITE 는 `groupId` 로 초대 시트를 연다. 매치 응답도 같은 `type` 분기. 모르는 목적지는 앱 홈 | 서버는 구 필드 유지 |
| 2 | Android 첫 실행: `InstallReferrerClient` 로 읽어 `POST /l/referrer`. **2xx 를 받으면 그때 처리한 설치 시작 시각(`installBeginTimestampServerSeconds`, 없으면 기기 값)을 완료 값으로 저장**하고, 다음 실행에서 Play 가 준 설치 시작 시각이 저장값과 다르면 다시 보낸다(Auto Backup 복원 대비). **429·5xx·타임아웃이면 완료 값을 저장하지 않는다**(현 `deferredInvite.matchOnce` 와 같은 규칙). `source` 가 LINK·META·GOOGLE 이면 `/l/match` 생략, 아니면 기존 매치. `attributionId` 보관 | 구 앱은 호출하지 않을 뿐 |
| 3 | claim: 캠페인 slug 는 `deviceId` 함께, referrer 귀속은 `{attributionId, deviceId}` | 구 앱의 `{slug}` 는 INVITE 규칙 |
| 4 | iOS: Info.plist `NSAdvertisingAttributionReportEndpoint = https://link.oneorthree.world`, `SKAdNetworkItems` 에 Meta·Google 식별자, 첫 실행 `updatePostbackConversionValue(0)` · 가입 1 · 첫 집중 완료 2 (coarse low·medium·high) | 서버 무관 |
| 5 | Android App Links: `link.oneorthree.world/l/*` 인텐트 필터 + 서버 assetlinks | 서버 무관 |

## 6. 콘솔 (business-api)

### 6.1 의존성·설정

- 추가 의존성: `spring-boot-starter-thymeleaf`, `spring-security-crypto`(bcrypt 만. Spring Security 필터 체인은 쓰지 않는다).
- env: `CONSOLE_SLOT_<NAME>_HASH`(bcrypt, 팀원 수만큼) · `CONSOLE_COOKIE_KEY`(32바이트 이상) · `RATE_LIMIT_IP_KEY`(32바이트 이상, §4.3 과 공유). 슬롯 이름은 env 이름에서 뽑은 짧은 영문이고 `X-Actor`·`created_by` 에 쓴다.

### 6.2 인증

| 요소 | 규칙 |
| --- | --- |
| 로그인 | `POST /console/login {slot, password}` → bcrypt 대조. 없는 슬롯과 틀린 비밀번호는 같은 메시지 |
| 쿠키 | `gromo_console = base64url(slot · issuedAt · expiresAt) + "." + HMAC-SHA256(CONSOLE_COOKIE_KEY)`. `HttpOnly` · `Secure` · `SameSite=Strict` · `Path=/console` · 30일 |
| 필터 | `ConsoleSessionFilter` 가 `/console/**`(로그인·정적 제외)에서 서명·만료·**슬롯이 env 에 아직 있는지**를 본다. env 에서 슬롯을 지우면 그 쿠키는 즉시 무효 |
| 잠금 | Redis `console:fail:slot:<slot>` 5회/15분, `console:fail:ip:<ipHmac>` 20회/15분(`ipHmac` = `HMAC-SHA256(RATE_LIMIT_IP_KEY, ip)`). 넘으면 "15분 뒤 다시 시도하세요" |
| 폼 | 모든 POST 폼에 1회용 `formToken`(Redis `console:form:<token>`, 1시간). 제출 때 `GETDEL`, 없으면 "이미 처리했거나 만료된 요청입니다" |
| 헤더 | `Cache-Control: no-store` · `X-Frame-Options: DENY` · `Content-Security-Policy: default-src 'self'` |
| 로그아웃 | `POST /console/logout` 이 쿠키를 지운다 |

### 6.3 화면

| 경로 | 보여주는 것 | 동작 |
| --- | --- | --- |
| `/console/login` | 슬롯·비밀번호 | 로그인 |
| `/console/campaigns` | 캠페인 표(이름 · 채널 · 플랫폼 · 기간 설치 · 가입 · 신뢰도 표기) + 채널 단위 합. 기간 기본 최근 7일 | 캠페인 만들기 |
| `/console/campaigns/{id}` | 링크 표(slug · URL · 목적지 · 상태 · 클릭 · 설치 · 가입), Android 는 Play 스토어 URL 복사 칸, `notes` 문구 | 링크 발급 · 폐기 · 캠페인 수정(Meta campaign_id · SKAN source-identifier · 보관) |

`notes` 문구: `SKAN_DELAYED` "iOS 광고 수치는 측정 창이 끝난 뒤 1~2일 늦게 들어옵니다" · `GOOGLE_CHANNEL_ONLY` "Google 광고는 채널 합계만 셉니다. 캠페인별은 Google Ads 에서 확인하세요" · `SKAN_CHANNEL_ONLY` "SKAN 캠페인 번호가 없어 채널 합계에만 들어갑니다".

## 7. 오류·시간 예산

| 상황 | 공개 응답 | 기록 |
| --- | --- | --- |
| 랜딩에서 data-api 무응답(1.5초) | 강등 랜딩 200 | WARN |
| 없는 slug | 만료 랜딩 200 | — |
| match·referrer·resolve 에서 매치·링크 없음 | 200 `{matched:false}` · resolve 는 404 | — |
| match·referrer·resolve 에서 data-api 오류·무응답(3초) | **503** + `Retry-After: 60` | WARN |
| 공개 경로 레이트리밋 초과 | **429** | 카운터 |
| referrer 복호화 실패 | 200 `{source:"META", matched:false}` | `decrypt_failed=true` |
| SKAN 본문 16KB 초과 | 413 | 카운터 |
| SKAN JSON 아님 | 400 | 카운터 |
| SKAN 다른 앱 · 서명 실패 · 모르는 버전 | 200 | **미저장**, 카운터 + `transaction-id` 샘플 로그 |
| SKAN 저장 실패(5초) | 500 | ERROR + `transaction-id` |
| claim 대상 없음·기기 불일치·탈퇴한 유저 | 200 | DEBUG |
| 콘솔에서 data-api 오류 | "잠시 뒤 다시 시도하세요" 페이지 | WARN |

## 8. GA4 서버 이벤트

data-api 의 기존 발행(`InviteLinkGa4Events`)을 유지하고 파라미터만 더한다. 앱 이벤트는 바꾸지 않는다.

| 이벤트 | 추가 파라미터 |
| --- | --- |
| `invite_link_created` | `link_type`(`invite`·`campaign`), 캠페인이면 `campaign_id`(그룹 필드 없음) |
| `invite_link_clicked` | `link_type`, 캠페인이면 `campaign_id` |
| `invite_match_resolved` | `link_type`, 캠페인이면 `campaign_id`. `matched_by` 에 `install_referrer` 값 추가(기존 `ip_os_window`) |
| `install_referrer_received` (신규) | `source`, LINK 면 `link_type`·`campaign_id`. `appInstanceId` 가 있으면 앱 스트림, 없으면 웹 스트림(`deviceId`) — 매치 이벤트와 같은 규칙 |

SKAN 포스트백은 GA4 로 보내지 않는다.

## 9. PR #745 와의 관계

정책 L15 에 따라 #745 는 링크 분리 전제 코드를 포함해 머지한다. 아래 목록은 head `37db435d1` 기준이며, **구현 PR 착수 때 머지 커밋에서 다시 뽑는다.**

### 9.1 머지 뒤 켜지 않는 것

| #745 의 것 | 켜면 | 구현 PR 전까지 |
| --- | --- | --- |
| nginx 예시(`nginx-satellites.include.conf.example`)의 `/api/v1/groups/{id}/invite-link`·`/api/v1/invite-links/claim` → business | business-api 가 존재하지 않는 링크 서버(`LINK_BASE_URL`)로 발급·claim 을 보내 실패 | 적용하지 않는다. 두 경로는 data-api 공개 컨트롤러에 둔다 |
| data-api `satellites` 프로필 `outbox.relay.endpoints` 의 `link.*` 7종(→ `${LINK_BASE_URL}/internal/events`) | relay 가 없는 서버로 전달을 반복 시도 | `OUTBOX_RELAY_ENABLED` 를 켜기 전에 link.* 대상을 뺀다. 링크 outbox 행을 적는 조건(`LinkMembershipEventService` 호출부)도 함께 확인 |
| data-api `satellites` 의 `link.capability-key: ${LINK_CAPABILITY_KEY}` | 미주입이면 그 프로필이 부팅 실패 | 구현 PR 이 키와 사용처를 지운다 |
| business-api prod 설정 `link.proxy-secret: ${LINK_PROXY_SECRET}` · `business.upstream.link.*` (기본값 없음) | 미주입이면 부팅 실패 | business-api 를 prod 에 올릴 때 구현 PR 이 먼저 들어가 있지 않으면 자리값 주입이 필요하다 |
| business-api `link.trusted-ip-headers` 기본 `X-Link-Client-IP` | 링크 경로에서 IP 를 못 읽음 | `X-Real-IP` 로(§4.3) |
| business-api `business.compat.*`(match 호환 핸들러 · claim 큐 재개) | 이관 정지 창 전용 | 기본 false 유지 |

### 9.2 구현 PR 이 걷어낼 것

| 위치 | 대상 |
| --- | --- |
| business-api | `upstream/link/LinkApiClient` · `upstream/link/dto/*` · `usecase/ClaimIntentReplay*` · `usecase/ClaimIntentTermination` · `usecase/InviteLinkUseCase`(data 위임으로 다시 작성) · `usecase/CompatMatchUseCase` · `api/LinkMatchCompatController` · `upstream/data/dto/ClaimIntent*` · 관련 테스트 · 설정 `link.proxy-secret`·`business.upstream.link`·`business.compat`·`claim-replay` |
| data-api | `internal/InternalMigration*Controller` · `internal/service/InternalClickMigrationService` · `internal/service/InternalInviteLinkService`(claim intent·confirmation) · `invitelink/repository/*ClaimIntent*`·`*ClaimConfirmation*`·`*Frozen*`·`*ClickMigration*` · `invitelink/support/FrozenClickSource`·`LinkCapability*` · `group/service/LinkMembershipEventService` · `group/listener/LinkDisplayNameChangeListener` · `GroupService`·`GroupMemberService` 의 호출부 · `migration/` 의 링크 부분 · `application-link-migration.yml` · 허용목록의 `invite-links/claim-*`·`migrations/*`·`invite-issue-context` · relay `link.*` 대상 |
| 스키마 | V52 의 `invite_claim_intents` · `invite_claim_confirmations` · `invite_click_migrations` · `invite_click_frozen_rows` · `invite_link_frozen_rows` 는 **contract 마이그레이션(§1.1)에서** DROP 한다. 코드(엔티티)는 2단계 PR 에서 지우지만 테이블은 contract 까지 남겨 2~4단계 이미지 롤백을 지킨다. V52 의 `group_members` 변경은 용도를 확인해 membershipEpoch 전용이면 contract 에서 함께 되돌린다 |

`LinkMembershipEventService` 를 지우면 멤버십 이탈 때 링크를 폐기하는 경로가 없어진다. 같은 PR 에서 **그룹 획득 LLD §2.1 의 규칙대로 같은 트랜잭션 폐기**를 구현한다.

## 10. 테스트

| 층 | 검증 |
| --- | --- |
| data-api (Testcontainers) | expand 뒤 기존 slug 의 방문·매치·claim 회귀 · **expand 스키마에서 이전 이미지 엔티티가 `ddl-auto=validate` 로 기동** · contract 뒤 새 이미지 기동과 복구 SQL 뒤 이전 이미지 기동 · `ck_links_type_shape` 위반 거절 · active 부분 unique 에서 동시 발급이 한 slug 로 수렴 · 같은 `install_key` 동시 referrer 2건이 1행 · 같은 `deviceId` 에 설치 시작 시각이 다른 referrer 는 2행(재설치) · LINK referrer 가 클릭을 소진해 다른 기기 fingerprint 가 그 클릭을 못 가져감 · **같은 기기에서 `/l/match` 가 먼저 성공한 뒤 LINK referrer 가 오면 `click_id` 가 그 클릭이고 설치 합계가 1** · **referrer 뒤의 `/l/match` 가 새 클릭을 소진하지 않음** · INVITE 링크 referrer 응답에 `groupId` · 방문 응답의 `clickId` 가 저장된 클릭 id 와 같음 · 캠페인 slug claim 의 기기 불일치 no-op · `attributionId` 기기 불일치 no-op · **탈퇴 트랜잭션 진행 중 들어온 claim 이 탈퇴 커밋 뒤 no-op 이고 두 테이블 `claimed_user_id` 가 NULL** · SKAN 재전송 1행 · 집계의 KST 경계(`to` 날 23:59 포함, 다음 날 00:00 제외) · `installs.referrer` 가 `install_begin_at` 기준(설치 전날·첫 실행 다음 날 경계) · SKAN 끝자리 대조(`5239` 등록, 포스트백 `39` → 귀속, `5239`·`1139` 둘 다 등록이면 채널 단위, `52` 는 비귀속) |
| business-api | referrer 판별 표(§4.1 다섯 규칙 + 깨진 인코딩 · 빈 문자열 · 변조된 Meta payload) · SKAN 서명 검증(버전별 Apple 문서 예시 포스트백을 픽스처로) · **서명 실패·다른 `app-id`·모르는 버전이 data-api 호출 0회** · 16KB 초과 413 · match·referrer·resolve 가 data-api 5xx·타임아웃이면 503 + `Retry-After`, 매치 없음은 200 · 레이트리밋 초과 429 · **Redis 키에 원본 IP 문자열이 없음** · resolve 가 클릭을 기록하지 않음 · 강등 랜딩 · 만료 랜딩의 Play URL 에 `referrer` 없음 · IP 신뢰(사설 피어만) · 콘솔 잠금 · 쿠키 변조 · 슬롯 제거 즉시 무효 · 폼 토큰 재사용 거절 |
| 전환 리허설 (dev) | nginx 전환 전후로 같은 slug 의 클릭 → 매치 → claim 이 끊기지 않음, 원복 reload 도 같음 · expand 이미지 → 이전 이미지 롤백 · contract 복구 SQL → 이전 이미지 롤백 |
| 실물 | Meta Android 테스트 광고 1건의 referrer 원문으로 픽스처 갱신. SKAN 은 실제 포스트백을 받기 전까지 콘솔에 "미검증"으로 표기 |

## 11. 확인 목록 (구현 착수 전)

| # | 확인 | 막히는 곳 |
| --- | --- | --- |
| 1 | Meta·Google 이 공개하는 SKAdNetwork 식별자 → `SkanAdNetworks` 레지스트리, 앱 `SKAdNetworkItems` | §2.6 · 앱 4 |
| 2 | Meta Install Referrer 복호화 방식과 키 발급 위치(Meta 앱 대시보드) | §4.1 |
| 3 | Apple SKAN 버전별 서명 대상 필드 순서와 공개키 | §4.2 |
| 4 | `link.oneorthree.world` 가 prod nginx 로 들어오는지(Infra `server_name`). AASA 를 지금 data-api 가 서빙하므로 그렇다고 보지만 문서화된 적이 없다 | HLD §7 4단계 |
| 5 | Android 패키지명·릴리즈 서명 SHA-256, Play 스토어 게시 상태 | §4.4 · 앱 5 |
| 6 | 개인정보처리방침의 IP 해시 · 기기 식별자 · Install Referrer 수집 고지 | 정책 L19 (출시 조건) |
| 7 | 구현 시점의 Flyway 최대 번호(열린 PR 포함) | §1.1 |
| 8 | prod Flyway 가 이력의 미래 버전을 무시하는지(`ignoreMigrationPatterns`, 기본 `*:future`). 무시하지 않으면 expand·contract 뒤 이전 이미지 롤백이 Flyway 검증에서 막힌다 | §1.1 · HLD §7 |
