#!/usr/bin/env python3
"""schema.dbml 과 «실제 적용된» 스키마를 테이블·컬럼·FK 단위로 대조한다 (GROMO-1912).

혼자 돌리지 말고 `verify-schema-dbml.sh` 로 부른다 — 그 스크립트가 마이그레이션을 실제로
적용해 이 파일이 읽는 입력(real_columns.txt · real_fks.txt)을 만든다.

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

real_fks = {}
for line in (SCRATCH / "real_fks.txt").read_text().splitlines():
    if line.strip():
        t, c, pt, pc, rule = line.split("|", 4)
        real_fks[(t, c)] = (pt, pc, rule)

real_tables = set(real_cols)

# ── dbml ─────────────────────────────────────────────────────────────────────
text = DBML.read_text()

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
        dbml_cols[table][col] = (ty, "not null" not in attrs and "pk" not in attrs)

dbml_fks = {}
for m in re.finditer(r'^Ref:\s*(\w+)\.(\w+)\s*[<>-]\s*(\w+)\.(\w+)', text, re.M):
    child, ccol, parent, pcol = m.groups()
    dbml_fks[(child, ccol)] = (parent, pcol)

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
    r, d = real_fks.get(k), dbml_fks.get(k)
    if r and not d:
        say(f"❌ 실제 FK 인데 dbml 에 Ref 가 없다: {t}.{c} → {r[0]}.{r[1]} ({r[2]})")
    elif d and not r:
        logical += 1                   # 논리 관계 — DB 제약이 없을 뿐 관계는 사실이다
    elif (r[0], r[1]) != (d[0], d[1]):
        say(f"❌ Ref 대상: {t}.{c} 실제→{r[0]}.{r[1]} dbml→{d[0]}.{d[1]}")

print(f"\n드리프트 {drift}건")
print(f"(참고) Enum·표기 차이 {notation}건 · DB 제약 없는 논리 Ref {logical}건 — 둘 다 드리프트가 아니다")
sys.exit(1 if drift else 0)
