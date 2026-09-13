# 링크·어트리뷰션 상세 설계

[정책](policy.md)의 결정을 테이블·API·판정 규칙으로 옮긴다. 기준 main `875a9fd89`(이후 #745 머지 커밋 `1ec66e0dd` 와 합쳤다). #745 는 머지 커밋 `1ec66e0dd` 기준이다 — 앞서 대조한 head `a455bd182` 와 링크 관련 파일 차이가 없다. 날짜의 타임존 축은 [날짜 축 규약](../../conventions/date-axis.md)의 KST 고정을 따르고, 기간 `from`~`to` 를 시각 구간 `[from 00:00, to+1일 00:00)` KST 로 바꾸는 규칙은 이 설계가 정한다.

## 1. 데이터 모델

### 1.1 마이그레이션 — expand / contract

prod 는 `spring.jpa.hibernate.ddl-auto: validate`(`application-prod.yml`)라 엔티티가 보는 테이블이 없으면 이미지가 기동을 거부한다. 한 번에 rename 하면 이전 이미지로 되돌릴 수 없으므로 **두 파일로 나눈다.** 데이터 이관은 없다.

| 단계 | 파일 | 내용 | 이전 이미지로 롤백 |
| --- | --- | --- | --- |
| expand ([HLD §7](high-level-design.md#7-배포-순서) 2단계) | 구현 시점 최대 번호 다음 — 2026-09-13 기준 main(#745 머지)이 V54(`V53__result_bundle_completion`·`V54__legacy_session_device`)까지 쓰므로 **V55 이상**. 열린 PR(#751·#752·#753)도 V53·V54 를 다른 이름으로 쓰고 있어 머지 순서대로 다시 매긴다 | **기존 테이블 이름 그대로** 컬럼·제약·인덱스 추가, 신설 3개. **V21 전체 unique 유지**, rename·DROP 없음. 이 기간엔 링크 폐기·재발급을 켜지 않는다 | 가능. 이전 엔티티가 보는 테이블·컬럼이 그대로 있고, 한 `(group_id, inviter_id)` 에 INVITE 행이 하나뿐이라 이전 이미지의 단건 조회도 그대로 동작한다 |
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

- **`external_id`·`skan_source_identifier` 는 NULL 에서 한 번만 설정할 수 있다.** 설정된 값을 바꾸거나 지우는 PATCH 는 409 `CAMPAIGN_IDENTIFIER_IMMUTABLE` 이다(§3). 두 식별자는 읽기 시점 귀속의 키라(§1.5 · §2.6), 바꾸거나 지운 뒤 다른 캠페인에 다시 쓰면 이미 쌓인 설치·포스트백이 새 캠페인으로 옮겨가거나 미귀속으로 빠져 **과거 대시보드 수치가 소급해서 바뀐다.** 잘못 넣었으면 그 캠페인을 보관하고 새 캠페인을 만든다.
- 두 unique 인덱스의 조건은 `WHERE … IS NOT NULL` 뿐이라 **보관된 캠페인의 값도 계속 점유**한다 — 보관 뒤에도 같은 식별자를 다른 캠페인에 다시 쓸 수 없다(409 `CAMPAIGN_EXTERNAL_ID_TAKEN`·`CAMPAIGN_SKAN_ID_TAKEN`).
- 불변 규칙은 DB 트리거가 아니라 API 검증으로 강제한다. PATCH 는 캠페인 행을 배타 락으로 잡고(§2.5 잠금 순서의 campaign 단계) 기존 값과 비교한다.

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

expand 에서 컬럼 셋과 인덱스 다섯(기간 집계 셋 · 랜딩 클릭 저장 상한 하나 · claim 사용자 하나)을 더하고 contract 에서 rename 한다. 기존 컬럼·인덱스(`idx_invite_clicks_match` · `idx_invite_clicks_link` · `idx_invite_clicks_device`)는 그대로다.

```sql
ALTER TABLE public.invite_link_clicks
    ADD COLUMN matched_install_id  varchar(64),  -- 매치한 설치의 installId(§2.3). NULL = installId 없는 구 앱의 매치 또는 기록 이전 행
    ADD COLUMN claimed_as_new_user boolean,      -- claim 때 기록(§2.5). NULL = 미claim 또는 기록 이전 행
    ADD COLUMN signup_at           timestamptz;  -- 신규면 users.created_at. 가입 수의 기간 기준(§3.2)

-- 기간 집계(§3.2). 기존 idx_invite_clicks_link(link_id) 만으로는 기간을 좁히지 못해 오래된 링크의 최근 7일 통계도 전체 이력을 읽는다
CREATE INDEX idx_invite_clicks_link_clicked ON public.invite_link_clicks (link_id, clicked_at);
CREATE INDEX idx_invite_clicks_link_matched ON public.invite_link_clicks (link_id, matched_at) WHERE matched;
CREATE INDEX idx_invite_clicks_link_signup  ON public.invite_link_clicks (link_id, signup_at) WHERE signup_at IS NOT NULL;

-- 랜딩 클릭 저장 상한(§2.2). 매치 여부와 무관한 창 안 전체 수를 센다 — idx_invite_clicks_match 는 matched=false 부분 인덱스라 못 세고,
-- (link_id, clicked_at) 만으로는 인기 링크의 창 안 클릭을 전부 읽은 뒤 ip_hash·os 로 걸러야 한다
CREATE INDEX idx_invite_clicks_recent ON public.invite_link_clicks (link_id, ip_hash, os, clicked_at);

-- 탈퇴 익명화(§2.7)와 사용자당 신규 가입 확인(§2.5). 둘 다 유저 행 배타 락을 쥔 채 조회하므로 전체 스캔이면 락 시간이 늘어 로그인 직후 요청이 밀린다
CREATE INDEX idx_invite_clicks_claimed_user ON public.invite_link_clicks (claimed_user_id) WHERE claimed_user_id IS NOT NULL;
```

 Referrer 설치는 링크가 없을 수 있어 이 테이블에 넣지 않는다(§1.5).

### 1.5 `install_referrers` (신설 — Android)

```sql
CREATE TABLE public.install_referrers (
    id                uuid          PRIMARY KEY,
    install_key       varchar(140)  NOT NULL,   -- deviceId + ":" + (설치 시작 시각(초) | 없으면 "iid:" + installId). §2.4-1
    install_id        varchar(64)   NOT NULL,   -- 앱이 백업 제외 저장소에 둔 설치 식별자(§5 6행). §2.4-3
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
-- signups.claim 의 기간(signup_at) 조회(§3.2). 설치 기간 인덱스는 위 COALESCE 식 셋이 맡는다
CREATE INDEX idx_install_referrers_link_signup   ON public.install_referrers (link_id, signup_at) WHERE link_id IS NOT NULL AND signup_at IS NOT NULL;
CREATE INDEX idx_install_referrers_meta_signup   ON public.install_referrers (meta_campaign_id, signup_at) WHERE meta_campaign_id IS NOT NULL AND signup_at IS NOT NULL;
CREATE INDEX idx_install_referrers_source_signup ON public.install_referrers (source, signup_at) WHERE signup_at IS NOT NULL;
-- 탈퇴 익명화(§2.7)와 사용자당 신규 가입 확인(§2.5). reporter_user_id 익명화는 위 idx_install_referrers_reporter 가 맡는다
CREATE INDEX idx_install_referrers_claimed_user ON public.install_referrers (claimed_user_id) WHERE claimed_user_id IS NOT NULL;
```

- FK 는 contract 의 rename 을 따라간다.
- **설치 단위는 `install_key`** 다. 앱은 `android:allowBackup="true"`(`AndroidManifest.xml`)라 Auto Backup 이 `deviceId` 와 완료 플래그를 재설치 뒤에도 복원할 수 있다. 기기 단위로 멱등을 잡으면 다른 광고로 재설치한 설치가 과거 귀속에 묻힌다. 재설치는 새 설치 행이다. Play 설치 시작 시각이 없으면 `deviceId` 만 남아 그런 요청이 모두 한 키가 되므로, 앱이 백업 제외 저장소에 둔 `installId`(§5 6행)로 대신한다(`<deviceId>:iid:<installId>`).
- **캠페인 귀속은 읽기 시점에 한다.** LINK 는 `links.campaign_id`, META 는 `campaigns.external_id = meta_campaign_id`, GOOGLE 은 채널만. 콘솔에서 Meta 캠페인을 늦게 등록해도 그 전에 들어온 설치가 붙는다. 같은 이유로 `external_id` 는 한 번 설정하면 바꾸거나 지울 수 없다(§1.2) — 바꾸면 과거 설치의 귀속이 소급해서 옮겨간다.
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
| INVITE | `status=ACTIVE` + 그룹 활성(현행 `findActiveGroup`) + 그룹 획득 문서의 발급자 활성 멤버 조건(**contract 이미지부터** — expand 기간에는 현행처럼 `findActiveGroup` 만) |
| CAMPAIGN | `status=ACTIVE` + 캠페인 `status=ACTIVE` |

활성이 아닌 링크는 클릭을 기록하지 않고 referrer·claim 귀속 대상이 되지 않는다. 매치에서는 후보를 고르는 조건이 아니라 **고른 뒤 검증하는 조건**이다(§2.3, 정책 L14). expand 동안에는 `status` 가 모두 `ACTIVE` 이고 발급자 활성 멤버 조건도 켜지 않으므로(PRD 수용 조건 「contract 단계부터」) INVITE 활성 조건은 현행(`findActiveGroup`)과 같다. 이 판정을 바꾸는 쓰기와 claim 의 잠금 순서는 §2.5 에 모았다 — INVITE 는 user → group·membership → link, CAMPAIGN 은 **user → campaign → link** 다. 캠페인 보관·링크 폐기·링크 발급도 campaign → link 순으로 잠가, claim 이 ACTIVE 를 읽은 직후 보관이 커밋되고 claim 이 뒤이어 성공하는 일이 없다.

### 2.2 방문 (`visits`)

활성이면(아래 「기록하지 않는 방문」이 아니면) `link_clicks` 에 한 행을 넣고(`ip_hash = SHA-256(ip + LINK_IP_SALT)`, 현행 `IpHasher`) `LandingView` 에 **그 클릭의 id 를 `clickId` 로**, INVITE 면 **`groupId`** 도, CAMPAIGN 이면 **`campaignPlatform`**(스토어 버튼 선택, §4.4)도 담아 돌려준다. business-api 는 DB 를 읽지 않으므로 Android 스토어 버튼의 `click` 파라미터(§4.4)는 이 `clickId` 로만, 스킴 버튼의 `gromo://join?g=<groupId>&s=<slug>`(현행 `InviteLinkUrls.scheme` — 구 앱이 초대 시트를 여는 형식)는 이 `groupId` 로만 만들 수 있다. 비활성이면 행 없이 `state=EXPIRED`·`clickId=null` 뷰를 돌려준다. 없는 slug 는 404.

**봇 UA 는 기록하지 않는다.** 카카오톡·Slack·Meta 같은 링크 미리보기 수집기는 사용자가 열기 전에도 `GET /l/{slug}` 를 부른다. data-api 가 요청 바디의 `userAgent` 를 현행 `UserAgentClassifier.isBot` 으로 판별해, 봇이면 활성 링크라도 행을 넣지 않고 `clickId=null` 뷰를 돌려준다(OG 렌더는 그대로). 현행 `InviteLinkClickService.record` 와 같은 규칙이다.

**`recordClick=false` 방문은 기록하지 않는다.** 요청의 `recordClick`(기본 `true`)이 `false` 면 활성 판정·뷰 구성은 같게 하되 클릭 행을 만들지 않고 `clickId=null` 인 같은 `LandingView` 를 돌려준다. business-api 가 IP 한도(§4.3)를 넘은 방문에 이렇게 부른다 — business-api 는 DB 를 읽지 않아 그룹명·초대자명·`destination`·`campaignPlatform`·활성 상태를 이 호출로만 얻으므로, 호출을 건너뛰면 정상 랜딩 대신 강등 화면밖에 그리지 못한다.

**유료 채널 캠페인의 iOS 방문은 기록하지 않는다.** 링크가 CAMPAIGN 이고 캠페인 `channel IN ('META', 'GOOGLE')` 이며 요청 `os = 'ios'` 면, 활성이어도 클릭 행을 만들지 않고 `clickId=null` 뷰를 돌려준다(랜딩 렌더는 그대로). 클릭 행이 없으니 fingerprint 매치 후보가 생기지 않아 정책 L08(iOS 광고에 fingerprint 금지)이 발급 경로와 무관하게 지켜진다 — 콘솔은 META·GOOGLE 의 IOS·ALL 캠페인에도 일반 캠페인 링크를 발급하므로 발급 단계로는 막지 못한다. Android 방문은 기록한다(Play referrer 로 결정적으로 귀속되는 경로, §4.4). ORGANIC 캠페인의 iOS 방문도 기록한다.

**같은 링크·IP 해시·OS 의 클릭은 매치 여부와 무관하게 매치 창(`LINK_MATCH_WINDOW_HOURS`) 안에서 20건까지만 새로 만든다.** 21번째 방문부터는 새 행 없이 그중 가장 최근 클릭의 id 를 `clickId` 로 돌려준다(조회는 `idx_invite_clicks_recent`, §1.4). 미매치 클릭만 세면 방문과 공개 `/l/match` 를 번갈아 부르며 매번 다른 `deviceId` 로 후보를 소진해 건수를 20 아래로 되돌리고 계속 INSERT 할 수 있다 — 전체 수는 매치로 줄지 않는다. `User-Agent` 는 호출자가 정상 브라우저 값으로 지어낼 수 있어 봇 판별만으로는 저장량을 막지 못한다 — 현행 `record` 에는 봇 판별만 있고 상한이 없다. 1건으로 합치지 않는 이유는 같은 와이파이(같은 공인 IP)에서 같은 OS 로 여러 사람이 같은 링크를 누를 때 각자 설치를 매치할 후보가 필요해서다. 건수 확인과 INSERT 사이에 잠금이 없어 동시 방문으로 몇 건 넘을 수 있지만, 목적이 저장량 상한이라 허용한다. business-api 의 IP 한도(§4.3)가 앞에서 한 번 더 막는다.

### 2.3 fingerprint 매치

현행 `InviteLinkMatchService.match` 를 쓰되(`ip_hash + os + LINK_MATCH_WINDOW_HOURS`, `PESSIMISTIC_WRITE` + `SKIP LOCKED`, 기존 매치 재반환) **재반환 조건만 설치 단위로 좁힌다**(이 절 끝). **활성 조건을 후보 조회에 넣지 않는다.** 현행처럼 창 안의 최신 미매치 클릭을 후보로 고정하고, 소진한 뒤 §2.1 활성 판정을 하고, 실패면 `matched:false` 로 끝낸다 — 더 오래된 다른 후보로 내려가지 않는다. 활성 조건으로 먼저 거르면 같은 IP·OS 에서 더 최근에 폐기된 클릭 뒤의 과거 클릭이 이 기기에 엉뚱하게 귀속된다. 기존 매치 재반환도 같은 활성 판정을 거친다. 현행 재반환은 매치 창 안의 매치를 기기로만 찾는다(`findFirstByMatchedDeviceIdAndMatchedAtAfterOrderByMatchedAtDesc(deviceId, cutoff)`). 그래서 창 밖 재설치는 새 후보를 매치하지만, **창 안에서 재설치**하면 Auto Backup 이 복원한 같은 `deviceId` 로 과거 매치가 재반환돼 새 링크의 설치가 기록되지 않는다(referrer 읽기에 실패해 fingerprint 로 내려온 경우). 그러므로 매치 때 `matched_install_id` 에 요청의 `installId` 를 기록하고, **재반환은 `matched_device_id = deviceId` · `matched_install_id = installId` · 매치 창 안일 때만** 한다. 요청에 `installId` 가 없으면(구 앱) 현행 규칙(기기·창)을 그대로 쓴다. 응답에 `type` 과, CAMPAIGN 이면 `destination` 을 싣는다.

### 2.4 Install Referrer 저장

1. `install_key = deviceId + ":" + 설치 시작 초`. 설치 시작 초의 서버·기기 우선순위(`installBeginTimestampServerSeconds` 우선, 없으면 `installBeginTimestampSeconds`)는 **business-api 가 정해 `installBeginAt` 으로 넘기고**(§4.1), data-api 는 그 값만 쓴다. 값이 없으면 `"iid:" + installId` 를 쓴다 — Play 설치 시각이 비는 요청이 모두 `<deviceId>:0` 한 키로 모이면, Auto Backup 으로 `deviceId` 가 복원된 재설치가 과거 행을 돌려받아 새 설치·귀속이 기록되지 않는다. `installId` 는 앱이 백업 제외 저장소에 두는 설치 식별자(§5 6행)이고 **`/l/referrer` 에서 필수**다 — 새 엔드포인트라 보내지 않는 구 앱이 없고, 없으면 business-api 가 400 으로 거절해 저장하지 않는다(200 미저장으로 두면 앱이 완료로 저장해 다시 보내지 않는다). Play 설치 시각을 먼저 쓰는 이유는 Play 가 설치마다 한 번 정하는 값이 앱이 만든 식별자보다 안정적이기 때문이다. **한계**: `install_key` 는 늘 `deviceId` 를 접두사로 가지므로, 사용자가 **앱 데이터를 지우면** `deviceId`(AsyncStorage)와 `installId` 가 함께 재발급돼 Play 가 같은 설치 시작 시각을 돌려줘도 키가 `<새 deviceId>:<같은 시각>` 으로 달라지고 **같은 설치를 새 설치로 한 번 더 센다**. 기기 식별자(ANDROID_ID 등)는 쓰지 않는다. 출시 뒤 과집계가 관측되면 Play 서버 설치 시각 + referrer 원문 해시로 중복을 걸러낸다(§11-10). **같은 `install_key` 행이 있으면 그 행을 그대로 돌려준다**(`uq_install_referrers_install` 충돌 시 재조회). 설치 시작 시각이 다르면 재설치로 보고 새 행을 만든다.
2. `source=LINK` 로 들어왔는데 slug 가 활성 링크가 아니면 `source=UNKNOWN`, `link_id=NULL` 로 저장하고 응답은 `matched=false` 다(정책 L14). 활성 판정은 **§2.4-5 의 user 락 다음에 링크 쪽 행을 잠근 뒤** 한다 — CAMPAIGN 은 `campaigns` → `links`, INVITE 는 groupId 순 `groups` · 발급자 `group_members` → `links`(§2.5 와 같은 순서). 잠금 없이 확인하면 확인 직후 캠페인 보관·링크 폐기가 커밋되고 저장이 뒤이어 `link_id` 가 있는 행과 `matched=true` 를 남긴다 — 뒤의 claim 은 재검증으로 거절되지만 §3.2 의 `installs.referrer` 는 저장 뒤 활성 상태를 다시 보지 않아 폐기된 캠페인에 설치가 남는다. 잠금 아래 재검증에서 비활성이면 위와 같이 UNKNOWN 으로 저장한다.
3. `source=LINK` 이면 `click_id` 를 아래 순서로 정한다. 한 설치가 fingerprint 와 referrer 양쪽에 잡히지 않게 하려는 규칙이다.
   1. 전달된 `clickId` 가 그 링크의 **미매치** 클릭이면 그 클릭을 `PESSIMISTIC_WRITE` 로 잠가 `matched=true`·`matched_at`·`matched_device_id`·`matched_install_id`·`app_instance_id` 를 채우고 `click_id` 로 둔다. 같은 클릭이 fingerprint 로 다른 기기에 다시 매치되지 않는다.
   2. 아니면(전달값 없음 · 이미 매치됨 · 다른 링크의 클릭) **같은 링크에서 이 `deviceId` 로 매치된 클릭 중 아래 둘 중 하나에 해당하는 것**이 있으면, 그중 `matched_at` 이 `COALESCE(install_begin_at, received_at)` 에 가장 가까운 클릭을 `click_id` 로 둔다. 이번 설치에서 레이스로 `/l/match` 가 먼저 성공한 경우다.
      - `matched_install_id = installId` — 같은 설치의 매치.
      - `matched_install_id IS NULL`(installId 없는 구 앱의 매치)이면서 **`install_begin_at IS NOT NULL AND matched_at >= install_begin_at`** — 이번 설치가 시작된 뒤의 매치.

      그 밖 — 다른 `installId` 의 매치, 설치 시각이 없는 referrer 에서의 NULL 매치, 설치 시작 전의 NULL 매치 — 는 이전 설치의 것일 수 있어 연결하지 않는다. 구 앱이 설치 A 에서 만든 NULL 매치 뒤 같은 기기·링크로 매치 창 안에 재설치 B 를 하면, 창 기준 하한으로는 A 의 매치가 B 에 연결돼 §3.2 가 A 의 fingerprint 설치를 소급해서 빼고 실제 2건이 1건이 된다.
   3. 둘 다 아니면(다른 기기에 매치된 클릭뿐이거나 이 기기의 매치가 위 조건 밖) `click_id=NULL` 로 저장만 한다. 그 클릭은 별개 설치다.

   referrer 가 먼저 오고 `/l/match` 가 뒤에 오면, 매치는 「같은 설치의 기존 매치 재반환」(§2.3 — 1-i 가 `matched_install_id` 를 채운다)으로 1-i 에서 소진된 클릭을 돌려줄 뿐 새 클릭을 소진하지 않는다.
4. 응답 `ReferrerResult` 는 `attributionId`·`source` 에 `MatchResult` 와 같은 필드(`matched`·`type`·`slug`·INVITE 면 `groupId`·CAMPAIGN 이면 `destination`)를 싣는다. `matched` 는 **활성 링크로 귀속된 LINK 일 때만** `true` 다. INVITE 링크를 거친 Android 설치는 `/l/match` 를 건너뛰므로(정책 L12) 초대 맥락을 첫 실행의 `/l/resolve` 와 세션 확보 뒤의 이 응답 중 먼저 온 쪽으로 복원한다 — 그래서 `groupId` 를 싣는다. META·GOOGLE 은 `matched=false` 다. ORGANIC·UNKNOWN 도 `matched=false` 이고 응답의 `attributionId` 는 앱이 보관하지 않는다 — 귀속이 없는 기록이라 claim 대상이 아니다(§2.5·§3.2). fingerprint 생략은 앱이 첫 실행에 로컬에서 판단한다.
5. **저장은 access token 이 있는 요청만 받는다**(게스트 포함, §4). 트랜잭션 첫 조회로 `SELECT … FROM users WHERE id = :reporterUserId AND is_deleted = false FOR UPDATE` 를 잡는다 — 구현은 기존 `UserQueryService.getCallerForUpdate`(`UserRepository.findActiveByIdForUpdate`: `u.isDeleted = false` + `PESSIMISTIC_WRITE`)를 쓴다. 소프트 삭제 컬럼은 `users.is_deleted` 다(`V2__align_common_columns.sql`).
   - 행이 없으면(저장 도중 탈퇴) 저장하지 않고 200 `{source, matched:false}`(`attributionId` 없음)로 끝낸다. 토큰은 이미 무효라 앱이 다시 보내도 401 이다.
   - 같은 `install_key` 행이 있으면 1번대로 그 행을 돌려준다. 재전송은 상한에 세지 않는다.
   - 그 밖엔 **같은 락 안에서** `reporter_user_id = :u` 이고 `received_at` 이 KST 오늘인 행을 세어, 3 이상이면 저장하지 않고 429, 아니면 INSERT 한다. 락이 count 와 INSERT 를 직렬화하므로 동시 요청으로 상한을 넘지 못한다.
   - 탈퇴(`getCallerForUpdate` 배타 락)와도 직렬화되어, 탈퇴 커밋 뒤에 `reporter_user_id` 가 다시 기록되지 않는다. claim(같은 유저 행 배타 락, §2.5)과도 직렬화되지만 앱은 referrer 저장 → claim 을 차례로 부르므로 한 트랜잭션이 두 요청의 락을 함께 쥐지 않아 교착이 없다. referrer 저장이 잠그는 user 행은 요청자 하나뿐이라 claim 의 정렬된 user 락(§2.5)과 순서가 어긋나지 않는다. LINK 면 그 뒤 링크 쪽 행(§2.4-2) → 클릭(§2.4-3-1) 순으로 잠가 §2.5 와 같은 한 방향이다.

### 2.5 claim

**잠금 순서.** 모든 claim 은 먼저 **잠금 없이** 대상(slug 분기는 링크, `attributionId` 분기는 referrer 행과 그 링크)을 한 번 읽어 **관련 user ID 집합**을 구한다 — 요청 유저, INVITE 링크면 발급자까지. 그 뒤 아래 순서로만 잠근다. **요청 유저 행을 따로 먼저 잠그지 않는다.**

1. **user** — 관련 user 행을 **UUID 오름차순으로 배타 락**(`SELECT … FROM users WHERE id = ANY(:ids) AND is_deleted = false ORDER BY id FOR UPDATE`. 한 명이면 기존 `UserQueryService.getCallerForUpdate`, 즉 `UserRepository.findActiveByIdForUpdate`). 요청 유저 행이 없으면(탈퇴) no-op 200 이다.
2. **링크 쪽** — INVITE 는 groupId 오름차순의 `groups` 행 → 발급자 `group_members` 행 → `links` 행, CAMPAIGN 은 `campaigns` 행 → `links` 행. `link_id` 가 없는 referrer(META · GOOGLE · ORGANIC · UNKNOWN)는 이 단계가 없다.
3. **대상 행** — slug 분기는 후보 클릭(`PESSIMISTIC_WRITE` + `SKIP LOCKED`), `attributionId` 분기는 referrer 행(조건부 UPDATE)과 참값을 옮길 클릭(아래 「연결된 두 원장」).
4. 잠금 아래에서 조건(미claim · 기기·설치 · 셀프 초대 · §2.1 활성)을 전부 재검증하고 UPDATE 한다. 잠금 없이 읽은 뒤 바뀐 상태(링크 폐기·캠페인 보관·탈퇴)는 여기서 잡는다. 관련 user 집합은 바뀌지 않는다 — 링크의 `inviter_id` 는 발급 뒤 불변이다.

**교착이 없는 이유.** claim · 링크 발급 · 링크 폐기 · 캠페인 보관 · 탈퇴 · referrer 저장이 모두 user → (group·membership | campaign) → link → 대상 행의 한 방향으로, 같은 단계 안에서는 id 오름차순으로 잠근다. 사용자 A 가 B 의 초대 링크를, B 가 A 의 초대 링크를 동시에 claim 해도 두 트랜잭션 모두 {A, B} 를 UUID 오름차순으로 잠그므로 한쪽이 둘 다 잡은 뒤 다른 쪽이 기다린다. 요청 유저 행을 먼저 잡으면 각자 자기 행을 쥔 채 상대 행을 기다리는 순환이 생겨 PostgreSQL 이 한쪽을 교착 희생자로 중단시킨다. referrer 저장(§2.4-2·§2.4-5)은 요청 유저 한 명 → (LINK 면) 링크 쪽 행 → 클릭 순으로 잠그고, 앱은 referrer 저장 → claim 을 차례로 부르므로 한 트랜잭션이 두 요청의 락을 함께 쥐지 않는다.

user 행을 배타 락으로 잡는 이유는 둘이다.

1. **탈퇴와 직렬화** — 탈퇴(`AccountWithdrawalService.withdraw`)도 `getCallerForUpdate` 로 같은 행을 잡으므로, claim 은 탈퇴 커밋 뒤에 활성 조건을 재평가해 빈 결과가 된다. §2.7 의 UPDATE 뒤·커밋 전에 끼어든 claim 이 `claimed_user_id` 를 남기지 않는다.
2. **같은 사용자의 동시 claim 직렬화** — 공유 락이면 한 사용자가 두 `attributionId`·캠페인 slug 를 동시에 claim 할 때 두 트랜잭션이 함께 들어와 둘 다 신규 가입으로 기록한다(아래 「사용자당 신규 가입 1건」).

**링크에 붙는 claim 은 잠근 뒤 재검증하고 UPDATE 한다.** 조건부 UPDATE 의 `EXISTS` 는 읽기만 하므로, 발급자 이탈·그룹 종료·캠페인 보관 트랜잭션이 커밋되는 사이에 claim 이 활성 스냅샷으로 커밋될 수 있다 — 발급자와 claim 사용자가 다르면 요청 유저 행 락만으로는 이탈 트랜잭션과 충돌하지 않고, 캠페인 보관은 링크 락과 충돌하지 않는다.

- **INVITE** — [그룹 획득 LLD §2.1](../group/features/01-acquisition/low-level-design.md) 의 규칙 「초대 write 경로는 slug를 잠금 없이 한 번 읽어 대상 ID를 찾은 뒤 **관련 user UUID 오름차순 → groupId 오름차순의 group·membership → active link ID** 순으로 잠그고 모든 조건을 재검증한다」를 그대로 따른다 — 위 1·2단계가 그 순서다. 그 아래에서 §2.1 활성 조건(링크 `status` · 그룹 활성 · 발급자 활성 멤버)과 셀프 초대를 재검증한 뒤 UPDATE 한다. 폐기와 claim 중 먼저 잠근 쪽이 커밋되고, 다른 쪽은 커밋된 상태를 재검증한다 — 이탈이 먼저면 claim 이 no-op, claim 이 먼저면 그 claim 은 폐기 전 감사 이력으로 남는다(그룹 획득 HLD §2 와 같다).
- **CAMPAIGN** — `campaigns` 행 → `links` 행 순으로 `PESSIMISTIC_WRITE` 로 잠그고 링크·캠페인 ACTIVE 를 재검증한다. 콘솔 캠페인 수정·보관(`PATCH /internal/campaigns/{id}`)은 `campaigns` 행을 배타 락으로, 링크 폐기(`POST /internal/links/{slug}/revocations`)는 `campaigns` → `links` 순으로, **링크 발급(`POST /internal/campaigns/{id}/links`)은 `campaigns` 행 배타 락 아래 캠페인 ACTIVE 확인 → link INSERT** 순으로 잠근다. 발급이 ACTIVE 를 읽은 직후 보관이 커밋되면 201 과 함께 생성 직후부터 만료인 URL 을 돌려주게 되므로 발급도 같은 락 아래 둔다 — 보관이 먼저면 발급은 409 `CAMPAIGN_ARCHIVED`, 발급이 먼저면 링크가 만들어진 뒤 보관된다. 그래서 보관·폐기와 claim 중 먼저 잠근 쪽이 커밋되고 다른 쪽은 커밋된 상태를 재검증한다 — 보관·폐기가 먼저면 claim 이 no-op 이다. 캠페인 ACTIVE 를 재조회만 하면, claim 이 ACTIVE 를 읽은 직후 보관이 커밋되고 claim 이 뒤이어 성공해 보관된 캠페인에 신규 가입이 남는다.
- `link_id` 가 없는 referrer(META · GOOGLE · ORGANIC · UNKNOWN)는 링크 잠금이 없다.

요청은 `slug` 또는 `attributionId` 중 정확히 하나를 싣고, `attributionId` 는 `deviceId`·`installId` 와 함께 보낸다.

**미claim 판정은 모든 분기에서 `claimed_at IS NULL` 이다.** §2.7 탈퇴 익명화는 `claimed_user_id` 만 지우고 `claimed_at` 을 남기므로, `claimed_user_id IS NULL` 로 판정하면 탈퇴한 사용자가 claim 했던 클릭·referrer 를 다른 계정이 다시 선점해 `claimed_at`·`signup_at`·가입 귀속을 덮어쓴다. 현행 finder `findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNullOrderByMatchedAtDesc` 와 `InviteLinkClick.claim` 의 `claimedUserId != null` 검사는 구현 PR 이 `ClaimedAtIsNull`·`claimedAt != null` 로 바꾼다.

| 입력 | 규칙 | 응답 |
| --- | --- | --- |
| `slug` (INVITE) | 현행 그대로: 그 링크의 가장 최근 `matched=true`·미claim 클릭에 붙인다. `deviceId` 가 오면 `matched_device_id` 가 같은 클릭을 먼저 찾는다. 셀프 초대·이미 claim·REVOKED 등 비활성 링크(§2.1)는 no-op | 200. 없는 slug 는 현행 `SLUG_NOT_FOUND`(404) 유지 |
| `slug` (CAMPAIGN) | `deviceId` **필수**. `matched_device_id = deviceId` 인 미claim 클릭에만 붙인다. 후보 클릭은 현행 slug claim 과 같은 `PESSIMISTIC_WRITE` + `SKIP LOCKED` 로 선점한다. 없으면 no-op | 200 |
| `attributionId` | 조건부 UPDATE 한 번으로 **원자적으로 선점**한다(표 아래 SQL). 조건은 ① 미선점(`claimed_at IS NULL`) · 기기·설치 일치(`device_id`·`install_id` — `attributionId`·`deviceId` 는 앱 저장소라 Auto Backup 으로 복원될 수 있어, 백업되지 않는 `installId` 까지 맞아야 같은 설치다) ② 셀프 초대 거절(slug 분기와 같은 규칙) ③ **링크 활성 재검증** — `link_id` 가 없으면(META · GOOGLE · ORGANIC · UNKNOWN) 검사하지 않고, 있으면 slug 분기와 같은 §2.1 판정을 claim 시점에 다시 한다. referrer 저장 뒤 claim 전에 발급자가 이탈하거나 그룹이 끝나거나 캠페인 링크가 폐기되면 no-op 이다. ④ **출처가 LINK·META·GOOGLE** — ORGANIC·UNKNOWN 행은 귀속이 없는 기록이라 가리켜도 no-op 이다(§3.2). 영향 행 1 이면 성공, 0 이면 no-op(이미 선점 · 기기·설치 불일치 · 셀프 초대 · 비활성 링크 · ORGANIC·UNKNOWN). user 행 락은 서로 관련 없는 두 사용자의 동시 claim 을 막지 못하므로, 대상 행 조건으로 막는다 | 200 |

```sql
-- attributionId claim. :u·:userCreatedAt 은 같은 트랜잭션의 FOR UPDATE 유저 조회에서 온다
-- 링크가 있으면 이 UPDATE 전에 위 잠금 순서로 행을 잠그고 재검증했다. 아래 EXISTS 는 잠금 아래에서 같은 조건을 한 번 더 확인하는 안전장치다
-- :transferFromClick = 이 referrer 의 click_id 가 가리키는 클릭이 이 사용자(:u)에게 claimed_as_new_user = true 인지(같은 락 안에서 조회). 참이면 아래 두 번째 UPDATE 로 그 클릭의 참값을 지운다(「연결된 두 원장」)
-- :clickSignupAt = 그 클릭의 signup_at
-- :alreadyNewSignup = 같은 락 안에서 조회한, 이 사용자에게 claimed_as_new_user = true 인 link_clicks·install_referrers 행의 존재 여부 — 옮겨 올 그 클릭은 빼고 센다
-- :newUserGrace = NEW_USER_REPORT_GRACE(기본 10분). 설치·클릭 시각이 둘 다 없는 행에만 쓰인다
-- 개념 SQL(최종 테이블 이름). 구현은 엔티티 기반 JPQL 또는 단계별 물리 이름(expand 이미지는 group_invite_links·invite_link_clicks, §1.7·§2.7)
-- contract 전에는 status 가 전부 ACTIVE 라 l.status 조건은 참이고, 발급자 활성 멤버 EXISTS 는 contract 이미지부터 넣는다(expand 이미지의 SQL 에는 없다)
UPDATE public.install_referrers r
   SET claimed_user_id     = :u,
       claimed_at          = now(),
       claimed_as_new_user = (:transferFromClick
                              OR (NOT :alreadyNewSignup
                                  AND :userCreatedAt >= COALESCE(r.install_begin_at, r.referrer_click_at, r.received_at - :newUserGrace))),
       signup_at           = CASE WHEN :transferFromClick THEN :clickSignupAt
                                  WHEN NOT :alreadyNewSignup
                                   AND :userCreatedAt >= COALESCE(r.install_begin_at, r.referrer_click_at, r.received_at - :newUserGrace)
                                  THEN :userCreatedAt END
 WHERE r.id = :attributionId
   AND r.device_id = :deviceId
   AND r.install_id = :installId                                          -- 복원된 attributionId·deviceId 로 다른 설치가 선점하지 못하게
   AND r.claimed_at IS NULL                                               -- 탈퇴 익명화(§2.7) 뒤에도 소진 유지
   AND r.source IN ('LINK', 'META', 'GOOGLE')                             -- ORGANIC·UNKNOWN 은 귀속이 없는 기록이라 claim 대상이 아니다(§3.2)
   AND (r.link_id IS NULL OR EXISTS (
         SELECT 1 FROM public.links l
          WHERE l.id = r.link_id AND l.status = 'ACTIVE'
            AND (   (l.type = 'INVITE'
                     AND l.inviter_id <> :u                                            -- 셀프 초대 거절
                     AND EXISTS (SELECT 1 FROM public.groups g                         -- 현행 findActiveGroup 과 동치
                                  WHERE g.id = l.group_id AND g.deleted_at IS NULL AND g.status <> 'ENDED')
                     AND EXISTS (SELECT 1 FROM public.group_members m                  -- 발급자 활성 멤버(contract 이미지부터)
                                  WHERE m.group_id = l.group_id AND m.user_id = l.inviter_id AND m.is_left = false))
                 OR (l.type = 'CAMPAIGN'
                     AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.id = l.campaign_id AND c.status = 'ACTIVE')))));

-- 위 UPDATE 영향 행이 1 이고 :transferFromClick 이면 같은 트랜잭션에서 클릭 쪽 참값을 지운다
UPDATE public.link_clicks
   SET claimed_as_new_user = false, signup_at = NULL
 WHERE id = :referrerClickId AND claimed_user_id = :u AND claimed_as_new_user = true;
```

캠페인 링크 클릭은 많아서, 기기를 보지 않는 현행 규칙을 쓰면 다른 사람의 클릭에 붙는다. 캠페인 링크를 아는 앱은 새 파서를 가진 앱뿐이라 `deviceId` 필수가 구 앱을 깨지 않는다.

**신규 가입 여부를 claim 때 함께 기록한다.** 현 앱은 로그인 직후 `postAuthSave`(`auth.ts:170`, `isNewUser` 분기 뒤)에서 무조건 claim 을 부른다 — 광고로 설치하고 기존 계정으로 로그인한 사용자도 claim 한다. 그래서 붙이는 순간 `claimed_as_new_user = (users.created_at >= 기준 시각)` 을 채우고, 참이면 `signup_at = users.created_at` 도 저장한다. 기준 시각은 클릭이면 `clicked_at`, referrer 면 `COALESCE(install_begin_at, referrer_click_at)` 이다. **referrer 에 두 시각이 모두 없을 때만** `received_at - NEW_USER_REPORT_GRACE`(기본 10분)를 쓴다. referrer 는 로그인·게스트 시작 뒤에 저장되므로(§2.4-5) `received_at` 은 새 사용자의 `users.created_at` 보다 늦고, 그대로 비교하면 새 사용자가 전부 `false` 가 돼 가입이 영구 누락된다. 신규 사용자는 인증 직후 `postAuthSave` 에서 저장하므로 가입과 저장이 수 초 차이이고, 기존 계정 로그인·세션 복원은 가입이 며칠 이상 앞선다 — 유예가 둘을 가른다. 한계: 가입 뒤 저장이 유예보다 늦으면(오프라인 · 다음 실행 재시도) 신규를 놓친다(거짓 음성). 앱이 보낸 `isNewUser` 같은 값은 위조할 수 있어 쓰지 않는다. 기존 계정 로그인은 귀속 기록은 남기되 가입 수(§3.2)에서 빠진다. 가입 수의 기간은 `claimed_at` 이 아니라 `signup_at` 이다 — 현 앱은 claim 실패를 삼키고 다음 로그인에서 재시도하므로(`deferredInvite.ts` `claimStoredInviteAttribution`) 며칠 뒤 성공한 claim 도 가입 날에 들어가야 한다. 게스트로 시작해도 유저 행이 새로 생기므로 신규다.

**사용자당 신규 가입 1건.** 신규 판정은 클릭·referrer 행마다 하므로, 가입 직후 한 사용자가 서로 다른 `attributionId`·캠페인 slug 를 claim 하면 두 행 모두 `claimed_as_new_user = true` 가 될 수 있다. 그래서 claim 은 유저 행 배타 락 아래에서 이 사용자에게 `claimed_as_new_user = true` 인 `link_clicks`·`install_referrers` 행이 이미 있는지 먼저 보고, 있으면 이번 claim 은 **`claimed_as_new_user = false`, `signup_at = NULL`** 로 기록한다(귀속 기록은 남긴다). 배타 락이 확인과 UPDATE 를 직렬화하므로 동시 claim 으로도 두 번 기록되지 않고, 탈퇴 익명화(§2.7)는 이 플래그를 지우지 않으므로 탈퇴 뒤에도 중복이 생기지 않는다.

**연결된 두 원장의 신규 가입은 referrer 로 옮긴다.** 첫 실행에 referrer 읽기가 실패해 fingerprint 매치·slug claim 이 먼저 끝나면 그 클릭이 `claimed_as_new_user = true` 가 된다. 다음 실행에 같은 설치의 LINK referrer 가 저장되면 §2.4-3 규칙으로 `click_id` 가 그 클릭을 가리키고, 뒤이어 `attributionId` claim 이 온다. 여기에 「사용자당 1건」만 적용하면 referrer 는 `false` 가 되어 가입 참값이 클릭 원장에 남고, 같은 설치의 설치 수는 referrer·가입 수는 클릭으로 원장이 갈린다(anti-join 이 신규 가입 referrer 만 보도록 좁히기 전에는 가입이 0건이 됐다). 그래서 `attributionId` claim 에서 referrer 의 `click_id` 가 가리키는 클릭이 **같은 사용자(`claimed_user_id = :u`)에게 `claimed_as_new_user = true`** 이면, 같은 트랜잭션에서 그 참값을 **referrer 원장으로 이전**한다 — referrer 행 `claimed_as_new_user = true`·`signup_at` = 클릭의 `signup_at`, 클릭 행 `claimed_as_new_user = false`·`signup_at = NULL`(위 두 번째 UPDATE). 「사용자당 1건」 확인에서는 옮겨 올 그 클릭을 빼고 센다. 그 밖엔 「사용자당 1건」 규칙 그대로다. 그래서 **같은 설치의 가입 참값은 항상 referrer 쪽에 있고**, anti-join 이 빼는 클릭 쪽에는 참값이 남지 않는다. 클릭을 다른 사용자가 claim 했거나 탈퇴로 `claimed_user_id` 가 지워졌으면 옮기지 않는다 — 한계: 같은 설치에서 서로 다른 두 계정이 **각각 신규 가입**하면 referrer 가 `true` 라 anti-join 이 클릭 쪽 가입을 빼 가입 1건으로 센다(설치 단위 중복 제거). 반대로 계정 u 가 클릭 claim 으로 신규 가입하고 같은 설치에서 **기존 계정** v 가 referrer claim(`false`)을 하면, anti-join 은 신규 가입 referrer 가 가리키는 클릭만 빼므로(§3.2) u 의 가입 1건이 그대로 남는다.

### 2.6 SKAN 귀속 (읽기 시점)

1. **채널**: `ad_network_id` 를 코드 상수 레지스트리(`SkanAdNetworks`)로 META · GOOGLE 에 대응시킨다. 없는 값은 `UNKNOWN`.
2. **캠페인**: 그 채널에서 `campaigns.skan_source_identifier` 가 포스트백 `source_identifier` 와 같으면 그 캠페인이다. 크라우드 익명성이 낮으면 Apple 은 source-identifier 의 **끝자리(least significant digits)** 2~3자리만 보낸다 — 예를 들어 `5239` 는 `39` 또는 `239` 로 온다. 그래서 포스트백 자릿수가 더 적으면 **등록 값의 끝자리가 일치하는 캠페인이 정확히 하나일 때만** 귀속하고, 둘 이상이면 채널 단위로 남긴다.
3. 저장된 행은 모두 서명 검증을 통과한 우리 앱의 포스트백이다(§4.2).

### 2.7 탈퇴

`UserService.erasePersonalData` 를 부르기 **전에**(그 메서드 안의 `socialAccountRepository.deleteByUserId` 가 영속성 컨텍스트를 비우므로 탈퇴 절차의 마지막이다) 같은 트랜잭션에서 세 벌크 UPDATE 를 실행한다. 이 트랜잭션은 시작부터 유저 행 배타 락을 쥐고 있어 §2.5 의 claim·§2.4-5 의 referrer 저장(둘 다 같은 유저 행 배타 락)과 직렬화된다.

```sql
-- 개념 SQL(최종 테이블 이름). 구현은 아래 JPQL 벌크 업데이트다
UPDATE public.link_clicks       SET claimed_user_id = NULL WHERE claimed_user_id = :userId;
UPDATE public.install_referrers SET claimed_user_id = NULL WHERE claimed_user_id = :userId;
UPDATE public.install_referrers SET reporter_user_id = NULL WHERE reporter_user_id = :userId;
```

**구현은 엔티티 기반 JPQL 벌크 업데이트다** — `@Modifying(flushAutomatically = true) @Query("update LinkClick c set c.claimedUserId = null where c.claimedUserId = :userId")`, `update InstallReferrer r set r.claimedUserId = null where r.claimedUserId = :userId`, `update InstallReferrer r set r.reporterUserId = null where r.reporterUserId = :userId`. JPQL 은 엔티티 이름을 쓰므로, expand 기간의 `@Table(name = "invite_link_clicks")` 와 contract 이미지의 최종 이름(§1.7)을 엔티티 매핑이 따라간다. 네이티브 SQL 에 물리 이름을 적으면 contract 이미지에서 `relation "public.invite_link_clicks" does not exist` 로 실패해 뒤의 `install_referrers` 익명화와 계정 탈퇴까지 롤백된다. 세 UPDATE 는 `erasePersonalData` **앞에서** 실행한다. JPQL 벌크 UPDATE 자체는 즉시 SQL 로 실행돼 영속성 컨텍스트와 무관하다. 다만 `erasePersonalData` 는 `@Transactional` 서비스 메서드이고, 그 안에서 부르는 `socialAccountRepository.deleteByUserId`(`@Modifying(clearAutomatically = true)`)가 컨텍스트를 비워 그 뒤에 엔티티로 고친 변경이 사라지므로, 탈퇴 절차의 다른 정리와 같은 규칙(그 메서드가 마지막)을 따른다.

`claimed_at`·`claimed_as_new_user`·`signup_at` 은 지우지 않는다 — 가입 집계를 보존하고, 미claim 판정(`claimed_at IS NULL`, §2.5)이 그 행을 계속 소진으로 봐 다른 계정의 재선점을 막는다.

INVITE 링크 폐기(`ACCOUNT_WITHDRAWN`)는 contract 이미지부터 그룹 획득 문서의 멤버십 전이와 같은 트랜잭션에서 한다.

## 3. 내부 API (data-api `/internal/*`)

호출 규약은 #745 의 business → data 내부 호출을 따른다: `Authorization: Bearer ${SVC_TOKEN_BIZ_TO_DATA}`, `X-Request-Id`, 사용자 위임 호출은 `X-User-Id`, 콘솔 호출은 `X-Actor: console:<slot>`. 경로는 수신 측 허용목록(`internal.api.callers.business.allow`)에 하나씩 추가한다. 와일드카드로 묶지 않는다.

| 메서드·경로 | 호출자 | 요청 | 응답 |
| --- | --- | --- | --- |
| `POST /internal/links/{slug}/visits` | 랜딩 | `{clientIp, os, userAgent, refererHost, recordClick}` — `recordClick` 기본 `true`, 랜딩 IP 한도를 넘은 방문은 `false`(§2.2·§4.3) | 200 `LandingView`(기록을 생략하면 `clickId=null`) · 404 |
| `GET /internal/links/{slug}` | `/l/resolve` | — | 200 `LinkView` · 404 |
| `POST /internal/links/match` | `/l/match` | `{os, deviceId, installId?, appInstanceId, clientIp}` | 200 `MatchResult` |
| `POST /internal/install-referrers` | `/l/referrer` · `X-User-Id` | 아래 | 200 `ReferrerResult`(저장 도중 탈퇴면 `attributionId` 없이 미저장) · 429 `REFERRER_DAILY_LIMIT`(미저장) · 400 `INVALID_PARAMETER`(`installId` 없음, 미저장) |
| `POST /internal/links/claims` | claim · `X-User-Id` | `{slug}` 또는 `{slug, deviceId}` 또는 `{attributionId, deviceId, installId}` | 200 · 404 `SLUG_NOT_FOUND`(없는 slug) |
| `POST /internal/groups/{groupId}/invite-links` | 초대 발급 · `X-User-Id` | 없음 | 200 `{slug, url}` (현행 `IssueInviteLinkResponse`) |
| `POST /internal/skan-postbacks` | SKAN 수신 | 아래 | 201 신규 · 200 중복 |
| `GET /internal/campaigns?status=` | 콘솔 | — | 200 `[CampaignSummary]` |
| `POST /internal/campaigns` | 콘솔 | `{name, channel, platform, externalId?, skanSourceIdentifier?}` | 201 · 409 `CAMPAIGN_EXTERNAL_ID_TAKEN` · 409 `CAMPAIGN_SKAN_ID_TAKEN` · 422 형식 · 422 `EXTERNAL_ID_PLATFORM`(`externalId` 는 META 이면서 ANDROID·ALL 만) |
| `PATCH /internal/campaigns/{id}` | 콘솔 | `{name?, status?, externalId?, skanSourceIdentifier?}` — 캠페인 행 배타 락(§2.5 campaign 단계) | 200 · 409·422 위와 같음 · 409 `CAMPAIGN_IDENTIFIER_IMMUTABLE`(설정된 `externalId`·`skanSourceIdentifier` 를 바꾸거나 지움 — NULL 에서 한 번만 설정, §1.2) |
| `POST /internal/campaigns/{id}/links` | 콘솔 | `{destination}` — `campaigns` 행 배타 락 아래 ACTIVE 확인 → link INSERT(§2.5) | 201 `{slug, url, playStoreUrl, destination}`(`playStoreUrl` 은 `slug` 만 심은 콘솔용이고 캠페인 `platform` 이 `IOS` 면 `null`, §4.4) · 409 `CAMPAIGN_ARCHIVED` · 422 `DESTINATION_NOT_ALLOWED` |
| `POST /internal/links/{slug}/revocations` | 콘솔 | `{}` — campaign → link 순 잠금(§2.5) | 204 · 422 `NOT_A_CAMPAIGN_LINK` |
| `GET /internal/campaigns/stats?from&to` | 콘솔 | — | 200 `CampaignStatsList` |
| `GET /internal/campaigns/{id}/stats?from&to` | 콘솔 | — | 200 `CampaignStats` |

### 3.1 응답 모양

```jsonc
// LandingView — INVITE, 활성
{"type": "INVITE", "slug": "k3m9x2pa", "state": "ACTIVE", "clickId": "0190d3c4-2a7e-7c11-8b3d-5e6f7a8b9c0d", "groupId": "0190d3a2-6c1e-7b44-9a51-3f0c2d7e8a10", "groupName": "새벽 공부방", "inviterName": "재영", "destination": null}
// LandingView — CAMPAIGN, 폐기
{"type": "CAMPAIGN", "slug": "q7w2e4rt", "state": "EXPIRED", "clickId": null, "campaignPlatform": "ALL", "groupName": null, "inviterName": null, "destination": null}
// LandingView — CAMPAIGN, 활성이지만 기록 생략(recordClick=false · 봇 UA · META·GOOGLE 캠페인의 iOS 방문). clickId 만 null 이고 나머지는 정상 뷰와 같다
{"type": "CAMPAIGN", "slug": "q7w2e4rt", "state": "ACTIVE", "clickId": null, "campaignPlatform": "ALL", "groupName": null, "inviterName": null, "destination": "gromo://"}

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
  "deviceId": "a1b2c3", "installId": "5b1e0c2a-9d4f-4a7e-8c31-2f6b7d9e0a14", "appInstanceId": "f00d", "referrerRaw": "utm_source=...&utm_content=%7B...%7D",
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

`installBeginServer` 는 `installBeginAt` 이 Play 서버 시각이면 `true` 다. `install_key` 는 data-api 가 `deviceId` 와 `installBeginAt`(없으면 `iid:` + `installId`)으로 만든다(§2.4-1).

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
| `installs.fingerprint` | `link_clicks.matched_at` 이 기간 안 이고 그 클릭을 가리키는 `install_referrers.click_id` 가 없음. 클릭 `os` 가 캠페인 `platform` 과 맞을 때만(`ALL` 은 둘 다) | 확률 |
| `installs.referrer` | source 가 LINK·META 인 행 중(ORGANIC·UNKNOWN 은 넣지 않는다, 아래) `COALESCE(install_referrers.install_begin_at, received_at)` 이 기간 안이고 `REFERRER_COUNT_SINCE` 이후(소급 유입 제외, 아래), LINK 는 링크의 캠페인(캠페인 `platform` 이 `IOS` 가 아닐 때만), META 는 `external_id` 대조. 재설치는 새 설치로 센다(§1.5) | 결정 |
| `installs.skan` | `skan_postbacks.received_at` 이 기간 안, §2.6 으로 이 캠페인에 귀속, `postback_sequence_index` 가 0 또는 NULL | 집계·지연 |
| `signups.claim` | `claimed_as_new_user = true` 인 `link_clicks` + `install_referrers`(source LINK·META·GOOGLE — ORGANIC·UNKNOWN 은 claim 대상이 아니라 참이 생기지 않는다) 중 `signup_at`(가입 시각)이 기간 안. 기존 계정 로그인 claim(`false`)은 뺀다. **`link_clicks` 쪽은 `claimed_as_new_user = true` 인 `install_referrers` 행의 `click_id` 가 가리키는 클릭을 뺀다**(같은 설치의 가입이 referrer 원장에 이미 있을 때만 — 같은 사용자면 claim 때 참값을 referrer 로 옮겼으므로(§2.5) 빼는 클릭에는 참값이 없다. referrer 가 기존 계정 claim(`false`)이면 클릭 쪽 신규 가입을 그대로 센다). 사용자당 `true` 는 한 행뿐이라(§2.5) 한 사용자가 여러 링크·referrer 를 claim 해도 가입 1건 | 확률 또는 결정 |
| `signups.skan` | `installs.skan` 과 같은 행 중 `conversion_value >= 1` 또는 `coarse_conversion_value IN ('medium','high')` | 집계·지연 |

- `installs.referrer` 를 첫 실행 시각(`received_at`)으로 자르면 설치 며칠 뒤에 처음 연 사용자가 다른 날·다른 캠페인 기간에 들어간다. Play 가 준 설치 시작 시각을 먼저 쓴다.
- referrer 로 귀속된 설치를 fingerprint 에서 빼기 위해 `install_referrers.click_id` 로 조인해 그 클릭을 뺀다(추가 컬럼 없음, 부분 인덱스 `idx_install_referrers_click`). §2.4-3 규칙으로 같은 기기의 LINK 설치는 fingerprint 매치가 이번 설치의 매치 창 안에서 먼저 났든 뒤에 오든 `click_id` 가 그 클릭을 가리키므로 두 칸에 한 번씩 잡히지 않는다. 다른 기기에 매치된 클릭은 별개 설치다.
- `signups.claim` 은 신규 유저만 센다. 기간은 claim 이 늦게 성공해도 가입 날로 잡히도록 `signup_at` 으로 자른다. 광고로 설치하고 기존 계정으로 로그인한 사용자는 설치에는 들어가고 가입에는 들어가지 않는다. 설치 수와 같은 규칙으로 중복을 뺀다 — 첫 실행에 referrer 읽기가 실패해 fingerprint 매치·slug claim 이 먼저 끝나고 다음 실행에 같은 LINK referrer 가 저장·claim 되면, 그 클릭을 가리키는 referrer 가 신규 가입(`claimed_as_new_user = true`)이면 클릭 쪽 가입은 빼고 referrer 쪽 1건만 센다(anti-join, `idx_install_referrers_click`). referrer 가 기존 계정 claim 이면 빼지 않는다. 이때 가입 참값은 claim 이 클릭에서 referrer 로 옮겨 두었으므로(§2.5 「연결된 두 원장」) anti-join 이 참값을 버리지 않는다. 채널 합계도 같다.
- referrer 는 세션 확보 뒤 저장되므로(§2.4-5) 첫 실행 뒤 로그인·게스트 시작 없이 떠난 설치는 `installs.referrer` 에 들어가지 않는다. 대신 토큰 없는 위조 저장이 막힌다.
- `signups.skan` 은 첫 측정 창(0~2일)의 포스트백만 센다. 그 뒤 가입은 누락된다 — 콘솔에 표기한다.
- **캠페인 플랫폼과 다른 OS 의 설치는 그 캠페인에 넣지 않는다**(정책 L24). `IOS` 캠페인 링크로 들어온 Android referrer·Android fingerprint 설치, `ANDROID` 캠페인 링크로 들어온 iOS fingerprint 설치는 캠페인 `totals`·`links` 에서 빼고 `CampaignStatsList.channels.<캠페인 channel>` 로 보낸다. 그 설치 행의 가입(`signups.claim`)도 같은 곳으로 간다. 발급 단계에서 `IOS` 캠페인에 Play URL 을 주지 않고 랜딩 버튼을 숨기지만(§4.4), 랜딩 공유·손으로 만든 URL 은 막지 못하므로 읽기 시점에 한 번 더 거른다.
- `notes`: `SKAN_DELAYED`(iOS 광고 캠페인) · `GOOGLE_CHANNEL_ONLY`(GOOGLE·ANDROID) · `SKAN_CHANNEL_ONLY`(iOS 광고인데 `skan_source_identifier` 없음) · `OS_MISMATCH_TO_CHANNEL`(캠페인 플랫폼과 다른 OS 의 설치·가입이 있어 채널 합계로 뺌).
- `CampaignStatsList` 는 캠페인별 `totals` 와, 캠페인에 귀속되지 않은 채널 단위 합(`channels.ORGANIC`·`channels.META`·`channels.GOOGLE` 의 `installs.fingerprint`·`installs.referrer`·`installs.skan`·`signups.claim`·`signups.skan`)을 준다. 캠페인 플랫폼과 다른 OS 로 들어온 설치·가입도 그 캠페인의 채널로 여기 들어간다. GOOGLE referrer 와 캠페인에 매핑되지 않은 META referrer 의 신규 claim 은 개별 캠페인에 들어갈 수 없으므로 여기서 보인다.
- **ORGANIC·UNKNOWN referrer 는 설치·가입 어디에도 넣지 않는다**(캠페인 `totals`·`links` 와 `channels.*` 모두). Play 기본값(ORGANIC)·판별 불가(UNKNOWN)는 귀속이 없는 기록이고, 그 설치는 fingerprint 원장(`link_clicks`)이 매치·claim 으로 센다. 넣으면 같은 설치가 fingerprint 설치와 ORGANIC referrer 설치로 두 번 잡히고(LINK 가 아니라 `click_id` 가 늘 NULL 이라 anti-join 이 못 뺀다), 신규 사용자의 `attributionId` claim 이 `claimed_as_new_user = true` 를 먼저 차지해 뒤이은 캠페인 slug claim 이 `false` 가 되면서 가입이 캠페인 대신 채널 합계·미귀속으로 간다. 그래서 `attributionId` claim 도 이 행을 받지 않는다(§2.5). 행은 원문 보존·진단용으로 남기고 별도 수치로 내지 않는다.
- **소급 유입**: 앱 업데이트 뒤 기존 설치도 세션 복원 시점에 referrer 를 한 번 보낼 수 있다(Play 가 과거 설치의 referrer 를 계속 돌려주면). 그러면 `install_begin_at` 이 과거인 행이 생겨 이미 본 기간의 수치가 바뀐다. 그래서 `installs.referrer` 와 그 행의 가입은 `COALESCE(install_begin_at, received_at) >= REFERRER_COUNT_SINCE`(referrer 를 보내는 앱 버전의 배포 시각, 설정값)인 행만 센다. 새 컬럼은 없다.
- **폐기 링크의 소진 클릭**: §2.3 은 창 안 최신 후보를 고정·소진한 뒤 활성 검증에 실패하면 `matched:false` 로 끝낸다(정책 L14). 이 클릭도 `matched=true` 라 `installs.fingerprint` 에 설치로 셀 수 있다. 구분 컬럼을 두지 않고 한계로 둔다.
- 이 절의 테이블 이름은 최종 이름이다. 구현은 엔티티 기반 JPQL 또는 단계별 물리 이름을 쓴다(§1.7·§2.7 과 같은 규칙).

## 4. 공개 표면 (business-api)

| 메서드·경로 | 인증 | 요청 | 응답 |
| --- | --- | --- | --- |
| `GET /l/{slug}` | 없음 | UA · IP | 200 HTML (활성 · 만료 · 강등 세 모양). IP 한도를 넘으면 `visits` 를 `recordClick=false` 로 불러 같은 랜딩을 렌더하고 클릭은 남기지 않는다(§4.3) |
| `GET /link/**` | 없음 | — | 정적 이미지(현 data-api `static/link/` 이사) |
| `POST /l/match` | 없음 | `{os, deviceId, installId?, appInstanceId?}` | 200 `MatchResult`(매치 없음은 `{matched:false}`) · 429 레이트리밋 · 503 일시 장애 |
| `POST /l/referrer` | **access token**(게스트 포함) | `{os:"android", deviceId, installId, appInstanceId?, referrer, referrerClickTimestampSeconds?, installBeginTimestampSeconds?, referrerClickTimestampServerSeconds?, installBeginTimestampServerSeconds?, installVersion?}` | 200 `ReferrerResult` · 400 `installId` 없음(미저장) · 401 토큰 없음 · 429 IP·유저 상한 · 503 |
| `POST /l/resolve` | 없음 | `{slug}` | 200 `LinkView` · 404 없는 slug · 429 · 503. 클릭을 기록하지 않는다 |
| `GET /.well-known/apple-app-site-association` | 없음 | — | 현행 JSON 그대로(`appIDs` · `/l/*`) |
| `GET /.well-known/assetlinks.json` | 없음 | — | 신규. 패키지·서명 SHA-256 은 env |
| `POST /.well-known/skadnetwork/report-attribution/` (끝 슬래시 없는 경로도) | 없음(서명) | Apple JSON | 200 · 400 JSON 아님 · 413 16KB 초과 · 503 동시 서명 검증 상한(§4.2) · 500 저장 실패. 공개 경로 레이트리밋(429)을 걸지 않는다(§4.3) |
| `POST /api/v1/groups/{groupId}/invite-link` | JWT | — | 200 `{slug, url}` (현행) |
| `POST /api/v1/invite-links/claim` | JWT | `{slug}` · `{slug, deviceId}` · `{attributionId, deviceId, installId}` | 200 · 404 `SLUG_NOT_FOUND` (현행) · 400 `attributionId` 에 `deviceId`·`installId` 누락 |
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
- 시각은 `…ServerSeconds` 를 우선하고 없으면 기기 시각을 쓴다. 설치 시작 시각은 `install_key` 에도 쓰이고, 없으면 `installId` 가 대신한다(§2.4-1).
- 복호화 키는 business-api 에만 둔다.

### 4.2 SKAN 수신

- 앱 Info.plist 의 `NSAdvertisingAttributionReportEndpoint` 에 적은 도메인(`https://link.oneorthree.world`)으로 Apple 이 포스트백 복사본을 보낸다.
- 이 경로는 공개·무인증이고 우리 앱 ID 도 공개돼 있다. 그래서 **서명 검증을 통과한 것만 DB 에 닿게** 한다.
- 처리 순서: 본문 16KB 초과면 413 → 인스턴스당 동시 서명 검증 상한 초과면 503 + `Retry-After` → JSON 파싱(실패 400) → `app-id` 가 우리 앱(`6774498679`)이 아니면 **저장 없이** 200 → `attribution-signature` 를 **버전별 Apple 공개키**로 검증, 실패하거나 모르는 버전이면 **저장 없이** 200 → data-api 저장(실패 500) → 200.
- 저장하지 않은 요청은 메트릭 카운터 `skan_postback_rejected{reason=app_id|signature|unknown_version|too_large|overloaded}` 로 세고, 로그에는 `transaction-id` 만 샘플로 남긴다(원문 미기록).
- 서명 대상 필드의 순서·구분자는 버전마다 다르다. Apple 문서의 버전별 규칙을 코드 상수로 둔다.
- JSON 키 → 컬럼: `version` · `ad-network-id` · `source-identifier`(4.0) 또는 `campaign-id`(3.0 이하) · `app-id` · `transaction-id` · `redownload` · `source-app-id` · `source-domain` · `fidelity-type` · `did-win` · `conversion-value` · `coarse-conversion-value` · `postback-sequence-index`. 원문 전체는 `raw` 에 둔다.
- **IP 단위 제한을 두지 않는다.** 포스트백은 개별 기기가 아니라 Apple 이 여러 설치 분을 서버 간으로 보내므로 발신 IP 는 사용자별 식별자가 아니다 — IP 한도는 캠페인 규모가 커질 때 유효한 포스트백을 서명 검증 전에 잘라 설치·가입을 체계적으로 과소 집계한다. 저장 보호는 「서명 통과분만 저장」이 맡고, 남는 위험(서명 검증 CPU)은 본문 16KB 제한과 **business-api 인스턴스당 동시 서명 검증 32건** 상한으로 막는다. 넘으면 503 + `Retry-After: 30` 이지만 과부하 보호용이다 — 포스트백은 측정 창 종료 뒤 무작위 지연으로 흩어져 도착하므로 정상 규모에서는 닿지 않게 넉넉히 잡는다. Apple 재전송에 기대지 않는다는 원칙은 그대로라 503 은 카운터 `reason=overloaded` 와 경보로 추적한다.
- Cloudflare: 봇 챌린지·WAF 가 이 경로의 POST 를 막지 않게 **예외만** 둔다(Infra). 엣지 레이트리밋은 두지 않는다(위와 같은 이유).

### 4.3 클라이언트 IP · 레이트리밋

- data-api `ClientIpResolver` 의 규칙을 그대로 옮긴다: 원격 피어가 사설망(nginx)일 때만 `X-Real-IP` 를 믿는다. nginx 는 Cloudflare 대역 피어일 때만 `CF-Connecting-IP` 로 `$remote_addr` 을 복원한다(현행 Infra 설정).
- #745 의 business-api 설정 `link.trusted-ip-headers` 기본값 `X-Link-Client-IP` 는 Vercel 프록시 전제였다. **`X-Real-IP` 로 바꾼다.**
- **레이트리밋 키에 원본 IP 를 넣지 않는다.** business-api 전용 비밀 `RATE_LIMIT_IP_KEY` 로 `HMAC-SHA256(ip)` 한 값만 쓴다(정책 L17).
- 한도(business-api Redis, 키 `linkrl:<route>:<ipHmac>`): `/l/match`·`/l/referrer`·`/l/resolve` 는 분당 30회. 초과는 429 다. **SKAN 수신 경로(`/.well-known/skadnetwork/report-attribution` 두 경로)는 이 공개 경로 레이트리밋에서 제외한다** — §4.2 의 동시 서명 검증 상한(초과 503)만 둔다. 공통 공개 경로 limiter 를 경로 구분 없이 걸면 여러 설치 분을 한 송신 지점에서 보내는 Apple 포스트백이 429 로 잘린다.
- **`GET /l/{slug}` 는 분당 60회, 키는 `linkrl:landing:<ipHmac>` 로 slug 를 넣지 않는다** — slug 마다 따로 세면 알려진 slug 를 바꿔 가며 한도를 늘릴 수 있다. 초과하면 429 가 아니라 `visits` 를 **`recordClick=false`** 로 불러 클릭 없이 같은 `LandingView`(`clickId=null`)를 받아 정상 랜딩을 렌더한다(사람에게는 페이지가 떠야 한다). business-api 는 DB 를 읽지 않으므로 호출을 건너뛰면 그룹명·목적지·`campaignPlatform`·활성 상태를 몰라 강등 화면밖에 그리지 못한다. Android 스토어 버튼의 referrer 에는 `slug` 만 심는다(§4.4). data-api 의 링크·IP 해시·OS 당 20건 상한(§2.2)과 겹친다.
- 키 패턴 `linkrl:*` 은 [아키텍처 A19](../../architecture/decisions.md) 네임스페이스 표와 Business API ACL 에 등록돼 있다(표에 없는 키 금지). business-api 는 지금 전용 Redis(`business-redis`, `BUSINESS_REDIS_USERNAME` 으로 ACL 유저 지정)를 쓰지만 같은 규칙을 지금부터 적용한다.
- Cloudflare 엣지에서도 `/l/*` GET 에 IP 레이트리밋 규칙을 둔다(Infra). SKAN 경로는 제외한다(§4.2). `/l/referrer` 는 여기에 더해 유저당 KST 당일 3건 저장 상한(§2.4-5)이 있다.

### 4.4 랜딩

- `LandingRenderer` 와 `invitelink/landing.html` 을 business-api 로 옮긴다. 단일 패스 치환 규칙은 유지한다.
- INVITE 랜딩의 `schemeUrl` 은 business-api 가 `LandingView` 의 `groupId`·`slug` 로 현행 형식 `gromo://join?g=<groupId>&s=<slug>` 을 만든다(`InviteLinkUrls.scheme` 이사). 구 앱의 초대 시트는 이 형식만 연다.
- 캠페인 링크는 별도 템플릿(`link/campaign-landing.html`)을 쓴다. 자리표시자: `pageTitle` · `schemeUrl`(= 목적지) · `iosStoreUrl` · `androidStoreUrl` · `storeState` · `ogImageUrl` · `expired`.
- **Android 스토어 버튼은 신규다**(현 템플릿엔 App Store 버튼만 있다). 두 템플릿 모두 `androidStoreUrl` 을 받아, 설정값 `LINK_ANDROID_PACKAGE` 가 비어 있으면 버튼을 숨긴다. 값이 있으면 Play URL 은 쓰임에 따라 둘이다.
  - **랜딩의 스토어 버튼**(방문 뒤): `https://play.google.com/store/apps/details?id=<패키지>&referrer=<URL 인코딩된 "slug=<slug>&click=<LandingView.clickId>">`. `clickId` 가 없으면(봇 UA · `recordClick=false` · 유료 채널 캠페인의 iOS 방문) `slug` 만 심는다.
  - **콘솔 발급 응답의 `playStoreUrl`**(광고·게시물에 직접 넣는 용, 방문 전): `referrer=<URL 인코딩된 "slug=<slug>">`. 방문이 없어 `click` 이 없고, 이 URL 로 설치해도 §4.1 1행으로 LINK 에 귀속된다. 캠페인 `platform` 이 `IOS` 면 `null` 이다.
  - `referrer` 를 통째로 빼는 건 **만료·강등 랜딩**뿐이다.
  - **캠페인 링크 랜딩은 `LandingView.campaignPlatform` 이 `IOS` 면 Android 스토어 버튼을, `ANDROID` 면 App Store 버튼을 숨긴다**(`ALL` 은 둘 다 보인다, 정책 L24). 숨기지 않으면 다른 플랫폼 설치가 결정적 귀속으로 캠페인에 들어온다. 버튼만 숨기고 안내 문구는 두지 않는다 — 광고·게시물 대상이 아닌 방문자다. INVITE 랜딩은 두 버튼 모두 보인다.
- 강등 랜딩(data-api 무응답): 그룹·캠페인 문구 없이 스토어 버튼만, 클릭 미기록.
- 목적지 허용 목록(정책 L13)은 business-api 와 data-api 가 공유하는 상수가 아니라 **data-api 가 발급 때 검증**하고, 초기값은 `gromo://`(앱 열기) 하나다.

### 4.5 인증 필터 예외

- **현행**: #745 머지 전 main 의 business-api `RequestFilter`(`RequestFilter.java:26-43`)는 actuator 경로만 무인증이고 나머지는 전부 `Authorization` 을 검증해 없으면 401 이다. #745(머지 `1ec66e0dd`)의 `AccessTokenFilter` 는 `/*` 에 등록돼 `getRequestURI()`(디코딩 전 원문)의 **정확 일치** 목록 — `/health` · `/l/match` · actuator 6개 — 만 통과시키고, `RequestEnvelopeFilter` 에는 경로 예외가 없다. 구현은 #745 머지 뒤 `AccessTokenFilter` 의 예외를 넓힌다.
- **원칙은 그대로**: 전부 막고 (메서드, 원문 경로)로 열거한 것만 연다. 접두어나 디코딩된 경로로 고르면 `/%6C/…`·`/l;x/…` 같은 변형이 컨트롤러에는 닿고 검사는 비껴가는 우회로가 된다. 원문 정규식에 안 맞는 변형은 401 로 떨어진다(fail-closed).

| 메서드 | 원문 경로 | 용도 |
| --- | --- | --- |
| GET | `^/l/[23456789abcdefghjkmnpqrstuvwxyz]{8,12}$` 이고 예약어가 아님 | 랜딩 |
| POST | `/l/match` | fingerprint 매치(#745 현행) |
| POST | `/l/resolve` | 설치된 앱의 직접 열기 |
| GET | `/.well-known/apple-app-site-association` · `/.well-known/assetlinks.json` | 앱 링크 검증 |
| POST | `/.well-known/skadnetwork/report-attribution` · `/.well-known/skadnetwork/report-attribution/` | SKAN 수신(서명으로 검증, §4.2) |
| GET | `^/link/[a-z0-9-]+\.(png|jpg)$` | 랜딩 정적 이미지 |
| 전부 | `^/console(/.*)?$` | 토큰 필터는 건너뛰고 `ConsoleSessionFilter` 가 맡는다(§6.2). 세션 없이 통과하는 건 `GET·POST /console/login` 뿐 |
| GET | `/health` · actuator 6개 | #745 현행 |

- `POST /l/referrer`·`/api/**` 와 그 밖의 모든 경로는 access token 필수다.
- **`/l/**` 로 묶지 않는다.** `/l/referrer` 가 같은 접두어를 쓰는 인증 경로다. 랜딩 규칙을 GET 으로 한정하는 이유도 같다 — slug 알파벳(`SlugGenerator.ALPHABET` = `23456789abcdefghjkmnpqrstuvwxyz`, 8자)은 `referrer` 를 만들 수 있다. 그래서 **slug 생성기는 `/l/` 아래 경로 이름(`referrer` · `resolve` · `match` 와 앞으로 추가되는 이름)을 예약어로 발급하지 않고**, 랜딩 규칙도 예약어를 제외한다. `GET /l/referrer` 는 매핑이 없어 405 다.
- `ConsoleSessionFilter` 는 토큰 필터와 **같은 원문 정규식**으로 적용 여부를 정한다. 두 필터가 경로를 다르게 해석하면 한쪽은 건너뛰고 다른 쪽은 걸리지 않는 틈이 생긴다.

## 5. 앱 계약 (앱 티켓)

| # | 변경 | 호환 |
| --- | --- | --- |
| 1 | 파서: `g=` 없는 `/l/{slug}` 도 유효. **앱이 설치된 상태에서 Universal Link·App Link 로 직접 열리면** `POST /l/resolve {slug}` 로 `type` 을 받아 CAMPAIGN 은 `destination` 으로, INVITE 는 `groupId` 로 초대 시트를 연다. 매치 응답도 같은 `type` 분기. 모르는 목적지는 앱 홈 | 서버는 구 필드 유지 |
| 2 | Android **첫 실행**: `InstallReferrerClient` 로 referrer 를 읽어 **로컬에서** 출처를 가린다 — `slug` 가 있으면 **그 `installId` 에서 referrer 를 처음 성공적으로 읽었을 때 한 번만** `POST /l/resolve {slug}` 로 초대 시트·목적지를 열고 `/l/match` 생략, 출처 판별은 **§4.1 표와 같은 규칙·같은 순서**로 한다(META 는 `utm_content` JSON 에 `source.data`·`source.nonce` 가 **둘 다** 있을 때만) — META·GOOGLE(`gclid`)이면 `/l/match` 생략, 그 밖(ORGANIC·UNKNOWN)이면 기존 매치(요청에 `installId` 를 싣는다, 6행). **fingerprint 매치의 완료 값 `deferredInviteChecked` 는 존재 플래그가 아니라 처리한 `installId` 로 저장**하고, 저장값이 현재 `installId` 와 다르면 새 설치로 보고 매치를 다시 시도한다(현 `deferredInvite.ts:84` 는 값이 있기만 하면 건너뛴다). **앱의 완료 값은 `installId` 만으로 비교한다** — Play 설치 시작 초는 첫 실행에 referrer 읽기가 일시 실패하면 없다가 다음 실행에 생겨 같은 설치인데 값이 바뀌므로 서버 `install_key` 에만 쓴다. `installId` 는 백업 제외 저장소라 재설치마다 새로 생기므로, 설치 시각이 없을 때의 폴백을 따로 둘 필요가 없다. **업데이트 전 구 앱이 남긴 값(`'1'` 처럼 `installId` 형식이 아닌 값)은 OS 설치 메타데이터로 업데이트와 재설치를 가른다** — `PackageManager` 의 `PackageInfo.firstInstallTime` 과 `lastUpdateTime` 을 비교해, **`firstInstallTime < lastUpdateTime`(기존 설치 위 업데이트)이면 「현재 설치를 이미 처리함」으로 보고 매치 없이 현재 `installId` 로 옮겨 적고**, **`firstInstallTime == lastUpdateTime`(이번 버전을 새로 설치 — 구 앱을 지운 뒤 Auto Backup 이 `'1'` 을 복원한 재설치)이면 새 설치로 보고 매치·referrer 를 시도한다.** 두 값은 OS 가 주는 설치 메타데이터라 Auto Backup 대상이 아니고 기기 식별자도 아니다. 현 앱은 이 값을 읽지 않으므로(`app/app-dev/src`·`android/app/src` 에 사용처 없음) `installId` 와 같은 네이티브 모듈에서 읽는다. 구분 없이 옮겨 적으면 백업 복원 재설치의 fallback 귀속이 영구 누락되고, 구분 없이 비교하면 업데이트 직후 기존 Android 사용자 전원이 새 `installId` 로 재매치해(과거 매치는 `matched_install_id` 가 NULL 이라 재반환되지 않는다) 같은 공인 IP 의 남의 미소진 클릭을 빼앗는다. iOS 는 앱을 지우면 앱 데이터가 함께 지워지므로 구 값이 남아 있으면 업데이트로 보고 현행 플래그를 유지한다(기기 전체 복원은 한계). **저장 `POST /l/referrer` 는 세션을 확보한 두 지점에서** access token 과 함께 보낸다: ① 로그인·게스트 시작 뒤 `postAuthSave` 안(claim 보다 먼저) ② **콜드스타트 세션 복원이 성공한 직후**(`App.tsx` 복원 effect 에서 `getMyProfile` 이 성공해 토큰이 유효로 확인된 뒤). Auto Backup 이 `STORAGE_KEYS.user`(토큰)와 `onboardingComplete` 까지 복원하면 재설치한 앱은 로그인 화면 없이 홈으로 가서 ① 이 불리지 않기 때문이다(`App.tsx:181-243` — 둘 다 있으면 `postAuthSave` 없이 복원, 매니페스트에 `fullBackupContent`·`dataExtractionRules` 없음). 오프라인이라 프로필 조회가 실패한 복원에서는 보내지 않고 다음 실행에 다시 본다. 두 지점 모두 **현재 `installId` 가 이미 보고한 값과 다를 때만** 보내고, ② 에서도 저장 응답 뒤 claim 을 부른다(복원된 세션은 기존 계정이라 가입 수에는 들어가지 않는다). 2xx 를 받으면 그때의 `installId` 를 완료 값으로 저장하고, 다음 세션에서 `installId` 가 저장값과 다르면 다시 보낸다(Auto Backup 으로 앱 데이터가 복원돼도 백업되지 않는 `installId` 는 새로 생겨 값이 달라진다). referrer 를 아직 못 읽었으면 완료 값을 저장하지 않고 다음 실행에 다시 읽는다. referrer 완료 값은 구 앱에 없던 값이라 옮겨 적기 규칙이 필요 없다. **400(`installId` 없음)·401·429·5xx·타임아웃이면 완료 값을 저장하지 않는다**(현 `deferredInvite.matchOnce` 와 같은 규칙). **세션 확보 뒤 `/l/referrer` 응답의 `source` 가 `UNKNOWN`·`ORGANIC` 인데 그 `installId` 에서 fingerprint 매치를 아직 하지 않았으면 그때 `/l/match` 를 1회 부른다** — 로컬 판별과 서버 판별이 어긋나도 fallback 을 잃지 않게 한다(매치 창 밖이면 서버가 후보 없음으로 끝낸다). `attributionId` 보관은 **응답 `source` 가 LINK·META·GOOGLE 일 때만** 한다 — ORGANIC·UNKNOWN 이면 보관하지 않고 claim 은 fingerprint 매치의 slug 로만 한다(§2.5·§3.2) | 구 앱은 호출하지 않을 뿐 |
| 3 | claim: 캠페인 slug 는 `deviceId` 함께, referrer 귀속은 `/l/referrer` 응답이 LINK·META·GOOGLE 일 때 그 뒤 `{attributionId, deviceId, installId}` | 구 앱의 `{slug}` 는 INVITE 규칙 |
| 4 | iOS: Info.plist `NSAdvertisingAttributionReportEndpoint = https://link.oneorthree.world`, `SKAdNetworkItems` 에 Meta·Google 식별자, 첫 실행 `updatePostbackConversionValue(0)` · 가입 1 · 첫 집중 완료 2 (coarse low·medium·high) | 서버 무관 |
| 5 | Android App Links: `MainActivity` 에 **`android:autoVerify="true"`** 인 인텐트 필터(`action VIEW` · `category DEFAULT`·`BROWSABLE` · `scheme=https` · `host=link.oneorthree.world` · `pathPrefix=/l/`)를 더한다. 현 `AndroidManifest.xml` 에는 `gromo` 스킴 필터뿐이다. `autoVerify` 가 없으면 서버에 `assetlinks.json` 이 있어도 Android 12 이상에서 검증된 App Link 로 등록되지 않아 설치된 앱이 링크로 열리지 않고, `/l/resolve` 흐름이 동작하지 않는다 | 서버 assetlinks 와 짝 |
| 6 | **설치 식별자 `installId`**: 첫 실행에 UUID 를 만들어 **Auto Backup 에서 제외되는 저장소**에 둔다 — Android 는 `Context.getNoBackupFilesDir()` 아래 전용 파일(작은 네이티브 모듈로 읽고 쓴다. AsyncStorage 는 모든 키가 한 DB 파일이라 키 하나만 백업에서 뺄 수 없다). 현 앱은 매치 요청 바디가 `{os, deviceId, appInstanceId}` 뿐이고(`deferredInvite.ts`), `deviceId` 는 AsyncStorage(`STORAGE_KEYS.deviceId`, `analytics.ts`)에 저장한 자체 발급 UUID 라 `android:allowBackup="true"` 에서 재설치 뒤 복원될 수 있으며, 백업 제외 저장소나 설치별 식별자는 없다. `/l/match`(구 앱은 없음)·`/l/referrer`(**필수**) 요청 바디에 싣는다. iOS 는 앱 샌드박스에 두고(앱 삭제 시 지워짐) 기기 전체 백업 복원으로 되살아나는 경우는 한계로 둔다. 앱 데이터 삭제는 `deviceId`·`installId` 를 함께 새로 만들어 같은 설치를 한 번 더 센다(§2.4-1 한계) | 구 앱은 `installId` 없이 매치하고 서버는 현행 기기·창 규칙으로 처리한다 |

## 6. 콘솔 (business-api)

### 6.1 의존성·설정

- 추가 의존성: `spring-boot-starter-thymeleaf`, `spring-security-crypto`(bcrypt 만. Spring Security 필터 체인은 쓰지 않는다).
- env: `CONSOLE_SLOT_<NAME>_HASH`(bcrypt, 팀원 수만큼) · `CONSOLE_COOKIE_KEY`(32바이트 이상) · `RATE_LIMIT_IP_KEY`(32바이트 이상, §4.3 과 공유). 슬롯 이름은 env 이름에서 뽑은 짧은 영문이고 `X-Actor`·`created_by` 에 쓴다.

### 6.2 인증

| 요소 | 규칙 |
| --- | --- |
| 로그인 | `POST /console/login {slot, password}` → bcrypt 대조. 없는 슬롯과 틀린 비밀번호는 같은 메시지 |
| 쿠키 | `gromo_console = base64url(slot · credVersion · issuedAt · expiresAt) + "." + HMAC-SHA256(CONSOLE_COOKIE_KEY)`. `credVersion = hex(SHA-256(CONSOLE_SLOT_<NAME>_HASH 값))` 의 앞 16자다 — bcrypt 해시에는 매번 새 salt 가 들어가므로 같은 비밀번호로 다시 설정해도 값이 바뀐다. `HttpOnly` · `Secure` · `SameSite=Strict` · `Path=/console` · 30일 |
| 필터 | `ConsoleSessionFilter` 가 `/console/**`(로그인·정적 제외)에서 서명·만료·**슬롯이 env 에 아직 있는지**·**쿠키의 `credVersion` 이 현재 env 해시에서 계산한 값과 같은지**를 본다. 비밀번호를 바꾸거나(해시 교체) 슬롯을 지웠다가 같은 이름으로 다시 추가하면 기존 쿠키는 즉시 무효다 — 슬롯 존재만 보면 유출된 비밀번호로 받은 쿠키가 교체 뒤에도 30일간 산다. 적용 여부는 토큰 필터와 같은 원문 경로 정규식으로 정한다(§4.5) |
| 잠금 | Redis `console:fail:slot:<slot>` 5회/15분, `console:fail:ip:<ipHmac>` 20회/15분(`ipHmac` = `HMAC-SHA256(RATE_LIMIT_IP_KEY, ip)`). 넘으면 "15분 뒤 다시 시도하세요" |
| 폼 | 모든 POST 폼에 1회용 `formToken`(Redis `console:form:<token>`, 1시간). 제출 때 `GETDEL`, 없으면 "이미 처리했거나 만료된 요청입니다". 키 패턴 `console:fail:*`·`console:form:*` 은 [아키텍처 A19](../../architecture/decisions.md) 네임스페이스 표와 Business API ACL 에 등록돼 있다 |
| 헤더 | `Cache-Control: no-store` · `X-Frame-Options: DENY` · `Content-Security-Policy: default-src 'self'` |
| 로그아웃 | `POST /console/logout` 이 쿠키를 지운다 |

### 6.3 화면

| 경로 | 보여주는 것 | 동작 |
| --- | --- | --- |
| `/console/login` | 슬롯·비밀번호 | 로그인 |
| `/console/campaigns` | 캠페인 표(이름 · 채널 · 플랫폼 · 기간 설치 · 가입 · 신뢰도 표기) + 채널 단위 합. 기간 기본 최근 7일 | 캠페인 만들기 |
| `/console/campaigns/{id}` | 링크 표(slug · URL · 목적지 · 상태 · 클릭 · 설치 · 가입), Android 는 Play 스토어 URL 복사 칸, `notes` 문구 | 링크 발급 · 폐기 · 캠페인 수정(이름 · 보관 / Meta campaign_id · SKAN source-identifier 는 비어 있을 때 한 번만 입력, §1.2) |

`notes` 문구: `SKAN_DELAYED` "iOS 광고 수치는 측정 창이 끝난 뒤 1~2일 늦게 들어옵니다" · `GOOGLE_CHANNEL_ONLY` "Google 광고는 채널 합계만 셉니다. 캠페인별은 Google Ads 에서 확인하세요" · `SKAN_CHANNEL_ONLY` "SKAN 캠페인 번호가 없어 채널 합계에만 들어갑니다".

## 7. 오류·시간 예산

| 상황 | 공개 응답 | 기록 |
| --- | --- | --- |
| 랜딩에서 data-api 무응답(1.5초) | 강등 랜딩 200 | WARN |
| 없는 slug | 만료 랜딩 200 | — |
| match·referrer·resolve 에서 매치·링크 없음 | 200 `{matched:false}` · resolve 는 404 | — |
| match·referrer·resolve 에서 data-api 오류·무응답(3초) | **503** + `Retry-After: 60` | WARN |
| 공개 경로 레이트리밋 초과(SKAN 수신 경로 제외) | **429** | 카운터 |
| `/l/referrer` 토큰 없음 | 401 | — |
| `/l/referrer` `installId` 없음 | 400 · 미저장 | 카운터 |
| `/l/referrer` 유저 KST 당일 상한 초과 | 429 · 미저장 | 카운터 |
| `/l/referrer` 저장 도중 탈퇴 | 200 · 미저장 · `attributionId` 없음 | DEBUG |
| LINK referrer 저장 중 캠페인 보관·링크 폐기가 먼저 커밋 | 200 `{source:"UNKNOWN", matched:false}` · `link_id=NULL` 로 저장 | DEBUG |
| 봇 UA 방문 | 랜딩 200 · 클릭 미기록 | DEBUG |
| 랜딩 IP 한도 초과 | 랜딩 200(정상 뷰) · 클릭 미기록 · `visits` 를 `recordClick=false` 로 호출 | 카운터 |
| META·GOOGLE 캠페인 링크의 iOS 방문 | 랜딩 200 · 클릭 미기록 | DEBUG |
| 같은 링크·IP 해시·OS 클릭이 매치 창 안 20건 이상(매치 여부 무관) | 랜딩 200 · 가장 최근 클릭의 `clickId` | 카운터 |
| 토큰 필터 예외에 없는 경로·메서드(원문 변형 포함) | 401 | — |
| referrer 복호화 실패 | 200 `{source:"META", matched:false}` | `decrypt_failed=true` |
| SKAN 본문 16KB 초과 | 413 | 카운터 |
| SKAN 동시 서명 검증 32건 초과(인스턴스당) | 503 + `Retry-After: 30` | 카운터 `reason=overloaded` · 경보 |
| SKAN JSON 아님 | 400 | 카운터 |
| SKAN 다른 앱 · 서명 실패 · 모르는 버전 | 200 | **미저장**, 카운터 + `transaction-id` 샘플 로그 |
| SKAN 저장 실패(5초) | 500 | ERROR + `transaction-id` |
| claim 대상 없음·기기 불일치·셀프 초대·이미 선점·탈퇴한 유저·ORGANIC/UNKNOWN referrer | 200 | DEBUG |
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

정책 L15 대로 #745 는 링크 분리 전제 코드를 포함한 채 **2026-09-13 머지됐다(`1ec66e0dd`)**. 아래 목록은 그 머지 커밋 기준이다 — 앞서 대조한 head `a455bd182` 와 링크 관련 파일 차이가 없고, `37db435d1` 이후 링크 관련 클래스는 추가·삭제 없이 내용만 바뀌었으며 테스트 `CompatMatchMigrationIdContractTest` 가 새로 생겼다. **구현 PR 착수 때 그 시점 main 에서 다시 확인한다.**

### 9.1 머지 뒤 켜지 않는 것

아래는 **지금 main 에 들어 있는 설정**이다(#745 머지). 구현 PR 이 걷어내기 전까지 켜지 않는다.

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
| business-api | `upstream/link/LinkApiClient` · `upstream/link/dto/*` · `usecase/ClaimIntentReplay*` · `usecase/ClaimIntentTermination` · `usecase/InviteLinkUseCase`(data 위임으로 다시 작성) · `usecase/CompatMatchUseCase` · `api/LinkMatchCompatController` · `upstream/data/dto/ClaimIntent*` · 관련 테스트(`CompatMatchMigrationIdContractTest` 포함) · 설정 `link.proxy-secret`·`business.upstream.link`·`business.compat`·`claim-replay` |
| data-api | `internal/InternalMigration*Controller` · `internal/service/InternalClickMigrationService` · `internal/service/InternalInviteLinkService`(claim intent·confirmation) · `invitelink/repository/*ClaimIntent*`·`*ClaimConfirmation*`·`*Frozen*`·`*ClickMigration*` · `invitelink/support/FrozenClickSource`·`LinkCapability*` · `group/service/LinkMembershipEventService` · `group/listener/LinkDisplayNameChangeListener` · `GroupService`·`GroupMemberService` 의 호출부 · `migration/` 의 링크 부분 · `application-link-migration.yml` · 허용목록의 `invite-links/claim-*`·`migrations/*`·`invite-issue-context` · relay `link.*` 대상 |
| 스키마 | V52 의 `invite_claim_intents` · `invite_claim_confirmations` · `invite_click_migrations` · `invite_click_frozen_rows` · `invite_link_frozen_rows` 는 **contract 마이그레이션(§1.1)에서** DROP 한다. 코드(엔티티)는 2단계 PR 에서 지우지만 테이블은 contract 까지 남겨 2~4단계 이미지 롤백을 지킨다. V52 의 `group_members` 변경은 용도를 확인해 membershipEpoch 전용이면 contract 에서 함께 되돌린다 |

`LinkMembershipEventService` 를 지우면 멤버십 이탈 때 링크를 폐기하는 경로가 없어진다. 그 서비스는 없는 링크 서버로만 보냈고 현 main 에도 폐기가 없어 expand 기간이 현행보다 나빠지지는 않는다. **그룹 획득 LLD §2.1 의 같은 트랜잭션 폐기는 contract 이미지에서 켠다**(§1.1 — expand 에서 켜면 롤백한 이전 이미지가 폐기 행과 새 행을 함께 읽는다).

## 10. 테스트

| 층 | 검증 |
| --- | --- |
| data-api (Testcontainers) | expand 뒤 기존 slug 의 방문·매치·claim 회귀 · **expand 스키마에서 이전 이미지 엔티티가 `ddl-auto=validate` 로 기동** · contract 뒤 새 이미지 기동 · `ck_links_type_shape` 위반 거절 · expand 스키마에서 전체 unique 로 동시 발급이 한 slug 로 수렴 · **expand 이미지에서 폐기·재발급이 꺼져 한 쌍에 INVITE 행이 1개** · **contract ① 보정이 발급자 이탈·그룹 종료 행만 `REVOKED` 로 바꾸고 활성 행은 건드리지 않음** · contract 뒤 폐기 → 재발급이 새 slug 행을 만들고 부분 unique 로 동시 재발급이 수렴 · 같은 `install_key` 동시 referrer 2건이 1행 · 같은 `deviceId` 에 설치 시작 시각이 다른 referrer 는 2행(재설치) · LINK referrer 가 클릭을 소진해 다른 기기 fingerprint 가 그 클릭을 못 가져감 · **같은 기기에서 `/l/match` 가 먼저 성공한 뒤 LINK referrer 가 오면 `click_id` 가 그 클릭이고 설치 합계가 1** · **referrer 뒤의 `/l/match` 가 새 클릭을 소진하지 않음** · INVITE 링크 referrer 응답에 `groupId` · 방문 응답의 `clickId` 가 저장된 클릭 id 와 같음 · 캠페인 slug claim 의 기기 불일치 no-op · `attributionId` 기기 불일치 no-op · **탈퇴 트랜잭션 진행 중 들어온 claim 이 탈퇴 커밋 뒤 no-op 이고 `claimed_user_id`·`reporter_user_id` 가 NULL** · **봇 UA 방문이 클릭 행 0** · **같은 IP·OS 에서 최신 클릭이 폐기 링크면 더 오래된 활성 클릭을 소진하지 않고 `matched:false`** · 유저당 4번째 referrer 가 429·미저장이고 같은 `install_key` 재전송은 상한 미포함 · **같은 유저가 서로 다른 `install_key` 로 동시에 5건을 보내도 저장 3건** · **탈퇴 트랜잭션 진행 중 들어온 referrer 저장이 탈퇴 커밋 뒤 미저장** · **두 사용자가 같은 `attributionId` 로 동시에 claim 하면 한 명만 성공** · **claim 이 가입 며칠 뒤 성공해도 `signup_at` 의 날(가입 날)로 집계** · **`platform=IOS` 캠페인의 `external_id` 거절** · **GOOGLE referrer 의 신규 claim 이 `channels.GOOGLE.signups.claim` 에 들어감** · INVITE 방문 응답에 `groupId` · 매치 창 밖 재설치 기기가 새 후보를 매치 · **INVITE referrer 를 발급자 본인이 `attributionId` 로 claim 하면 no-op** · 기존 계정(`created_at` 이 클릭보다 이전) claim 은 `claimed_as_new_user=false` 이고 `signups.claim` 에서 빠짐 · **referrer 저장 뒤 발급자 이탈 · 그룹 종료 · 캠페인 링크 폐기가 오면 `attributionId` claim 이 no-op** · **같은 기기가 매치 창 밖에서 같은 링크로 재설치하면 `click_id=NULL` 이고 설치 2건** · **fingerprint 매치·slug claim 뒤 같은 설치의 LINK referrer 저장·claim 이 오면 가입 1건** · **Play 설치·클릭 시각이 없는 referrer 를 가입 직후 claim 하면 `claimed_as_new_user=true`, 기존 계정(가입 며칠 전)은 `false`, 가입 뒤 저장이 10분 넘게 늦으면 `false`(한계 고정)** · **`IOS` 캠페인 링크의 Android referrer·Android fingerprint 설치와 그 가입이 캠페인 수치 0 이고 `channels.<캠페인 channel>` 에 들어감** · **같은 링크·IP 해시·OS 로 25회 방문하면 클릭 행 20, 21번째부터 같은 `clickId`** · **방문과 `/l/match`(매번 다른 `deviceId`)를 번갈아 25회 해도 클릭 행 20** · **발급자 이탈 트랜잭션과 INVITE claim(slug·`attributionId`)이 경합하면 이탈이 먼저면 claim no-op, claim 이 먼저면 claim 1건이 폐기 전 이력으로 남고 그 뒤 claim 은 no-op — 교착 없음** · **캠페인 링크 콘솔 폐기와 claim 경합도 한쪽만** · **한 사용자가 두 `attributionId`(또는 캠페인 slug 둘)를 동시에 claim 하면 `claimed_as_new_user=true` 는 1행이고 가입 1건** · **앱 데이터 삭제 뒤 같은 Play 설치 시각의 referrer 는 `deviceId` 가 달라 2행(한계 고정)** · **같은 기기가 매치 창 안에서 다른 `installId` 로 재설치해 `/l/match` 하면 기존 매치를 재반환하지 않고 새 후보를 매치** · **`installId` 없는 구 앱의 `/l/match` 는 현행대로 창 안 기기별 재반환** · **Play 설치 시각이 없는 referrer 둘은 `installId` 가 다르면 2행, 같으면 1행** · **LINK referrer 가 소진한 클릭의 `matched_install_id` 가 그 설치의 값이고 뒤이은 같은 설치의 `/l/match` 가 그 클릭을 재반환** · **claim → 탈퇴 → 다른 계정이 같은 slug·`attributionId` 로 claim 하면 no-op 이고 `claimed_at`·`signup_at` 불변** · **Auto Backup 으로 복원된 `attributionId`·`deviceId` 를 다른 `installId` 로 claim 하면 no-op** · **구 앱 NULL 매치(설치 A) 뒤 매치 창 안 재설치 B 의 LINK referrer 가 A 의 클릭(`matched_at < install_begin_at`)에 연결되지 않고 설치 2건** · **설치 시각이 없는 LINK referrer 는 NULL 매치 클릭에 연결되지 않음** · **첫 실행 referrer 실패 → fingerprint 매치·slug claim(클릭 `true`) → 다음 실행 같은 설치 LINK referrer 저장·`attributionId` claim 이면 referrer `true`·클릭 `false` 로 옮겨지고 가입 1건** · **사용자 A·B 가 서로의 INVITE 링크를 동시에 claim 해도 교착 없이 둘 다 끝남(관련 user UUID 오름차순 락)** · **캠페인 보관 커밋과 캠페인 링크 claim 경합 → 보관이 먼저면 claim no-op, claim 이 먼저면 claim 1건 뒤 보관** · **캠페인 보관 커밋과 콘솔 링크 발급 경합 → 보관이 먼저면 발급 409 `CAMPAIGN_ARCHIVED`, 발급이 먼저면 링크 1건 뒤 보관** · **설정된 `external_id`·`skan_source_identifier` 를 바꾸거나 지우는 PATCH 는 409, 보관된 캠페인의 값을 새 캠페인에 쓰면 409** · **contract 이미지에서 탈퇴가 `link_clicks`·`install_referrers` 익명화까지 커밋(JPQL 이 최종 이름을 따라감)** · 기간 인덱스가 캠페인 집계 쿼리 계획에 쓰임(`EXPLAIN`) · SKAN 재전송 1행 · 집계의 KST 경계(`to` 날 23:59 포함, 다음 날 00:00 제외) · `installs.referrer` 가 `install_begin_at` 기준(설치 전날·첫 실행 다음 날 경계) · SKAN 끝자리 대조(`5239` 등록, 포스트백 `39` → 귀속, `5239`·`1139` 둘 다 등록이면 채널 단위, `52` 는 비귀속) · 한 설치에서 계정 u 클릭 claim(신규) 뒤 기존 계정 v 의 referrer claim(`false`) → 가입 1건 · `REFERRER_COUNT_SINCE` 이전 설치 시각의 referrer 는 설치·가입에서 제외 · **ORGANIC 설치: fingerprint 매치·slug claim 뒤 같은 설치의 ORGANIC referrer 저장 → 설치 1(fingerprint)·가입 1(캠페인 원장)이고 `installs.referrer`·`channels.*` 는 0** · **ORGANIC·UNKNOWN referrer 를 가리키는 `attributionId` claim 은 no-op 이고 뒤이은 캠페인 slug claim 이 신규 가입 1건** · **LINK referrer 저장과 캠페인 보관·링크 폐기 경합 → 보관·폐기가 먼저면 `source=UNKNOWN`·`link_id=NULL`·`matched=false`, 저장이 먼저면 LINK 행 1건 뒤 보관** · **`recordClick=false` 방문은 클릭 행 0 이고 `LandingView` 는 `clickId=null` 외에 같은 필드** · **META·ALL(또는 GOOGLE·IOS) 캠페인 링크를 iOS 로 방문하면 클릭 행 0, 같은 IP·OS 의 `/l/match` 는 `matched:false`** · ORGANIC 캠페인 링크의 iOS 방문은 클릭 1 |
| business-api | referrer 판별 표(§4.1 다섯 규칙 + 깨진 인코딩 · 빈 문자열 · 변조된 Meta payload) · SKAN 서명 검증(버전별 Apple 문서 예시 포스트백을 픽스처로) · **서명 실패·다른 `app-id`·모르는 버전이 data-api 호출 0회** · 16KB 초과 413 · **SKAN 경로는 같은 발신 IP 에서 분당 수백 건이 와도 429 없이 서명 검증까지 진행** · **동시 서명 검증 33번째는 503 + `Retry-After`** · **SKAN 두 경로에는 공개 경로 레이트리밋이 걸리지 않아 429 응답이 없음** · **`utm_content` JSON 에 `source.nonce` 만 있는 referrer → 서버 판별 UNKNOWN** · match·referrer·resolve 가 data-api 5xx·타임아웃이면 503 + `Retry-After`, 매치 없음은 200 · 레이트리밋 초과 429 · `/l/referrer` 토큰 없음 401·data-api 호출 0 · **`/l/referrer` `installId` 없음 400·data-api 호출 0** · **claim `attributionId` 에 `installId` 없음 400** · **Redis 키에 원본 IP 문자열이 없음** · resolve 가 클릭을 기록하지 않음 · 강등 랜딩 · 만료 랜딩의 Play URL 에 `referrer` 없음 · **콘솔 `playStoreUrl` 은 `slug` 만 든 referrer 이고 그 값이 §4.1 로 LINK** · INVITE 랜딩 스킴이 `gromo://join?g=…&s=…` · **`IOS` 캠페인의 콘솔 `playStoreUrl` 이 `null` 이고 랜딩에 Android 버튼 없음, `ANDROID` 캠페인 랜딩에 App Store 버튼 없음** · **랜딩 IP 한도 초과 시 `visits` 가 `recordClick=false` 로 1회 호출되고 그룹명·목적지·플랫폼별 스토어 버튼이 정상 렌더(Android 버튼 referrer 는 `slug` 만)** · **토큰 필터: 토큰 없이 `GET /l/k3m9x2pa` · `POST /l/match` · `POST /l/resolve` · well-known 둘 · SKAN 두 경로 · `GET /link/og-invite-v2.png` · `/console/login` 은 통과, `POST /l/referrer` · `/%6C/k3m9x2pa` · `/l;x/k3m9x2pa` · `/api/v1/…` 는 401** · **slug 생성기가 예약어를 발급하지 않음** · IP 신뢰(사설 피어만) · 콘솔 잠금 · 쿠키 변조 · 슬롯 제거 즉시 무효 · **슬롯 비밀번호 해시 교체 · 슬롯 삭제 후 같은 이름 재추가 뒤 기존 쿠키 무효** · 폼 토큰 재사용 거절 |
| 앱 (앱 티켓) | Auto Backup 으로 세션·`onboardingComplete` 가 복원된 재설치에서 콜드스타트 복원 성공 뒤 `/l/referrer` 가 1회 나가고 claim 이 이어짐 · 오프라인 복원(프로필 조회 실패)에서는 보내지 않고 다음 실행에 보냄 · 보고한 설치 키와 같으면 두 지점 모두 재전송 없음 · **Play 설치 시각이 없는 백업 복원 재설치는 `installId` 가 달라 referrer·fingerprint 를 다시 시도** · `postAuthSave` 경로에서 referrer 저장이 claim 보다 먼저 · **`installId` 가 백업 제외 파일에 있어 Auto Backup 복원 뒤 재설치에서 새 값이 되고 `/l/match`·`/l/referrer` 바디에 실림** · 구 앱 `deferredInviteChecked = '1'` 에서 업데이트한 첫 실행(`firstInstallTime < lastUpdateTime`) → `/l/match` 호출 0 · **구 앱 삭제 뒤 새 버전 재설치(Auto Backup 이 `'1'` 복원, `firstInstallTime == lastUpdateTime`) → `/l/match` 호출 1** · **`utm_content` JSON 에 `source.nonce` 만 있는 referrer → 앱 로컬 판별도 UNKNOWN 이라 `/l/match` 호출, 세션 뒤 `/l/referrer` 응답이 UNKNOWN 이고 매치 전이면 `/l/match` 1회** · 값이 현재 `installId` 로 옮겨짐 · 첫 실행 referrer 읽기 실패 → 다음 실행 성공 시 같은 `installId` 라 재매치·초대 시트 재표시 0, `/l/resolve` 는 첫 성공 읽기 때 1회 · **`/l/referrer` 응답이 ORGANIC·UNKNOWN 이면 `attributionId` 를 보관·전송하지 않음** |
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
| 7 | 구현 시점의 Flyway 최대 번호(열린 PR 포함). 2026-09-13 기준 main(#745 머지)이 V54 까지 쓰고 #751·#752·#753 도 V53·V54 를 다른 이름으로 써서 겹친다 — 머지 순서대로 다시 매긴 뒤 V55 이상에서 확정 | §1.1 |
| 8 | prod Flyway 가 이력의 미래 버전을 무시하는지(`ignoreMigrationPatterns`, 기본 `*:future`). 무시하지 않으면 expand 뒤 이전 이미지 롤백이 Flyway 검증에서 막힌다(contract 는 roll-forward 전용) | §1.1 · HLD §7 |
| 9 | 출시 뒤 `installs.referrer` 가 광고 대시보드 설치 수보다 크게 부풀면 앱·설치 증명(Play Integrity API)을 `/l/referrer` 저장 조건에 더한다 | §4 · 정책 L23 |
| 10 | 출시 뒤 앱 데이터 삭제로 인한 과집계(같은 Play 설치 시각인데 `deviceId` 만 다른 referrer 행)가 관측되면 Play 서버 설치 시각 + referrer 원문 해시로 중복을 걸러낸다 | §2.4-1 · 정책 L21 |
