#!/usr/bin/env python3
"""소마 트러블슈팅 진행 로그 — Stop 훅용.

`back/docs/troubleshooting/.active.json`(무장 스위치)이 있을 때만 동작한다.
응답 종료마다 transcript에서 이번 턴의 작업을 추출해, 대상 사건 문서의
`## 2. 타임라인` 표(마커 `<!-- TIMELINE:END -->` 바로 앞)에 한 행씩 append.

log-work.py 와 같은 계열: LLM 호출 없음(토큰 0), 파일 편집/주요 명령이 있었던
'의미있는 턴'만 기록, 어떤 예외에도 세션을 막지 않도록 최상위에서 조용히 종료.

훅이 남기는 것은 "무슨 일이 있었는지"뿐이다. "왜 그렇게 생각했는지"(가설·기각)는
transcript로 알 수 없으므로 /trouble-log 가 수동으로 담당한다.
"""
import json, os, re, sys, time
from datetime import datetime, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))  # = phone/
TSDIR = os.path.join(ROOT, "back", "docs", "troubleshooting")
ACTIVE = os.path.join(TSDIR, ".active.json")
MARKER = "<!-- TIMELINE:END -->"
ARM_TTL_HOURS = 24

EDIT_TOOLS = {"Edit": "수정", "MultiEdit": "수정", "Write": "생성", "NotebookEdit": "수정"}

# 명령이 줄 시작 또는 쉘 구분자 뒤에 오는 위치만 매칭(부분문자열 오탐 방지).
# 주의: 앞에 \b를 두면 './gradlew'처럼 '.'으로 시작하는 명령은 단어경계가 안 생겨 누락됨.
_POS = r"(?:^|[\s;&|()])"

# 검증 — 테스트/빌드를 돌려 결과를 확인한 턴
TEST_CMD = re.compile(
    _POS + r"(?:\./gradlew|gradlew)\s+[^\n]*\b(?:test|check|build|spotbugsMain|checkstyleMain)\b|"
    + _POS + r"(?:jest|pytest|vitest|\./test-local\.sh)\b|"
    + _POS + r"npm\s+(?:test|run\s+(?:test|lint|typecheck))\b|"
    + _POS + r"mvn\s+[^\n]*\btest\b"
)
# 조치 — 상태를 바꾼 턴
ACTION_CMD = re.compile(
    _POS + r"git\s+(?:commit|push|merge|rebase|revert|cherry-pick|restore|reset)\b|"
    + _POS + r"gh\s+pr\s+(?:merge|create)\b|"
    + _POS + r"docker(?:\s+compose)?\s+(?:up|restart|down|rm)\b|"
    + _POS + r"kubectl\s+(?:apply|rollout|delete)\b|"
    + _POS + r"(?:flyway|terraform\s+apply)\b"
)
# 확인 — 조회·조사한 턴 (위 둘에 안 걸리는 나머지 중 기록할 가치가 있는 것)
INSPECT_CMD = re.compile(
    _POS + r"git\s+(?:log|diff|show|blame|status|bisect)\b|"
    + _POS + r"(?:psql|redis-cli|curl|dig|nc)\b|"
    + _POS + r"docker(?:\s+compose)?\s+(?:logs|ps|inspect|exec)\b|"
    + _POS + r"kubectl\s+(?:logs|get|describe)\b|"
    + _POS + r"(?:rg|grep|ag)\b|"
    + _POS + r"(?:tail|less)\s+[^\n]*\.log\b|"
    + _POS + r"(?:aws|gcloud)\s+\S+"
)


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None


def load_active():
    raw = read(ACTIVE)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def save_active(state):
    try:
        with open(ACTIVE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def disarm():
    try:
        os.remove(ACTIVE)
    except Exception:
        pass


def expired(armed_at):
    """armed_at 이 ARM_TTL_HOURS 를 넘었는지. 파싱 실패는 만료로 본다(안전측)."""
    if not armed_at:
        return True
    try:
        t = datetime.fromisoformat(str(armed_at))
    except Exception:
        return True
    if t.tzinfo is None:
        t = t.astimezone()
    return datetime.now().astimezone() - t > timedelta(hours=ARM_TTL_HOURS)


def text_of(content):
    """message.content(문자열 또는 배열)에서 일반 텍스트만 모은다(tool_result/tool_use 제외)."""
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = []
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            parts.append(str(c.get("text", "")))
    return "\n".join(parts).strip()


def is_tool_result(content):
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "tool_result":
                return True
    return False


def rel(path):
    try:
        return os.path.relpath(path, ROOT)
    except Exception:
        return path


def stamp(ts):
    """transcript 항목의 ISO timestamp(UTC)를 로컬 'YYYY-MM-DD HH:MM'으로. 없으면 현재 시각."""
    if ts:
        try:
            return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone().strftime(
                "%Y-%m-%d %H:%M"
            )
        except Exception:
            pass
    return time.strftime("%Y-%m-%d %H:%M")


def cell(s, limit=120):
    """마크다운 표 한 칸으로 안전하게 만든다 — 개행 제거, 파이프 이스케이프, 길이 제한."""
    s = re.sub(r"\s+", " ", str(s)).strip().replace("|", "\\|")
    if len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


def classify(edits, cmds):
    """이번 턴에 쓴 도구로 타임라인 '구분'을 추측한다. 가설·상태는 사람 몫이라 붙이지 않는다."""
    joined = "\n".join(cmds)
    if TEST_CMD.search(joined):
        return "검증"
    if edits or ACTION_CMD.search(joined):
        return "조치"
    return "확인"


def evidence(edits, cmds, limit=3):
    items = [f"`{os.path.basename(fp)}`" for _, fp in edits]
    items += [f"`{cell(c, 40)}`" for c in cmds]
    out, seen = [], set()
    for it in items:
        if it in seen:
            continue
        seen.add(it)
        out.append(it)
        if len(out) >= limit:
            break
    extra = len(set(items)) - len(out)
    if extra > 0:
        out.append(f"외 {extra}건")
    return " · ".join(out)


def collect_turns(lines):
    """새 transcript 줄을 '턴' 단위로 묶는다: 비-tool_result user 메시지가 새 턴을 연다."""
    turns, cur = [], None

    def new_turn(ts=None):
        return {"text": "", "edits": [], "commands": [], "at": stamp(ts)}

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        typ = obj.get("type")
        ts = obj.get("timestamp")
        msg = obj.get("message") or {}
        content = msg.get("content")

        if typ == "user" and not is_tool_result(content):
            t = text_of(content)
            if t and not t.startswith("<"):  # 훅/시스템 주입 노이즈 컷
                cur = new_turn(ts)
                turns.append(cur)
        elif typ == "assistant":
            if cur is None:
                cur = new_turn(ts)
                turns.append(cur)
            if ts:
                cur["at"] = stamp(ts)
            t = text_of(content)
            if t:
                cur["text"] = t  # 턴 내 마지막 텍스트가 최종 요약
            if isinstance(content, list):
                for c in content:
                    if not (isinstance(c, dict) and c.get("type") == "tool_use"):
                        continue
                    name = c.get("name", "")
                    inp = c.get("input") or {}
                    if name in EDIT_TOOLS:
                        fp = inp.get("file_path") or inp.get("notebook_path")
                        if fp:
                            cur["edits"].append((EDIT_TOOLS[name], rel(fp)))
                    elif name == "Bash":
                        cmd = (inp.get("command") or "").strip()
                        if not cmd:
                            continue
                        head = cmd.splitlines()[0]
                        if TEST_CMD.search(cmd) or ACTION_CMD.search(cmd) or INSPECT_CMD.search(cmd):
                            cur["commands"].append(head)
    return turns


def build_rows(turns):
    rows = []
    for tn in turns:
        if not (tn["edits"] or tn["commands"]):  # 의미있는 턴만
            continue
        edits = list(dict.fromkeys(tn["edits"]))
        cmds = list(dict.fromkeys(tn["commands"]))
        kind = classify(edits, cmds)
        summary = cell(tn["text"].splitlines()[0] if tn["text"] else "", 120)
        if not summary:
            summary = "(요약 없음)"
        rows.append(f"| {tn['at']} | {kind} | {summary} | {evidence(edits, cmds)} |")
    return rows


def insert_rows(doc_path, rows):
    """마커 바로 앞에 삽입. 마커가 없으면 아무것도 하지 않는다(EOF 맹목 append 금지)."""
    text = read(doc_path)
    if text is None or MARKER not in text:
        return 0
    head, sep, tail = text.partition(MARKER)
    existing = head.rstrip("\n").splitlines()
    fresh = []
    for r in rows:
        if existing and existing[-1].strip() == r.strip():  # 같은 행 연속 중복 방지
            continue
        existing.append(r)
        fresh.append(r)
    if not fresh:
        return 0
    new_text = "\n".join(existing) + "\n" + sep + tail
    try:
        with open(doc_path, "w", encoding="utf-8") as f:
            f.write(new_text)
    except Exception:
        return 0
    return len(fresh)


def main():
    state = load_active()
    if not state:
        return  # 무장되지 않음 — 평소 세션에서는 여기서 끝

    if expired(state.get("armed_at")):
        disarm()
        return

    doc = state.get("doc")
    if not doc or not os.path.exists(doc):
        return

    data = json.load(sys.stdin)
    session = data.get("session_id") or "unknown"
    bound = state.get("session_id")
    if bound is None:
        state["session_id"] = bound = session
    if bound != session:
        return  # 다른 세션이 같은 문서를 오염시키지 않도록

    transcript = data.get("transcript_path")
    if not transcript or not os.path.exists(transcript):
        return

    with open(transcript, encoding="utf-8") as f:
        lines = f.readlines()

    cursor = int(state.get("cursor", 0) or 0)
    if cursor > len(lines):  # transcript가 줄어들면(드묾) 안전하게 리셋
        cursor = 0

    rows = build_rows(collect_turns(lines[cursor:]))
    state["cursor"] = len(lines)  # 스킵 여부와 무관하게 갱신(중복/재처리 방지)

    if rows:
        added = insert_rows(doc, rows)
        state["rows"] = int(state.get("rows", 0) or 0) + added

    save_active(state)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
