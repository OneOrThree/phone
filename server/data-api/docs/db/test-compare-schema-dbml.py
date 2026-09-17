"""compare-schema-dbml.py 의 규약 검사가 실제로 «발화하는지» 확인한다.

    python3 test-compare-schema-dbml.py

도커도 DB 도 필요 없다 — 작은 가짜 입력만 쓴다. 안 터지는 검사는 검사가 아니라서,
대조 로직을 고칠 때 이걸 먼저 돌려 「깨끗한 입력은 통과하고 위반은 잡히는지」를 본다.
"""
import os
import pathlib
import subprocess
import sys
import tempfile

TOOL = str(pathlib.Path(__file__).with_name("compare-schema-dbml.py"))

DBML_CLEAN = """Table a {
  id uuid [pk]
  b_id uuid [not null]
}

Table b {
  id uuid [pk]
}

Ref: a.b_id > b.id
"""

DBML_DUP_REF = DBML_CLEAN + "Ref: a.b_id - b.id  // 같은 컬럼에 두 번째 Ref\n"

DBML_INLINE = """Table a {
  id uuid [pk]
  b_id uuid [not null, ref: > b.id]
}

Table b {
  id uuid [pk]
}
"""

# note 안의 `//`(URL) 가 주석으로 잘리면 `not null` 을 못 읽어 NULL 드리프트가 난다.
# 홑따옴표·겹따옴표 양쪽을 다 본다 — 전에는 한쪽만 보호돼서 다른 쪽에서만 샜다.
DBML_URL_NOTE = """Table a {
  id uuid [pk]
  b_id uuid [not null, note: 'https://example.com/docs 참고']
}

Table b {
  id uuid [pk, note: "https://example.com/b 참고"]
}

Ref: a.b_id > b.id
"""

REAL_COLS = "a|id|uuid|NO|\na|b_id|uuid|NO|\nb|id|uuid|NO|\n"
REAL_FKS = "a|b_id|b|id|NO ACTION\n"


def run(dbml_text):
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "real_columns.txt").write_text(REAL_COLS)
    (d / "real_fks.txt").write_text(REAL_FKS)
    (d / "s.dbml").write_text(dbml_text)
    env = {**os.environ, "SCRATCH": str(d), "DBML_PATH": str(d / "s.dbml")}
    return subprocess.run([sys.executable, TOOL], capture_output=True, text=True, env=env).stdout


clean = run(DBML_CLEAN)
assert "규약" not in clean, f"깨끗한 입력에서 규약 위반이 나왔다:\n{clean}"
assert "드리프트 0건" in clean, f"깨끗한 입력이 통과하지 않는다:\n{clean}"

dup = run(DBML_DUP_REF)
assert "규약 6 위반: a.b_id" in dup, f"규약 6 검사가 발화하지 않았다:\n{dup}"

inline = run(DBML_INLINE)
assert "규약 7 위반: a.b_id" in inline, f"규약 7 검사가 발화하지 않았다:\n{inline}"
# 인라인 ref 는 `^Ref:` 스캔이 못 읽으므로 실제 FK 가 «누락»으로도 잡혀야 한다.
assert "실제 FK 인데 dbml 에 Ref 가 없다: a.b_id" in inline, f"미탐이 그대로다:\n{inline}"

# 규약 위반은 드리프트로 세되 «내역은 따로» 보여야 한다 — 안 나누면 진짜 스키마 오차를 가린다.
assert "(그중 규약 위반 1건)" in dup, f"규약 위반 내역이 따로 안 보인다:\n{dup}"
assert "(그중 규약 위반" not in clean, f"위반이 없는데 내역 줄이 붙었다:\n{clean}"

url = run(DBML_URL_NOTE)
assert "드리프트 0건" in url, f"note 안의 URL 이 주석으로 잘렸다:\n{url}"

print("✅ 깨끗한 입력 통과 · 규약 6·7 발화(+미탐 동시 검출) · 위반 내역 분리 · note 속 URL 보호")
