-- GROMO-2289 고양이 잡지 발행 (잡지 구현 계획 §2-2 V115) — 매일 07:00 KST 한 호, 계정당 1부의 받음 상태, 편집부 소식.
--
-- magazine_issues: 호 하나 = 한 행. 발행 배치(MagazinePublishService)가 07:00 KST 부터 23:50 까지 10분마다 «오늘 호가
--   없으면» 만든다 — (issue_date, slot) 유일과 issue_no 유일이 같은 날 두 번째 발행을 막는 최후 방어선이다.
--   slot 은 조간·석간 전환(OPS-03, 「나중에」) 때 'EVENING' 을 CHECK 에 더하려고 미리 둔 열이다 — 지금은 MORNING 뿐.
--   editorial: 발행 순간 고정한 편집부 페이지(주간 랭킹 1~3위 · 어제 새로 생긴 섬 · 편집부 소식 또는 몽돌 팁 번호).
--   promotion_count: 이 호에 실린 홍보 수(조간·석간 전환 판단용 숫자). 호 행은 지우지 않는다(작고, 기록판이 본다).
-- magazine_receipts: 계정당 1부의 받음·나중에·읽음. 행이 없으면 «아직 안 받음» 이다 — 07시에 전 계정 몫을 미리 만들지
--   않고 앱이 처음 알릴 때 만든다. received_place 와 received_at 은 처음 값으로 고정된다. 최근 7호보다 오래된 호의 행은
--   발행 배치가 지운다. 유저는 익명화만 되고 삭제되지 않아 ON DELETE CASCADE 가 돌지 않는다 → 탈퇴 TX 가 직접 지운다.
-- magazine_editorial_notes: 운영이 날짜별로 넣는 편집부 소식(SQL 런북). 없는 날은 몽돌 팁이다. 길이는 칸 실측 전 임시 80자.
CREATE TABLE magazine_issues (
    id              uuid        PRIMARY KEY,
    issue_date      date        NOT NULL,
    slot            varchar(10) NOT NULL DEFAULT 'MORNING' CHECK (slot IN ('MORNING')),
    issue_no        integer     NOT NULL UNIQUE CHECK (issue_no > 0),
    published_at    timestamptz NOT NULL,
    editorial       jsonb       NOT NULL,
    promotion_count integer     NOT NULL CHECK (promotion_count >= 0),
    UNIQUE (issue_date, slot)
);

CREATE TABLE magazine_receipts (
    user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    issue_id       uuid        NOT NULL REFERENCES magazine_issues (id) ON DELETE CASCADE,
    received_place varchar(10) NOT NULL CHECK (received_place IN ('SEA', 'ISLAND')),
    received_at    timestamptz NOT NULL,
    deferred_at    timestamptz,
    opened_at      timestamptz,
    PRIMARY KEY (user_id, issue_id)
);

-- 7호 정리(issue_id 로 지운다)용.
CREATE INDEX magazine_receipts_issue_idx ON magazine_receipts (issue_id);

CREATE TABLE magazine_editorial_notes (
    issue_date date        PRIMARY KEY,
    body       varchar(80) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
