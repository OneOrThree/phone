# 링크·어트리뷰션 상세 설계

[정책](policy.md)의 결정을 테이블·API·판정 규칙으로 옮긴다. 기준 main `875a9fd89`, PR #745 는 head `37db435d1` 을 봤다. 날짜의 타임존 축은 [날짜 축 규약](../../conventions/date-axis.md)의 KST 고정을 따르고, 기간 `from`~`to` 를 시각 구간 `[from 00:00, to+1일 00:00)` KST 로 바꾸는 규칙은 이 설계가 정한다.

## 1. 데이터 모델

### 1.1 마이그레이션 — expand / contract

prod 는 `spring.jpa.hibernate.ddl-auto: validate`(`application-prod.yml`)라 엔티티가 보는 테이블이 없으면 이미지가 기동을 거부한다. 한 번에 rename 하면 이전 이미지로 되돌릴 수 없으므로 **두 파일로 나눈다.** 데이터 이관은 없다.

| 단계 | 파일 | 내용 | 이전 이미지로 롤백 |
| --- | --- | --- | --- |
| expand ([HLD §7](high-level-design.md#7-배포-순서) 2단계) | 구현 시점 최대 번호 다음(#745 가 V51·V52 를 쓰므로 V53 이상, 열린 PR 번호까지 확인) | **기존 테이블 이름 그대로** 컬럼·제약·인덱스 추가, 신설 3개. **V21 전체 unique 유지**, rename·DROP 없음. 이 기간엔 링크 폐기·재발급을 켜지 않는다 | 가능. 이전 엔티티가 보는 테이블·컬럼이 그대로 있고, 한 `(group_id, inviter_id)` 에 INVITE 행이 하나뿐이라 이전 이미지의 단건 조회도 그대로 동작한다 |
| contract (HLD §7 5단계) | 그다음 번호 | 기존 비활성 초대 링크 `REVOKED` 보정 → unique 교체 → rename 2개 → V52 링크 테이블 5개 DROP. 같은 이미지에서 폐기·재발급 코드를 켠다 | **불가 — roll-forward 전용.** 장애는 앞으로 고치는 핫픽스로 대응하고, 최후 수단은 contract 직전 RDS 스냅샷 복원이다(그 뒤 쓰기는 잃는다) |

이 문서는 개념 이름으로 최종 이름(`links`·`link_clicks`)을 쓴다. expand 부터 contract 전까지 물리 이름은 `group_invite_links`·`invite_link_clicks` 이고, 그 기간의 엔티티는 `@Table` 로 옛 이름을 가리킨다. 아래 expand DDL 은 물리 이름으로 적는다.

**expand 동안 V21 전체 unique `uq_invite_links_group_inviter` 를 남기는 이유**: 이전 이미지는 `GroupInviteLinkRepository.findByGroupIdAndInviterId` 로 상태 조건 없이 `Optional` 단건을 읽는다. expand 에서 폐기 행과 새 활성 행이 같은 `(group_id, inviter_id)` 에 공존하면, 롤백한 이전 이미지는 다건 예외를 내거나 `REVOKED` slug 를 유효한 링크로 돌려준다. 그래서 폐기·재발급([그룹 획득 LLD §2.1](../group/features/01-acquisition/low-level-design.md))은 되돌릴 수 없는 contract 이미지에서 켠다. 지금 prod 에도 링크 폐기가 없으므로 expand 기간이 현행보다 나빠지지는 않는다. CAMPAIGN 행은 `group_id`·`inviter_id` 가 NULL 이고 Postgres unique 는 NULL 끼리 충돌하지 않으므로 전체 unique 와 함께 쓸 수 있다. 다만 캠페인 링크를 만드는 콘솔은 [HLD §7](high-level-design.md#7-배포-순서) 6단계라 contract 뒤에 켜진다.

```sql
-- contract — 아래 진입 조건 확인 · 직전 RDS 수동 스냅샷 생성 뒤. roll-forward 전용
-- ① 기존 초대 링크 중 이미 쓸 수 없는 행을 폐기로 확정한다. 안 하면 발급자가 재가입했을 때
--    예전 slug 가 다시 활성으로 평가돼 「폐기 후 새 slug」 계약이 깨진다
UPDATE public.group_invite_links l
   SET status = 'REVOKED', revoked_at = now(), revoke_reason = 'BACKFILL_INACTIVE'
 WHERE l.type = 'INVITE' AND l.status = 'ACTIVE'
   AND (   NOT EXISTS (SELECT 1 FROM public.groups g
                        WHERE g.id = l.group_id AND g.deleted_at IS NULL AND g.status IN ('WAITING', 'ACTIVE'))
        OR NOT EXISTS (SELECT 1 FROM public.group_members m
                        WHERE m.group_id = l.group_id AND m.user_id = l.inviter_id AND m.is_left = false));
-- ② 전체 unique 를 「active INVITE 1개」 부분 unique 로 바꾼다 (그룹 획득 LLD §2.1)
ALTER TABLE public.group_invite_links DROP CONSTRAINT uq_invite_links_group_inviter;
CREATE UNIQUE INDEX uq_links_invite_active ON public.group_invite_links (group_id, inviter_id) WHERE type = 'INVITE' AND status = 'ACTIVE';
-- ③ rename
ALTER TABLE public.group_invite_links RENAME TO links;
ALTER TABLE public.invite_link_clicks RENAME TO link_clicks;
-- ④ V52 링크 테이블: 다섯 테이블 행 수가 모두 0 인지 먼저 확인한다. 0 이 아니면 멈추고 보고한다
DROP TABLE public.invite_claim_confirmations, public.invite_claim_intents,
           public.invite_click_frozen_rows, public.invite_link_frozen_rows, public.invite_click_migrations;
```

**contract 는 roll-forward 전용이다.** 이전 이미지로 되돌리는 복구 SQL 은 두지 않는다. contract 이미지가 폐기·재발급을 한 번만 해도 같은 `(group_id, inviter_id)` 에 INVITE 행이 둘 이상 생겨 전체 unique 를 다시 만들 수 없고, `status` 를 모르는 이전 이미지는 폐기된 slug 를 유효한 링크로 본다. 대신 아래를 지킨다.

| 항목 | 규칙 |
| --- | --- |
| 진입 조건 | [HLD §7](high-level-design.md#7-배포-순서) 4단계 nginx 전환 뒤 7일 무사고 · 구 경로(data-api 링크 공개 컨트롤러) 호출 0 · 2~4단계 이미지 롤백 리허설 완료 · contract 이미지의 폐기·재발급 경로를 dev 에서 먼저 실행 |
| 최후 복구 | contract 마이그레이션 직전에 RDS 수동 스냅샷을 만든다. 되돌려야 하면 이 스냅샷으로 복원하고 이전 이미지를 띄운다. **스냅샷 이후의 모든 쓰기(링크뿐 아니라 전 도메인)를 잃으므로** 데이터 손상 같은 최악의 경우에만 쓴다 |
| 장애 대응 | 새 이미지의 결함은 앞으로 고치는 핫픽스로 해결한다 |

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
    CONSTRAINT ck_campaigns_external CHECK (external_id IS NULL OR (channel = 'META' AND platform IN ('ANDROID', 'ALL'))),
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

-- V21 의 전체 unique uq_invite_links_group_inviter 는 expand 동안 그대로 둔다(§1.1). 부분 unique 교체는 contract ②
CREATE INDEX idx_links_campaign ON public.group_invite_links (campaign_id) WHERE campaign_id IS NOT NULL;
```

- 기존 행은 전부 `type=INVITE`·`status=ACTIVE` 가 된다. 이미 쓸 수 없는 행(발급자 이탈·그룹 종료)의 `REVOKED` 보정은 contract ① 에서 한다. expand 동안엔 V21 전체 unique 가 멱등 발급의 최후 방어선으로 그대로 남는다.
- `revoke_reason`: `MEMBER_LEFT` · `MEMBER_KICKED` · `ACCOUNT_WITHDRAWN` · `GROUP_CLOSED`(INVITE, 그룹 획득 문서의 전이) · `CONSOLE`(CAMPAIGN) · `BACKFILL_INACTIVE`(contract ① 보정).
- 폐기 트리거·잠금 순서·재발급은 [그룹 획득 LLD §2.1](../group/features/01-acquisition/low-level-design.md) 이 정본이다. 이 마이그레이션은 그 규칙을 담을 자리만 만들고, 그 코드는 contract 이미지에서 켠다(§1.1).

### 1.4 `link_clicks` (expand 동안 물리 이름 `invite_link_clicks`)

expand 에서 컬럼 둘을 더하고 contract 에서 rename 한다. 기존 컬럼·인덱스(`idx_invite_clicks_match` · `idx_invite_clicks_link` · `idx_invite_clicks_device`)는 그대로다.

```sql
ALTER TABLE public.invite_link_clicks
    ADD COLUMN claimed_as_new_user boolean,      -- claim 때 기록(§2.5). NULL = 미claim 또는 기록 이전 행
    ADD COLUMN signup_at           timestamptz;  -- 신규면 users.created_at. 가입 수의 기간 기준(§3.2)
```

 Referrer 설치는 링크가 없을 수 있어 이 테이블에 넣지 않는다(§1.5).

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
    reporter_user_id  uuid,          -- 저장을 요청한 세션의 유저(게스트 포함). 탈퇴 시 NULL, FK 없음 (§2.4-5 · §2.7)
    claimed_user_id   uuid,
    claimed_at        timestamptz,
    claimed_as_new_user boolean,     -- claim 때 기록(§2.5). NULL = 미claim
    signup_at         timestamptz,   -- 신규면 users.created_at (§2.5 · §3.2)
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
CREATE INDEX idx_install_referrers_reporter ON public.install_referrers (reporter_user_id, received_at) WHERE reporter_user_id IS NOT NULL;
CREATE INDEX idx_install_referrers_click    ON public.install_referrers (click_id) WHERE click_id IS NOT NULL;  -- installs.fingerprint 의 제외 조인(§3.2)
```

- FK 는 contract 의 rename 을 따라간다.
- **설치 단위는 `install_key`** 다. 앱은 `android:allowBackup="true"`(`AndroidManifest.xml`)라 Auto Backup 이 `deviceId` 와 완료 플래그를 재설치 뒤에도 복원할 수 있다. 기기 단위로 멱등을 잡으면 다른 광고로 재설치한 설치가 과거 귀속에 묻힌다. 재설치는 새 설치 행이다.
- **캠페인 귀속은 읽기 시점에 한다.** LINK 는 `links.campaign_id`, META 는 `campaigns.external_id = meta_campaign_id`, GOOGLE 은 채널만. 콘솔에서 Meta 캠페인을 늦게 등록해도 그 전에 들어온 설치가 붙는다.
- `claimed_at`·`claimed_as_new_user`·`signup_at` 은 탈퇴로 `claimed_user_id` 가 지워져도 남는다(가입 수 집계용).
- **저장은 인증된 세션만 한다**(§2.4-5 · §4). `reporter_user_id` 로 유저당 KST 당일 저장 상한을 센다(§2.4-5). 탈퇴하면 NULL 이 되므로 FK 를 두지 않는다.

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

`com.oneorthree.phone.invitelink` 를 `com.oneorthree.phone.link` 로 옮긴다. `GroupInviteLink` → `Link`, `InviteLinkClick` → `LinkClick`, 신규 `Campaign` · `InstallReferrer` · `SkanPostback`. expand 부터 contract 전까지 `Link`·`LinkClick` 은 `@Table(name = "group_invite_links")`·`@Table(name = "invite_link_clicks")` 이고, contract 이미지에서 `@Table` 을 최종 이름으로 바꾼다. 공개 컨트롤러(`LinkPublicController` · `WellKnownController` · `InviteLinkController`)는 [HLD §7](high-level-design.md#7-배포-순서) 5단계까지 남긴다. 링크 폐기·재발급 코드(`status` 전이, active 부분 unique 를 전제한 발급 조회)도 contract 이미지에서 켠다.

## 2. 판정 규칙 (data-api)

### 2.1 활성 판정

| 링크 | 활성 조건 |
| --- | --- |
| INVITE | `status=ACTIVE` + 그룹 활성(현행 `findActiveGroup`) + 그룹 획득 문서의 발급자 조건 |
| CAMPAIGN | `status=ACTIVE` + 캠페인 `status=ACTIVE` |

활성이 아닌 링크는 클릭을 기록하지 않고 referrer·claim 귀속 대상이 되지 않는다. 매치에서는 후보를 고르는 조건이 아니라 **고른 뒤 검증하는 조건**이다(§2.3, 정책 L14). expand 동안에는 `status` 가 모두 `ACTIVE` 라 INVITE 활성 조건은 현행(`findActiveGroup`)과 같다.

### 2.2 방문 (`visits`)

활성이면 `link_clicks` 에 한 행을 넣고(`ip_hash = SHA-256(ip + LINK_IP_SALT)`, 현행 `IpHasher`) `LandingView` 에 **그 클릭의 id 를 `clickId` 로**, INVITE 면 **`groupId`** 도 담아 돌려준다. business-api 는 DB 를 읽지 않으므로 Android 스토어 버튼의 `click` 파라미터(§4.4)는 이 `clickId` 로만, 스킴 버튼의 `gromo://join?g=<groupId>&s=<slug>`(현행 `InviteLinkUrls.scheme` — 구 앱이 초대 시트를 여는 형식)는 이 `groupId` 로만 만들 수 있다. 비활성이면 행 없이 `state=EXPIRED`·`clickId=null` 뷰를 돌려준다. 없는 slug 는 404.

**봇 UA 는 기록하지 않는다.** 카카오톡·Slack·Meta 같은 링크 미리보기 수집기는 사용자가 열기 전에도 `GET /l/{slug}` 를 부른다. data-api 가 요청 바디의 `userAgent` 를 현행 `UserAgentClassifier.isBot` 으로 판별해, 봇이면 활성 링크라도 행을 넣지 않고 `clickId=null` 뷰를 돌려준다(OG 렌더는 그대로). 현행 `InviteLinkClickService.record` 와 같은 규칙이다.

### 2.3 fingerprint 매치

현행 `InviteLinkMatchService.match` 를 그대로 쓴다(`ip_hash + os + LINK_MATCH_WINDOW_HOURS`, `PESSIMISTIC_WRITE` + `SKIP LOCKED`, 기기별 기존 매치 재반환). **활성 조건을 후보 조회에 넣지 않는다.** 현행처럼 창 안의 최신 미매치 클릭을 후보로 고정하고, 소진한 뒤 §2.1 활성 판정을 하고, 실패면 `matched:false` 로 끝낸다 — 더 오래된 다른 후보로 내려가지 않는다. 활성 조건으로 먼저 거르면 같은 IP·OS 에서 더 최근에 폐기된 클릭 뒤의 과거 클릭이 이 기기에 엉뚱하게 귀속된다. 기존 매치 재반환도 같은 활성 판정을 거친다. 재반환은 매치 창 안의 매치만 본다(`findFirstByMatchedDeviceIdAndMatchedAtAfterOrderByMatchedAtDesc(deviceId, cutoff)`) — 창 밖에서 재설치한 기기는 새 후보를 매치한다. 응답에 `type` 과, CAMPAIGN 이면 `destination` 을 싣는다.

### 2.4 Install Referrer 저장

1. `install_key = deviceId + ":" + 설치 시작 초`. 설치 시작 초의 서버·기기 우선순위(`installBeginTimestampServerSeconds` 우선, 없으면 `installBeginTimestampSeconds`)는 **business-api 가 정해 `installBeginAt` 으로 넘기고**(§4.1), data-api 는 그 값만 쓴다. 값이 없으면 `0` 이다. **같은 `install_key` 행이 있으면 그 행을 그대로 돌려준다**(`uq_install_referrers_install` 충돌 시 재조회). 설치 시작 시각이 다르면 재설치로 보고 새 행을 만든다.
2. `source=LINK` 로 들어왔는데 slug 가 활성 링크가 아니면 `source=UNKNOWN`, `link_id=NULL` 로 저장한다(정책 L14).
3. `source=LINK` 이면 `click_id` 를 아래 순서로 정한다. 한 설치가 fingerprint 와 referrer 양쪽에 잡히지 않게 하려는 규칙이다.
   1. 전달된 `clickId` 가 그 링크의 **미매치** 클릭이면 그 클릭을 `PESSIMISTIC_WRITE` 로 잠가 `matched=true`·`matched_at`·`matched_device_id`·`app_instance_id` 를 채우고 `click_id` 로 둔다. 같은 클릭이 fingerprint 로 다른 기기에 다시 매치되지 않는다.
   2. 아니면(전달값 없음 · 이미 매치됨 · 다른 링크의 클릭) **같은 링크에서 이 `deviceId` 로 매치된 클릭 중 `matched_at >= COALESCE(install_begin_at, received_at) - LINK_MATCH_WINDOW_HOURS` 인 것**이 있으면, 그중 `matched_at` 이 설치 시각에 가장 가까운 클릭을 `click_id` 로 둔다. 이번 설치에서 레이스로 `/l/match` 가 먼저 성공한 경우다. 매치 창 밖의 과거 매치는 이전 설치의 것이라 연결하지 않는다 — 연결하면 §3.2 가 과거 fingerprint 설치를 소급해서 빼 실제 2건이 1건이 된다.
   3. 둘 다 아니면(다른 기기에 매치된 클릭뿐이거나 이 기기의 매치가 창 밖) `click_id=NULL` 로 저장만 한다. 그 클릭은 별개 설치다.

   referrer 가 먼저 오고 `/l/match` 가 뒤에 오면, 매치는 현행 「기기별 기존 매치 재반환」으로 1-i 에서 소진된 클릭을 돌려줄 뿐 새 클릭을 소진하지 않는다.
4. 응답 `ReferrerResult` 는 `attributionId`·`source` 에 `MatchResult` 와 같은 필드(`matched`·`type`·`slug`·INVITE 면 `groupId`·CAMPAIGN 이면 `destination`)를 싣는다. `matched` 는 **활성 링크로 귀속된 LINK 일 때만** `true` 다. INVITE 링크를 거친 Android 설치는 `/l/match` 를 건너뛰므로(정책 L12) 초대 맥락을 첫 실행의 `/l/resolve` 와 세션 확보 뒤의 이 응답 중 먼저 온 쪽으로 복원한다 — 그래서 `groupId` 를 싣는다. META·GOOGLE 은 `matched=false` 다. fingerprint 생략은 앱이 첫 실행에 로컬에서 판단한다.
5. **저장은 access token 이 있는 요청만 받는다**(게스트 포함, §4). 트랜잭션 첫 조회로 `SELECT … FROM users WHERE id = :reporterUserId AND deleted = false FOR UPDATE` 를 잡는다.
   - 행이 없으면(저장 도중 탈퇴) 저장하지 않고 200 `{source, matched:false}`(`attributionId` 없음)로 끝낸다. 토큰은 이미 무효라 앱이 다시 보내도 401 이다.
   - 같은 `install_key` 행이 있으면 1번대로 그 행을 돌려준다. 재전송은 상한에 세지 않는다.
   - 그 밖엔 **같은 락 안에서** `reporter_user_id = :u` 이고 `received_at` 이 KST 오늘인 행을 세어, 3 이상이면 저장하지 않고 429, 아니면 INSERT 한다. 락이 count 와 INSERT 를 직렬화하므로 동시 요청으로 상한을 넘지 못한다.
   - 탈퇴(`getCallerForUpdate` 배타 락)와도 직렬화되어, 탈퇴 커밋 뒤에 `reporter_user_id` 가 다시 기록되지 않는다. claim(공유 락)과도 직렬화되지만 앱은 referrer 저장 → claim 을 차례로 부르므로 한 요청 안에서 두 락이 섞이지 않아 교착이 없다.

### 2.5 claim

모든 claim 은 트랜잭션 첫 조회로 **요청 유저의 활성 행을 공유 락**(`FOR SHARE`)으로 잡고, 없으면 no-op 200 으로 끝낸다. 탈퇴(`AccountWithdrawalService.withdraw`)는 `getCallerForUpdate` 로 같은 행을 배타 락으로 잡으므로, claim 은 탈퇴 커밋 뒤에 조건을 재평가해 빈 결과가 된다(`UserRepository` 의 활성 유저 공유 락 조회와 같은 방식). 이렇게 해야 §2.7 의 UPDATE 뒤·커밋 전에 끼어든 claim 이 `claimed_user_id` 를 남기지 않는다.

요청은 `slug` 또는 `attributionId` 중 정확히 하나를 싣는다.

| 입력 | 규칙 | 응답 |
| --- | --- | --- |
| `slug` (INVITE) | 현행 그대로: 그 링크의 가장 최근 `matched=true`·미claim 클릭에 붙인다. `deviceId` 가 오면 `matched_device_id` 가 같은 클릭을 먼저 찾는다. 셀프 초대·이미 claim·REVOKED 등 비활성 링크(§2.1)는 no-op | 200. 없는 slug 는 현행 `SLUG_NOT_FOUND`(404) 유지 |
| `slug` (CAMPAIGN) | `deviceId` **필수**. `matched_device_id = deviceId` 인 미claim 클릭에만 붙인다. 후보 클릭은 현행 slug claim 과 같은 `PESSIMISTIC_WRITE` + `SKIP LOCKED` 로 선점한다. 없으면 no-op | 200 |
| `attributionId` | 조건부 UPDATE 한 번으로 **원자적으로 선점**한다(표 아래 SQL). 조건은 ① 미선점 · 기기 일치 ② 셀프 초대 거절(slug 분기와 같은 규칙) ③ **링크 활성 재검증** — `link_id` 가 없으면(META · GOOGLE · ORGANIC · UNKNOWN) 검사하지 않고, 있으면 slug 분기와 같은 §2.1 판정을 claim 시점에 다시 한다. referrer 저장 뒤 claim 전에 발급자가 이탈하거나 그룹이 끝나거나 캠페인 링크가 폐기되면 no-op 이다. 영향 행 1 이면 성공, 0 이면 no-op(이미 선점 · 기기 불일치 · 셀프 초대 · 비활성 링크). 요청 유저 행 락은 사용자마다 다른 행이라 두 사용자의 동시 claim 을 막지 못하므로, 대상 행 조건으로 막는다 | 200 |

```sql
-- attributionId claim. :u·:userCreatedAt 은 같은 트랜잭션의 FOR SHARE 유저 조회에서 온다
-- contract 전 물리 이름은 group_invite_links 이고, 그 기간엔 status 가 전부 ACTIVE 라 l.status 조건은 참이다
UPDATE public.install_referrers r
   SET claimed_user_id     = :u,
       claimed_at          = now(),
       claimed_as_new_user = (:userCreatedAt >= COALESCE(r.install_begin_at, r.received_at)),
       signup_at           = CASE WHEN :userCreatedAt >= COALESCE(r.install_begin_at, r.received_at) THEN :userCreatedAt END
 WHERE r.id = :attributionId
   AND r.device_id = :deviceId
   AND r.claimed_user_id IS NULL
   AND (r.link_id IS NULL OR EXISTS (
         SELECT 1 FROM public.links l
          WHERE l.id = r.link_id AND l.status = 'ACTIVE'
            AND (   (l.type = 'INVITE'
                     AND l.inviter_id <> :u                                            -- 셀프 초대 거절
                     AND EXISTS (SELECT 1 FROM public.groups g                         -- 현행 findActiveGroup 과 동치
                                  WHERE g.id = l.group_id AND g.deleted_at IS NULL AND g.status <> 'ENDED')
                     AND EXISTS (SELECT 1 FROM public.group_members m                  -- 발급자 활성 멤버
                                  WHERE m.group_id = l.group_id AND m.user_id = l.inviter_id AND m.is_left = false))
                 OR (l.type = 'CAMPAIGN'
                     AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = l.campaign_id AND c.status = 'ACTIVE')))));
```

캠페인 링크 클릭은 많아서, 기기를 보지 않는 현행 규칙을 쓰면 다른 사람의 클릭에 붙는다. 캠페인 링크를 아는 앱은 새 파서를 가진 앱뿐이라 `deviceId` 필수가 구 앱을 깨지 않는다.

**신규 가입 여부를 claim 때 함께 기록한다.** 현 앱은 로그인 직후 `postAuthSave`(`auth.ts:170`, `isNewUser` 분기 뒤)에서 무조건 claim 을 부른다 — 광고로 설치하고 기존 계정으로 로그인한 사용자도 claim 한다. 그래서 붙이는 순간 `claimed_as_new_user = (users.created_at >= 기준 시각)` 을 채우고, 참이면 `signup_at = users.created_at` 도 저장한다. 기준 시각은 클릭이면 `clicked_at`, referrer 면 `COALESCE(install_begin_at, received_at)` 이다. 기존 계정 로그인은 귀속 기록은 남기되 가입 수(§3.2)에서 빠진다. 가입 수의 기간은 `claimed_at` 이 아니라 `signup_at` 이다 — 현 앱은 claim 실패를 삼키고 다음 로그인에서 재시도하므로(`deferredInvite.ts` `claimStoredInviteAttribution`) 며칠 뒤 성공한 claim 도 가입 날에 들어가야 한다. 게스트로 시작해도 유저 행이 새로 생기므로 신규다.

### 2.6 SKAN 귀속 (읽기 시점)

1. **채널**: `ad_network_id` 를 코드 상수 레지스트리(`SkanAdNetworks`)로 META · GOOGLE 에 대응시킨다. 없는 값은 `UNKNOWN`.
2. **캠페인**: 그 채널에서 `campaigns.skan_source_identifier` 가 포스트백 `source_identifier` 와 같으면 그 캠페인이다. 크라우드 익명성이 낮으면 Apple 은 source-identifier 의 **끝자리(least significant digits)** 2~3자리만 보낸다 — 예를 들어 `5239` 는 `39` 또는 `239` 로 온다. 그래서 포스트백 자릿수가 더 적으면 **등록 값의 끝자리가 일치하는 캠페인이 정확히 하나일 때만** 귀속하고, 둘 이상이면 채널 단위로 남긴다.
3. 저장된 행은 모두 서명 검증을 통과한 우리 앱의 포스트백이다(§4.2).

### 2.7 탈퇴

`UserService.erasePersonalData` 를 부르기 **전에**(그 메서드는 영속성 컨텍스트를 비우는 탈퇴 절차의 마지막이다) 같은 트랜잭션에서 세 벌크 UPDATE 를 실행한다. 이 트랜잭션은 시작부터 유저 행 배타 락을 쥐고 있어 §2.5 의 claim(공유 락)·§2.4-5 의 referrer 저장(배타 락)과 직렬화된다.

```sql
UPDATE public.invite_link_clicks SET claimed_user_id = NULL WHERE claimed_user_id = :userId;  -- contract 뒤 link_clicks
UPDATE public.install_referrers  SET claimed_user_id = NULL WHERE claimed_user_id = :userId;
UPDATE public.install_referrers  SET reporter_user_id = NULL WHERE reporter_user_id = :userId;
```

INVITE 링크 폐기(`ACCOUNT_WITHDRAWN`)는 contract 이미지부터 그룹 획득 문서의 멤버십 전이와 같은 트랜잭션에서 한다.

## 3. 내부 API (data-api `/internal/*`)

호출 규약은 #745 의 business → data 내부 호출을 따른다: `Authorization: Bearer ${SVC_TOKEN_BIZ_TO_DATA}`, `X-Request-Id`, 사용자 위임 호출은 `X-User-Id`, 콘솔 호출은 `X-Actor: console:<slot>`. 경로는 수신 측 허용목록(`internal.api.callers.business.allow`)에 하나씩 추가한다. 와일드카드로 묶지 않는다.

| 메서드·경로 | 호출자 | 요청 | 응답 |
| --- | --- | --- | --- |
| `POST /internal/links/{slug}/visits` | 랜딩 | `{clientIp, os, userAgent, refererHost}` | 200 `LandingView` · 404 |
| `GET /internal/links/{slug}` | `/l/resolve` | — | 200 `LinkView` · 404 |
| `POST /internal/links/match` | `/l/match` | `{os, deviceId, appInstanceId, clientIp}` | 200 `MatchResult` |
| `POST /internal/install-referrers` | `/l/referrer` · `X-User-Id` | 아래 | 200 `ReferrerResult`(저장 도중 탈퇴면 `attributionId` 없이 미저장) · 429 `REFERRER_DAILY_LIMIT`(미저장) |
| `POST /internal/links/claims` | claim · `X-User-Id` | `{slug}` 또는 `{slug, deviceId}` 또는 `{attributionId, deviceId}` | 200 · 404 `SLUG_NOT_FOUND`(INVITE slug 만) |
| `POST /internal/groups/{groupId}/invite-links` | 초대 발급 · `X-User-Id` | 없음 | 200 `{slug, url}` (현행 `IssueInviteLinkResponse`) |
| `POST /internal/skan-postbacks` | SKAN 수신 | 아래 | 201 신규 · 200 중복 |
| `GET /internal/campaigns?status=` | 콘솔 | — | 200 `[CampaignSummary]` |
| `POST /internal/campaigns` | 콘솔 | `{name, channel, platform, externalId?, skanSourceIdentifier?}` | 201 · 409 `CAMPAIGN_EXTERNAL_ID_TAKEN` · 409 `CAMPAIGN_SKAN_ID_TAKEN` · 422 형식 · 422 `EXTERNAL_ID_PLATFORM`(`externalId` 는 META 이면서 ANDROID·ALL 만) |
| `PATCH /internal/campaigns/{id}` | 콘솔 | `{name?, status?, externalId?, skanSourceIdentifier?}` | 200 · 409·422 위와 같음 |
| `POST /internal/campaigns/{id}/links` | 콘솔 | `{destination}` | 201 `{slug, url, playStoreUrl, destination}`(`playStoreUrl` 은 `slug` 만 심은 콘솔용, §4.4) · 409 `CAMPAIGN_ARCHIVED` · 422 `DESTINATION_NOT_ALLOWED` |
| `POST /internal/links/{slug}/revocations` | 콘솔 | `{}` | 204 · 422 `NOT_A_CAMPAIGN_LINK` |
| `GET /internal/campaigns/stats?from&to` | 콘솔 | — | 200 `CampaignStatsList` |
| `GET /internal/campaigns/{id}/stats?from&to` | 콘솔 | — | 200 `CampaignStats` |

### 3.1 응답 모양

```jsonc
// LandingView — INVITE, 활성
{"type": "INVITE", "slug": "k3m9x2pa", "state": "ACTIVE", "clickId": "0190d3c4-2a7e-7c11-8b3d-5e6f7a8b9c0d", "groupId": "0190d3a2-6c1e-7b44-9a51-3f0c2d7e8a10", "groupName": "새벽 공부방", "inviterName": "재영", "destination": null}
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
| `signups.claim` | `claimed_as_new_user = true` 인 `link_clicks` + `install_referrers` 중 `signup_at`(가입 시각)이 기간 안. 기존 계정 로그인 claim(`false`)은 뺀다. **`link_clicks` 쪽은 claim 된 `install_referrers` 행의 `click_id` 가 가리키는 클릭을 뺀다**(같은 설치의 가입은 referrer 원장에서만) | 확률 또는 결정 |
| `signups.skan` | `installs.skan` 과 같은 행 중 `conversion_value >= 1` 또는 `coarse_conversion_value IN ('medium','high')` | 집계·지연 |

- `installs.referrer` 를 첫 실행 시각(`received_at`)으로 자르면 설치 며칠 뒤에 처음 연 사용자가 다른 날·다른 캠페인 기간에 들어간다. Play 가 준 설치 시작 시각을 먼저 쓴다.
- referrer 로 귀속된 설치를 fingerprint 에서 빼기 위해 `install_referrers.click_id` 로 조인해 그 클릭을 뺀다(추가 컬럼 없음, 부분 인덱스 `idx_install_referrers_click`). §2.4-3 규칙으로 같은 기기의 LINK 설치는 fingerprint 매치가 이번 설치의 매치 창 안에서 먼저 났든 뒤에 오든 `click_id` 가 그 클릭을 가리키므로 두 칸에 한 번씩 잡히지 않는다. 다른 기기에 매치된 클릭은 별개 설치다.
- `signups.claim` 은 신규 유저만 센다. 기간은 claim 이 늦게 성공해도 가입 날로 잡히도록 `signup_at` 으로 자른다. 광고로 설치하고 기존 계정으로 로그인한 사용자는 설치에는 들어가고 가입에는 들어가지 않는다. 설치 수와 같은 규칙으로 중복을 뺀다 — 첫 실행에 referrer 읽기가 실패해 fingerprint 매치·slug claim 이 먼저 끝나고 다음 실행에 같은 LINK referrer 가 저장·claim 되면, 그 클릭(`install_referrers.click_id`)의 `link_clicks` 가입은 빼고 referrer 쪽 1건만 센다(anti-join, `idx_install_referrers_click`). 채널 합계도 같다.
- referrer 는 세션 확보 뒤 저장되므로(§2.4-5) 첫 실행 뒤 로그인·게스트 시작 없이 떠난 설치는 `installs.referrer` 에 들어가지 않는다. 대신 토큰 없는 위조 저장이 막힌다.
- `signups.skan` 은 첫 측정 창(0~2일)의 포스트백만 센다. 그 뒤 가입은 누락된다 — 콘솔에 표기한다.
- `notes`: `SKAN_DELAYED`(iOS 광고 캠페인) · `GOOGLE_CHANNEL_ONLY`(GOOGLE·ANDROID) · `SKAN_CHANNEL_ONLY`(iOS 광고인데 `skan_source_identifier` 없음).
- `CampaignStatsList` 는 캠페인별 `totals` 와, 캠페인에 귀속되지 않은 채널 단위 합(`channels.META`·`channels.GOOGLE` 의 `installs.referrer`·`installs.skan`·`signups.claim`·`signups.skan`)을 준다. GOOGLE referrer 와 캠페인에 매핑되지 않은 META referrer 의 신규 claim 은 개별 캠페인에 들어갈 수 없으므로 여기서 보인다.

## 4. 공개 표면 (business-api)

| 메서드·경로 | 인증 | 요청 | 응답 |
| --- | --- | --- | --- |
| `GET /l/{slug}` | 없음 | UA · IP | 200 HTML (활성 · 만료 · 강등 세 모양) |
| `GET /link/**` | 없음 | — | 정적 이미지(현 data-api `static/link/` 이사) |
| `POST /l/match` | 없음 | `{os, deviceId, appInstanceId?}` | 200 `MatchResult`(매치 없음은 `{matched:false}`) · 429 레이트리밋 · 503 일시 장애 |
| `POST /l/referrer` | **access token**(게스트 포함) | `{os:"android", deviceId, appInstanceId?, referrer, referrerClickTimestampSeconds?, installBeginTimestampSeconds?, referrerClickTimestampServerSeconds?, installBeginTimestampServerSeconds?, installVersion?}` | 200 `ReferrerResult` · 401 토큰 없음 · 429 IP·유저 상한 · 503 |
| `POST /l/resolve` | 없음 | `{slug}` | 200 `LinkView` · 404 없는 slug · 429 · 503. 클릭을 기록하지 않는다 |
| `GET /.well-known/apple-app-site-association` | 없음 | — | 현행 JSON 그대로(`appIDs` · `/l/*`) |
| `GET /.well-known/assetlinks.json` | 없음 | — | 신규. 패키지·서명 SHA-256 은 env |
| `POST /.well-known/skadnetwork/report-attribution/` (끝 슬래시 없는 경로도) | 없음(서명) | Apple JSON | 200 · 400 JSON 아님 · 413 16KB 초과 · 429 · 500 저장 실패 |
| `POST /api/v1/groups/{groupId}/invite-link` | JWT | — | 200 `{slug, url}` (현행) |
| `POST /api/v1/invite-links/claim` | JWT | `{slug}` · `{slug, deviceId}` · `{attributionId, deviceId}` | 200 · 404 `SLUG_NOT_FOUND` (현행) |
| `/console/**` | 콘솔 세션 | — | HTML (§6) |

`503` 에는 `Retry-After: 60` 을 붙인다. 현 앱 `deferredInvite.matchOnce` 는 2xx 를 받았을 때만 완료 플래그를 세우고, 오류·타임아웃이면 플래그 없이 끝나 다음 실행에 다시 묻는다(`deferredInvite.ts:94-108`). 그래서 일시 장애를 200 으로 접으면 귀속이 영구 유실되고, 503·429 는 구 앱에도 재시도를 준다.

`/l/referrer` 만 토큰을 요구한다. 무인증이면 누구나 `deviceId`·설치 시각·referrer 를 지어내 영구 행을 만들고 결정적 설치 수를 부풀릴 수 있다. 토큰을 요구하면 위조량이 게스트 생성 한도(현행 `GuestLoginRateLimiter` — IP 당 시간당 10회, 전체 시간당 300회)에 묶이고, 유저당 KST 당일 3건 상한(§2.4-5, 유저 행 배타 락 아래 원자 적용)이 한 번 더 막는다. 현 앱은 로그인 전에 토큰이 없으므로(`DeepLinkGate` 가 로그인 전에 무인증으로 매치를 부르고, 게스트 세션은 로그인 화면에서 게스트를 고를 때만 `/auth/guest` 로 생긴다) 저장은 세션 확보 뒤에 보낸다(§5). `/l/match` 는 구 앱 호환 때문에, `/l/resolve` 는 저장하지 않으므로 무인증으로 둔다. 앱·설치 증명(Play Integrity)은 출시 뒤 부풀림이 관측되면 붙인다(§11).

### 4.1 referrer 판별

Play 가 준 `referrer` 문자열을 URL 쿼리로 읽고 위에서부터 첫 규칙을 적용한다.

| 순서 | 조건 | source | 추출 |
| --- | --- | --- | --- |
| 1 | `slug` 키가 있다 | LINK | `slug`, `click`(있고 UUID 형식일 때만. 콘솔용 Play URL 은 `click` 없이도 LINK) |
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
- 한도(business-api Redis, 키 `linkrl:<route>:<ipHmac>`): `/l/match`·`/l/referrer`·`/l/resolve` 는 분당 30회, SKAN 수신은 분당 60회. 초과는 429 다. `/l/referrer` 는 여기에 더해 유저당 KST 당일 3건 저장 상한(§2.4-5)이 있다.

### 4.4 랜딩

- `LandingRenderer` 와 `invitelink/landing.html` 을 business-api 로 옮긴다. 단일 패스 치환 규칙은 유지한다.
- INVITE 랜딩의 `schemeUrl` 은 business-api 가 `LandingView` 의 `groupId`·`slug` 로 현행 형식 `gromo://join?g=<groupId>&s=<slug>` 을 만든다(`InviteLinkUrls.scheme` 이사). 구 앱의 초대 시트는 이 형식만 연다.
- 캠페인 링크는 별도 템플릿(`link/campaign-landing.html`)을 쓴다. 자리표시자: `pageTitle` · `schemeUrl`(= 목적지) · `iosStoreUrl` · `androidStoreUrl` · `storeState` · `ogImageUrl` · `expired`.
- **Android 스토어 버튼은 신규다**(현 템플릿엔 App Store 버튼만 있다). 두 템플릿 모두 `androidStoreUrl` 을 받아, 설정값 `LINK_ANDROID_PACKAGE` 가 비어 있으면 버튼을 숨긴다. 값이 있으면 Play URL 은 쓰임에 따라 둘이다.
  - **랜딩의 스토어 버튼**(방문 뒤): `https://play.google.com/store/apps/details?id=<패키지>&referrer=<URL 인코딩된 "slug=<slug>&click=<LandingView.clickId>">`. 봇 방문이라 `clickId` 가 없으면 `slug` 만 심는다.
  - **콘솔 발급 응답의 `playStoreUrl`**(광고·게시물에 직접 넣는 용, 방문 전): `referrer=<URL 인코딩된 "slug=<slug>">`. 방문이 없어 `click` 이 없고, 이 URL 로 설치해도 §4.1 1행으로 LINK 에 귀속된다.
  - `referrer` 를 통째로 빼는 건 **만료·강등 랜딩**뿐이다.
- 강등 랜딩(data-api 무응답): 그룹·캠페인 문구 없이 스토어 버튼만, 클릭 미기록.
- 목적지 허용 목록(정책 L13)은 business-api 와 data-api 가 공유하는 상수가 아니라 **data-api 가 발급 때 검증**하고, 초기값은 `gromo://`(앱 열기) 하나다.

## 5. 앱 계약 (앱 티켓)

| # | 변경 | 호환 |
| --- | --- | --- |
| 1 | 파서: `g=` 없는 `/l/{slug}` 도 유효. **앱이 설치된 상태에서 Universal Link·App Link 로 직접 열리면** `POST /l/resolve {slug}` 로 `type` 을 받아 CAMPAIGN 은 `destination` 으로, INVITE 는 `groupId` 로 초대 시트를 연다. 매치 응답도 같은 `type` 분기. 모르는 목적지는 앱 홈 | 서버는 구 필드 유지 |
| 2 | Android **첫 실행**: `InstallReferrerClient` 로 referrer 를 읽어 **로컬에서** 출처를 가린다 — `slug` 가 있으면 `POST /l/resolve {slug}` 로 초대 시트·목적지를 열고 `/l/match` 생략, Meta(`utm_content` JSON)·Google(`gclid`)이면 `/l/match` 생략, 그 밖이면 기존 매치. **fingerprint 매치의 완료 값 `deferredInviteChecked` 도 존재 플래그가 아니라 처리한 Play 설치 시작 시각으로 저장**하고, 저장값이 현재 Play 값과 다르면 새 설치로 보고 매치를 다시 시도한다(현 `deferredInvite.ts:84` 는 값이 있기만 하면 건너뛴다). iOS 는 앱을 지우면 앱 데이터가 함께 지워지므로 현행 플래그를 유지한다. **저장 `POST /l/referrer` 는 세션을 확보한 두 지점에서** access token 과 함께 보낸다: ① 로그인·게스트 시작 뒤 `postAuthSave` 안(claim 보다 먼저) ② **콜드스타트 세션 복원이 성공한 직후**(`App.tsx` 복원 effect 에서 `getMyProfile` 이 성공해 토큰이 유효로 확인된 뒤). Auto Backup 이 `STORAGE_KEYS.user`(토큰)와 `onboardingComplete` 까지 복원하면 재설치한 앱은 로그인 화면 없이 홈으로 가서 ① 이 불리지 않기 때문이다(`App.tsx:181-243` — 둘 다 있으면 `postAuthSave` 없이 복원, 매니페스트에 `fullBackupContent`·`dataExtractionRules` 없음). 오프라인이라 프로필 조회가 실패한 복원에서는 보내지 않고 다음 실행에 다시 본다. 두 지점 모두 **로컬에 읽어 둔 referrer 의 설치 시작 시각이 이미 보고한 값과 다를 때만** 보내고, ② 에서도 저장 응답 뒤 claim 을 부른다(복원된 세션은 기존 계정이라 가입 수에는 들어가지 않는다). 2xx 를 받으면 그때 처리한 설치 시작 시각(`installBeginTimestampServerSeconds`, 없으면 기기 값)을 완료 값으로 저장하고, 다음 세션에서 Play 가 준 설치 시작 시각이 저장값과 다르면 다시 보낸다(Auto Backup 복원 대비). **401·429·5xx·타임아웃이면 완료 값을 저장하지 않는다**(현 `deferredInvite.matchOnce` 와 같은 규칙). `attributionId` 보관 | 구 앱은 호출하지 않을 뿐 |
| 3 | claim: 캠페인 slug 는 `deviceId` 함께, referrer 귀속은 `/l/referrer` 응답을 받은 뒤 `{attributionId, deviceId}` | 구 앱의 `{slug}` 는 INVITE 규칙 |
| 4 | iOS: Info.plist `NSAdvertisingAttributionReportEndpoint = https://link.oneorthree.world`, `SKAdNetworkItems` 에 Meta·Google 식별자, 첫 실행 `updatePostbackConversionValue(0)` · 가입 1 · 첫 집중 완료 2 (coarse low·medium·high) | 서버 무관 |
| 5 | Android App Links: `MainActivity` 에 **`android:autoVerify="true"`** 인 인텐트 필터(`action VIEW` · `category DEFAULT`·`BROWSABLE` · `scheme=https` · `host=link.oneorthree.world` · `pathPrefix=/l/`)를 더한다. 현 `AndroidManifest.xml` 에는 `gromo` 스킴 필터뿐이다. `autoVerify` 가 없으면 서버에 `assetlinks.json` 이 있어도 Android 12 이상에서 검증된 App Link 로 등록되지 않아 설치된 앱이 링크로 열리지 않고, `/l/resolve` 흐름이 동작하지 않는다 | 서버 assetlinks 와 짝 |

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
| `/l/referrer` 토큰 없음 | 401 | — |
| `/l/referrer` 유저 KST 당일 상한 초과 | 429 · 미저장 | 카운터 |
| `/l/referrer` 저장 도중 탈퇴 | 200 · 미저장 · `attributionId` 없음 | DEBUG |
| 봇 UA 방문 | 랜딩 200 · 클릭 미기록 | DEBUG |
| referrer 복호화 실패 | 200 `{source:"META", matched:false}` | `decrypt_failed=true` |
| SKAN 본문 16KB 초과 | 413 | 카운터 |
| SKAN JSON 아님 | 400 | 카운터 |
| SKAN 다른 앱 · 서명 실패 · 모르는 버전 | 200 | **미저장**, 카운터 + `transaction-id` 샘플 로그 |
| SKAN 저장 실패(5초) | 500 | ERROR + `transaction-id` |
| claim 대상 없음·기기 불일치·셀프 초대·이미 선점·탈퇴한 유저 | 200 | DEBUG |
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

`LinkMembershipEventService` 를 지우면 멤버십 이탈 때 링크를 폐기하는 경로가 없어진다. 그 서비스는 없는 링크 서버로만 보냈고 현 main 에도 폐기가 없어 expand 기간이 현행보다 나빠지지는 않는다. **그룹 획득 LLD §2.1 의 같은 트랜잭션 폐기는 contract 이미지에서 켠다**(§1.1 — expand 에서 켜면 롤백한 이전 이미지가 폐기 행과 새 행을 함께 읽는다).

## 10. 테스트

| 층 | 검증 |
| --- | --- |
| data-api (Testcontainers) | expand 뒤 기존 slug 의 방문·매치·claim 회귀 · **expand 스키마에서 이전 이미지 엔티티가 `ddl-auto=validate` 로 기동** · contract 뒤 새 이미지 기동 · `ck_links_type_shape` 위반 거절 · expand 스키마에서 전체 unique 로 동시 발급이 한 slug 로 수렴 · **expand 이미지에서 폐기·재발급이 꺼져 한 쌍에 INVITE 행이 1개** · **contract ① 보정이 발급자 이탈·그룹 종료 행만 `REVOKED` 로 바꾸고 활성 행은 건드리지 않음** · contract 뒤 폐기 → 재발급이 새 slug 행을 만들고 부분 unique 로 동시 재발급이 수렴 · 같은 `install_key` 동시 referrer 2건이 1행 · 같은 `deviceId` 에 설치 시작 시각이 다른 referrer 는 2행(재설치) · LINK referrer 가 클릭을 소진해 다른 기기 fingerprint 가 그 클릭을 못 가져감 · **같은 기기에서 `/l/match` 가 먼저 성공한 뒤 LINK referrer 가 오면 `click_id` 가 그 클릭이고 설치 합계가 1** · **referrer 뒤의 `/l/match` 가 새 클릭을 소진하지 않음** · INVITE 링크 referrer 응답에 `groupId` · 방문 응답의 `clickId` 가 저장된 클릭 id 와 같음 · 캠페인 slug claim 의 기기 불일치 no-op · `attributionId` 기기 불일치 no-op · **탈퇴 트랜잭션 진행 중 들어온 claim 이 탈퇴 커밋 뒤 no-op 이고 `claimed_user_id`·`reporter_user_id` 가 NULL** · **봇 UA 방문이 클릭 행 0** · **같은 IP·OS 에서 최신 클릭이 폐기 링크면 더 오래된 활성 클릭을 소진하지 않고 `matched:false`** · 유저당 4번째 referrer 가 429·미저장이고 같은 `install_key` 재전송은 상한 미포함 · **같은 유저가 서로 다른 `install_key` 로 동시에 5건을 보내도 저장 3건** · **탈퇴 트랜잭션 진행 중 들어온 referrer 저장이 탈퇴 커밋 뒤 미저장** · **두 사용자가 같은 `attributionId` 로 동시에 claim 하면 한 명만 성공** · **claim 이 가입 며칠 뒤 성공해도 `signup_at` 의 날(가입 날)로 집계** · **`platform=IOS` 캠페인의 `external_id` 거절** · **GOOGLE referrer 의 신규 claim 이 `channels.GOOGLE.signups.claim` 에 들어감** · INVITE 방문 응답에 `groupId` · 매치 창 밖 재설치 기기가 새 후보를 매치 · **INVITE referrer 를 발급자 본인이 `attributionId` 로 claim 하면 no-op** · 기존 계정(`created_at` 이 클릭보다 이전) claim 은 `claimed_as_new_user=false` 이고 `signups.claim` 에서 빠짐 · **referrer 저장 뒤 발급자 이탈 · 그룹 종료 · 캠페인 링크 폐기가 오면 `attributionId` claim 이 no-op** · **같은 기기가 매치 창 밖에서 같은 링크로 재설치하면 `click_id=NULL` 이고 설치 2건** · **fingerprint 매치·slug claim 뒤 같은 설치의 LINK referrer 저장·claim 이 오면 가입 1건** · SKAN 재전송 1행 · 집계의 KST 경계(`to` 날 23:59 포함, 다음 날 00:00 제외) · `installs.referrer` 가 `install_begin_at` 기준(설치 전날·첫 실행 다음 날 경계) · SKAN 끝자리 대조(`5239` 등록, 포스트백 `39` → 귀속, `5239`·`1139` 둘 다 등록이면 채널 단위, `52` 는 비귀속) |
| business-api | referrer 판별 표(§4.1 다섯 규칙 + 깨진 인코딩 · 빈 문자열 · 변조된 Meta payload) · SKAN 서명 검증(버전별 Apple 문서 예시 포스트백을 픽스처로) · **서명 실패·다른 `app-id`·모르는 버전이 data-api 호출 0회** · 16KB 초과 413 · match·referrer·resolve 가 data-api 5xx·타임아웃이면 503 + `Retry-After`, 매치 없음은 200 · 레이트리밋 초과 429 · `/l/referrer` 토큰 없음 401·data-api 호출 0 · **Redis 키에 원본 IP 문자열이 없음** · resolve 가 클릭을 기록하지 않음 · 강등 랜딩 · 만료 랜딩의 Play URL 에 `referrer` 없음 · **콘솔 `playStoreUrl` 은 `slug` 만 든 referrer 이고 그 값이 §4.1 로 LINK** · INVITE 랜딩 스킴이 `gromo://join?g=…&s=…` · IP 신뢰(사설 피어만) · 콘솔 잠금 · 쿠키 변조 · 슬롯 제거 즉시 무효 · 폼 토큰 재사용 거절 |
| 앱 (앱 티켓) | Auto Backup 으로 세션·`onboardingComplete` 가 복원된 재설치에서 콜드스타트 복원 성공 뒤 `/l/referrer` 가 1회 나가고 claim 이 이어짐 · 오프라인 복원(프로필 조회 실패)에서는 보내지 않고 다음 실행에 보냄 · 보고한 설치 시작 시각과 같으면 두 지점 모두 재전송 없음 · `postAuthSave` 경로에서 referrer 저장이 claim 보다 먼저 |
| 전환 리허설 (dev) | nginx 전환 전후로 같은 slug 의 클릭 → 매치 → claim 이 끊기지 않음, 원복 reload 도 같음 · expand 이미지 → 이전 이미지 롤백 · contract 직전 RDS 스냅샷 생성과 dev 복원 리허설 |
| 실물 | Meta Android 테스트 광고 1건의 referrer 원문으로 픽스처 갱신. SKAN 은 실제 포스트백을 받기 전까지 콘솔에 "미검증"으로 표기 |

## 11. 확인 목록 (구현 착수 전)

| # | 확인 | 막히는 곳 |
| --- | --- | --- |
| 1 | Meta·Google 이 공개하는 SKAdNetwork 식별자 → `SkanAdNetworks` 레지스트리, 앱 `SKAdNetworkItems` | §2.6 · 앱 4 |
| 2 | Meta Install Referrer 복호화 방식과 키 발급 위치(Meta 앱 대시보드) | §4.1 |
| 3 | Apple SKAN 버전별 서명 대상 필드 순서와 공개키 | §4.2 |
| 4 | `link.oneorthree.world` 가 prod nginx 로 들어오는지(Infra `server_name`). AASA 를 지금 data-api 가 서빙하므로 그렇다고 보지만 문서화된 적이 없다 | HLD §7 4단계 |
| 5 | Android 패키지명·릴리즈 서명 SHA-256, Play 스토어 게시 상태, App Link 인텐트 필터의 `autoVerify` | §4.4 · 앱 5 |
| 6 | 개인정보처리방침의 IP 해시 · 기기 식별자 · Install Referrer 수집 고지 | 정책 L19 (출시 조건) |
| 7 | 구현 시점의 Flyway 최대 번호(열린 PR 포함) | §1.1 |
| 8 | prod Flyway 가 이력의 미래 버전을 무시하는지(`ignoreMigrationPatterns`, 기본 `*:future`). 무시하지 않으면 expand 뒤 이전 이미지 롤백이 Flyway 검증에서 막힌다(contract 는 roll-forward 전용) | §1.1 · HLD §7 |
| 9 | 출시 뒤 `installs.referrer` 가 광고 대시보드 설치 수보다 크게 부풀면 앱·설치 증명(Play Integrity API)을 `/l/referrer` 저장 조건에 더한다 | §4 · 정책 L23 |
