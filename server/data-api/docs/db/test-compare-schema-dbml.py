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

print("✅ 깨끗한 입력 통과 · 규약 6 발화 · 규약 7 발화(+미탐 동시 검출)")
