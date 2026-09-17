#!/usr/bin/env python3
"""schema.dbml 과 «실제 적용된» 스키마를 테이블·컬럼·FK 단위로 대조한다 (GROMO-1912).

혼자 돌리지 말고 `verify-schema-dbml.sh` 로 부른다 — 그 스크립트가 마이그레이션을 실제로
적용해 이 파일이 읽는 입력(real_columns.txt · real_fks.txt)을 만든다.

보는 축
  테이블 존재 · 컬럼 존재 · 타입 · NULL 허용 · FK 대상 · FK 의 ON DELETE

보지 않는 축 — 알고 두는 것이다
  기본값(default) · 인덱스 · UNIQUE/CHECK 제약 · 컬럼 순서. 「드리프트 0건」이 이 축까지
  맞다는 뜻은 아니다. 축을 늘릴 때는 dbml 쪽 표기 규약부터 정해야 한다 — 읽기만 하고
  비교하지 않는 값을 남기면 검사한다는 «착각»만 남는다(ON DELETE 가 실제로 그랬다).

이 도구가 «전제»하는 dbml 규약 — schema.dbml 머리의 6·7번과 짝이다
  한 컬럼에는 Ref 를 하나만 적는다 · 관계는 항상 단독 `Ref:` 줄로 적는다.
  전제가 깨지면 오탐(실제 FK 가 있는 컬럼의 두 번째 논리 Ref)이나 미탐(인라인 `[ref:]`)이 난다.

환경변수
  SCRATCH   : real_columns.txt · real_fks.txt 가 있는 디렉터리
  DBML_PATH : schema.dbml 경로

종료 코드는 «드리프트 건수»가 아니라 0/1 이다 — 표기 규약은 드리프트가 아니므로
사람이 읽고 판단해야 한다(아래 «표기 규약» 참조).
"""
import collections
import os
import pathlib
import re
import sys

SCRATCH = pathlib.Path(os.environ["SCRATCH"])
DBML = pathlib.Path(os.environ["DBML_PATH"])

# ── 실제 스키마 ───────────────────────────────────────────────────────────────
real_cols = collections.defaultdict(dict)
for line in (SCRATCH / "real_columns.txt").read_text().splitlines():
    if line.strip():
        t, c, ty, nul, dflt = line.split("|", 4)
        real_cols[t][c] = (ty, nul == "YES")

# 한 컬럼이 FK 에 «두 번 이상» 낄 수 있다(복합 FK + 단일 FK). (t, c) 에 한 값씩만 담으면
# 뒤엣것이 앞엣것을 조용히 덮어써 «검사되지 않은 FK» 가 생긴다 — 그래서 대상별로 담는다.
real_fks = collections.defaultdict(dict)
for line in (SCRATCH / "real_fks.txt").read_text().splitlines():
    if line.strip():
        t, c, pt, pc, rule = line.split("|", 4)
        real_fks[(t, c)][(pt, pc)] = rule.strip().upper()

real_tables = set(real_cols)

# ── dbml ─────────────────────────────────────────────────────────────────────
text = DBML.read_text()

# 속성은 «부분 문자열»이 아니라 토큰으로 읽는다. `[note: 'pk 아님']` 처럼 note 안에 든 글자를
# 속성으로 읽으면 있지도 않은 pk·not null 이 생긴다 — 따옴표 안을 먼저 지우고 콤마로 쪼갠다.
NOT_NULL_ATTRS = {"not null", "pk", "primary key"}
QUOTED = re.compile(r"'(?:[^'\\]|\\.)*'" + r'|"(?:[^"\\]|\\.)*"')


def attr_tokens(attrs):
    """`[not null, note: '...']` 를 소문자 토큰 집합으로. 따옴표 안은 속성이 아니다."""
    body = attrs.strip()
    if not (body.startswith("[") and body.endswith("]")):
        return set()
    return {tok.strip().lower() for tok in QUOTED.sub("", body[1:-1]).split(",")}


# `Table x [note: '...'] {` 처럼 이름과 `{` 사이에 note 가 낀다 — 그걸 건너뛰어야 한다.
# 이 부분을 `^Table\s+(\w+)\s*\{` 로 쓰면 58개 중 3개만 잡힌다(실제로 그랬다).
dbml_cols = collections.defaultdict(dict)
for m in re.finditer(r'^Table\s+(\w+)[^\n{]*\{(.*?)^\}', text, re.S | re.M):
    table, body = m.group(1), m.group(2)
    for raw in body.splitlines():
        line = raw.split("//")[0].rstrip()
        if not line.strip() or line.strip().startswith(("Note", "indexes", "}", "{", "(")):
            continue
        mm = re.match(r'\s+(\w+)\s+([A-Za-z][\w()\[\], ]*?)\s*(\[.*\])?\s*$', line)
        if not mm:
            continue
        col, ty, attrs = mm.group(1), mm.group(2).strip(), (mm.group(3) or "")
        dbml_cols[table][col] = (ty, not (attr_tokens(attrs) & NOT_NULL_ATTRS))

# `[delete: cascade]` 를 «읽기만 하고 비교하지 않으면» 읽을 이유가 없다. 표기가 없는 Ref 는
# 읽는 사람이 기본 동작으로 이해하므로 NO ACTION 으로 놓고 실제 delete_rule 과 맞춰 본다.
dbml_fks = collections.defaultdict(dict)
# 컬럼 줄은 `//` 를 먼저 잘라내고 `[...]` 를 통째로 잡는데, Ref 줄만 «첫 `]` 에서 멈추는» 정규식을
# 쓰고 있었다. 같은 파일을 읽는 두 경로가 다른 규칙을 쓰면 한쪽에서만 조용히 새므로 맞춘다.
ref_text = re.sub(r'//[^\n]*', '', text)
for m in re.finditer(
        r'^Ref:\s*(\w+)\.(\w+)\s*[<>-]\s*(\w+)\.(\w+)\s*(\[.*\])?', ref_text, re.M):
    child, ccol, parent, pcol, attrs = m.groups()
    rule = "NO ACTION"
    for tok in attr_tokens(attrs or ""):
        if tok.startswith("delete:"):
            rule = tok.split(":", 1)[1].strip().upper()
    dbml_fks[(child, ccol)][(parent, pcol)] = rule

dbml_tables = set(dbml_cols)
# dbml 이 선언한 Enum — 컬럼 타입이 이 이름이면 «논리 타입 표기»이지 드리프트가 아니다.
enums = set(re.findall(r'^Enum\s+(\w+)\s*\{', text, re.M))

# ── 대조 ─────────────────────────────────────────────────────────────────────
drift = 0
notation = 0


def say(msg):
    global drift
    drift += 1
    print(msg)


print(f"실제 테이블 {len(real_tables)} · dbml 테이블 {len(dbml_tables)}\n")

for t in sorted(real_tables - dbml_tables):
    say(f"❌ 테이블이 dbml 에 없다: {t}")
for t in sorted(dbml_tables - real_tables):
    say(f"❌ 실제에 없는 테이블을 dbml 이 적었다: {t}")

for t in sorted(real_tables & dbml_tables):
    for c in sorted(set(real_cols[t]) - set(dbml_cols[t])):
        say(f"❌ 컬럼이 dbml 에 없다: {t}.{c} ({real_cols[t][c][0]})")
    for c in sorted(set(dbml_cols[t]) - set(real_cols[t])):
        say(f"❌ 실제에 없는 컬럼을 dbml 이 적었다: {t}.{c}")
    for c in sorted(set(real_cols[t]) & set(dbml_cols[t])):
        rty, rnul = real_cols[t][c]
        dty, dnul = dbml_cols[t][c]
        if rty != dty:
            if dty in enums or rty.replace(" without time zone", "") == dty:
                notation += 1          # 표기 규약 — 드리프트가 아니다
            else:
                say(f"❌ 타입: {t}.{c} 실제={rty} dbml={dty}")
        if rnul != dnul:
            say(f"❌ NULL: {t}.{c} 실제={'nullable' if rnul else 'not null'} "
                f"dbml={'nullable' if dnul else 'not null'}")

logical = 0
for k in sorted(set(real_fks) | set(dbml_fks)):
    t, c = k
    real, dbml = real_fks.get(k, {}), dbml_fks.get(k, {})
    for tgt in sorted(set(real) - set(dbml)):
        say(f"❌ 실제 FK 인데 dbml 에 Ref 가 없다: {t}.{c} → {tgt[0]}.{tgt[1]} ({real[tgt]})")
    for tgt in sorted(set(dbml) - set(real)):
        if real:
            # 실제 FK 가 있는 컬럼인데 dbml 이 «다른 대상»을 가리킨다 — 논리 관계가 아니다.
            actual = ", ".join(f"{a}.{b}" for a, b in sorted(real))
            say(f"❌ Ref 대상: {t}.{c} dbml→{tgt[0]}.{tgt[1]} 실제→{actual}")
        else:
            logical += 1               # 논리 관계 — DB 제약이 없을 뿐 관계는 사실이다
    for tgt in sorted(set(real) & set(dbml)):
        if real[tgt] != dbml[tgt]:
            say(f"❌ ON DELETE: {t}.{c} → {tgt[0]}.{tgt[1]} "
                f"실제={real[tgt]} dbml={dbml[tgt]}")

print(f"\n드리프트 {drift}건")
print(f"(참고) Enum·표기 차이 {notation}건 · DB 제약 없는 논리 Ref {logical}건 — 둘 다 드리프트가 아니다")
sys.exit(1 if drift else 0)
