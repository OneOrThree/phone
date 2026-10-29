-- GROMO-2555 — Fluent Bit Lua 필터 두 개.
--   select_container : 컨테이너의 compose 서비스·프로젝트 라벨을 config.v2.json 에서 읽어 허용 목록만 통과
--   finalize         : JSON 파싱 성공/실패 판정, Loki 라벨 값 정규화, 실패 줄 마스킹·크기 제한
--   nginx_host_select: dev 호스트 Nginx 파일 tail 의 레코드에 서비스(nginx)·원천(access|error)을 붙인다 (GROMO-2556)
--   canary           : Fluent Bit dummy 입력의 합성 레코드에 고유 log_id 등 공통 필드를 채운다 (GROMO-2556)
-- finalize 는 service=nginx 이면 nginx_finalize 로 넘긴다 — Docker 의 prod 컨테이너 Nginx 와 호스트 Nginx 가 같은 정제 경로를 쓴다.
--
-- 마스킹은 data-api MaskingConverter.mask 의 4규칙(민감 키=값 → 이메일 → 휴대폰 → 주민번호, 순서 고정)을
-- Lua 패턴으로 근사한 것이다. 한계: Lua 패턴은 교대(|)·{n,m}·(?i) 가 없어 키 목록을 풀어 쓰고, 문자 클래스가
-- ASCII 기준이다(한글 로컬 파트의 이메일 등은 Java 와 결과가 다를 수 있다). 앱이 이미 마스킹한 JSON 줄에는
-- 다시 적용하지 않는다(신뢰 경계: 앱이 provider 로 마스킹한 JSON 은 믿는다) — 이 마스킹은 JSON 이 아닌 줄
-- (parse_error)만을 위한 2차 그물이다. raw 줄은 «앱이 마스킹하지 못한 줄» 이라 Java 보다 키 목록을 넓혔다.
-- 성능: 이메일 패턴은 '@' 없는 긴 단어 열에서 O(n²) 라서 mask 전에 입력을 MESSAGE_LIMIT*2 로 먼저 자른다.

local ALLOWED = { ["data-api"] = true, ["business-api"] = true, ["notification"] = true, ["realtime"] = true, ["nginx"] = true }
local ENVS = { dev = true, staging = true, prod = true }
-- 새 log_kind 를 추가하면 여기도 같이 고친다 — 모르는 종류는 구조가 있어도 raw 로 간다.
local KINDS = { application = true, access = true }
local PROJECT = os.getenv("FLB_COMPOSE_PROJECT") or "phone"
local ROOT = os.getenv("FLB_CONTAINER_ROOT") or "/var/lib/docker/containers"
local DEFAULT_ENV = os.getenv("FLB_ENV") or "unknown"
local MESSAGE_LIMIT = 16384

-- 컨테이너 id → 서비스 이름 또는 false. id 는 바뀌지 않으므로 한 번 읽으면 계속 쓴다.
local cache, cache_size = {}, 0

local function service_of(id)
  local hit = cache[id]
  if hit ~= nil then return hit end
  local service = false
  local file = io.open(ROOT .. "/" .. id .. "/config.v2.json", "r")
  if file then
    local body = file:read("*a") or ""
    file:close()
    local s = body:match('"com%.docker%.compose%.service"%s*:%s*"([^"]*)"')
    local p = body:match('"com%.docker%.compose%.project"%s*:%s*"([^"]*)"')
    if s and ALLOWED[s] and p == PROJECT then service = s end
  end
  if cache_size >= 4096 then cache, cache_size = {}, 0 end
  cache[id] = service
  cache_size = cache_size + 1
  return service
end

function select_container(tag, ts, record)
  local path = record["filepath"]
  local id = path and path:match("/containers/(%x+)/")
  if not id then return -1, ts, record end
  local service = service_of(id)
  if not service then return -1, ts, record end
  record["_svc"] = service
  record["filepath"] = nil
  return 1, ts, record
end

-- 키 이름은 대소문자 무시로 일치시키려 문자별 클래스로 푼다.
local function ci(word)
  return (word:gsub("%a", function(c) return "[" .. c:lower() .. c:upper() .. "]" end))
end
local SENSITIVE = { "password", "accessToken", "access_token", "mobile", "email", "cardNumber", "card_number", "cvv", "secret",
  "token", "authorization", "apiKey", "api_key", "refreshToken", "refresh_token", "refresh" }
local SEPARATORS = { "%s*=%s*", '%s*"%s*:%s*"%s*', "%s*:%s*" }
local VALUE = '[^&"%s,}]+'
local BEARER = "[Bb][Ee][Aa][Rr][Ee][Rr]%s+"

local function mask(text)
  -- "Authorization: Bearer xxx" — 값 앞에 스킴 단어가 끼므로 먼저 따로 가린다.
  local lower = text:lower()
  if lower:find("bearer", 1, true) then
    text = text:gsub("(" .. BEARER .. ")[%w%-._~+/]+=*", "%1****")
  end
  for _, key in ipairs(SENSITIVE) do
    if lower:find(key:lower(), 1, true) then -- 키가 없으면 패턴 3개를 건너뛴다
      for _, sep in ipairs(SEPARATORS) do
        text = text:gsub("(" .. ci(key) .. sep .. ")" .. VALUE, "%1****")
      end
    end
  end
  if text:find("@", 1, true) then -- '@' 없는 긴 단어 열에서 이메일 패턴이 O(n²) 라 먼저 거른다
    text = text:gsub("([%w._%%+%-]+)@([%w.%-]+)%.(%a%a+)", function(local_part)
      return local_part:sub(1, 3) .. "****@****.***"
    end)
  end
  text = text:gsub("(01[016789])[%-.]?(%d%d%d%d?)[%-.]?(%d%d%d%d)", "%1-****-%3")
  text = text:gsub("(%d%d%d%d%d%d)%-(%d)(%d%d%d%d%d%d)", "%1-%2******")
  return text
end

-- UTF-8 문자 경계에서 자른다.
local function truncate(text, limit)
  if #text <= limit then return text, false end
  local cut = limit
  while cut > 0 do
    local byte = text:byte(cut + 1)
    if byte and byte >= 0x80 and byte < 0xC0 then cut = cut - 1 else break end
  end
  return text:sub(1, cut), true
end


-- ---------------------------------------------------------------------------------------------
-- GROMO-2556 — Nginx(access/error)·canary
-- ---------------------------------------------------------------------------------------------

-- 수집기가 부여하는 log_id (인프라 로그는 원천에 안정 커서가 없다). 재전송(retry)은 같은 청크라 같은 id 를 유지하지만,
-- 수집기가 같은 파일을 처음부터 다시 읽으면(tail DB 유실) 새 id 가 붙어 중복이 된다 — 알려진 한계.
local urandom = io.open("/dev/urandom", "rb")
do
  local seed = os.time() + math.floor(os.clock() * 1e6)
  if urandom then
    local b = urandom:read(4) or ""
    for i = 1, #b do seed = seed * 31 + b:byte(i) end
  end
  math.randomseed(seed)
end
local function random_hex(n)
  local out = {}
  local bytes = urandom and urandom:read(n) or nil
  for i = 1, n do
    out[i] = string.format("%02x", bytes and bytes:byte(i) or math.random(0, 255))
  end
  return table.concat(out)
end
local function uuid4()
  local h = random_hex(16)
  local variant = string.format("%x", 8 + tonumber(h:sub(17, 17), 16) % 4)
  return h:sub(1, 8) .. "-" .. h:sub(9, 12) .. "-4" .. h:sub(14, 16) .. "-" .. variant .. h:sub(18, 20) .. "-" .. h:sub(21, 32)
end

local function iso_ms(seconds)
  local sec = math.floor(seconds)
  return os.date("!%Y-%m-%dT%H:%M:%S", sec) .. string.format(".%03dZ", math.floor((seconds - sec) * 1000 + 0.5) % 1000)
end

local function valid_id(value, max)
  value = tostring(value or "")
  if value ~= "" and #value <= max and value:match("^[%w_%-%.:]+$") then return value end
  return nil
end

local function raw_record(line, stream)
  line = tostring(line or ""):gsub("[\r\n]+$", "")
  local original = #line
  local head = truncate(line, MESSAGE_LIMIT * 2)
  local message, cut = truncate(mask(head), MESSAGE_LIMIT)
  cut = cut or #head < original
  local out = { parse_error = true, log_kind = "raw", message = message, stream = stream, env = DEFAULT_ENV }
  if not ENVS[out["env"]] then out["env"] = "unknown" end
  if cut then
    out["truncated"] = true
    out["original_size_bytes"] = original
  end
  return out
end

-- 경로: query·fragment 제거, 토큰처럼 보이는 긴 글자 묶음([%w-_.~%] 로 이어진 글자, '/' 는 경계)은 아래 규칙으로 :redacted, 이메일·휴대폰은 mask 규칙.
--   1) 묶음 끝의 확장자(점 + 영숫자 1~5자)를 떼어 «stem» 으로 판정하고 확장자는 남긴다(main.<해시>.js -> :redacted.js).
--   2) stem 이 UUID 8-4-4-4-12 면 유지(/files/<uuid>.png 포함).
--   3) stem 길이 >= 20 이고 (숫자 포함 또는 대문자 포함 또는 구분자 - _ . 가 하나도 없음) 이면 :redacted. 소문자 kebab/snake 라우트(notification-preferences)는 유지.
-- 한계: ① 20자 미만 세그먼트(짧은 OTP·초대 코드)는 가리지 못한다. ② 구분자를 포함한 «소문자 전용» 20자 이상 비밀(예: abcd-efgh-ijkl-mnop-qrst)은
-- 라우트 이름과 구별되지 않아 가리지 못한다 — 경로에 비밀을 싣는 라우트는 앱에서 막아야 한다.
local UUID = "^" .. ("%x"):rep(8) .. "%-" .. ("%x"):rep(4) .. "%-" .. ("%x"):rep(4) .. "%-" .. ("%x"):rep(4) .. "%-" .. ("%x"):rep(12) .. "$"
local TOKEN_RUN = ("[%w%-_%.~%%]"):rep(20) .. "[%w%-_%.~%%]*"
local function redact_run(run)
  local stem, ext = run:match("^(.-)(%.%w%w?%w?%w?%w?)$")
  if not stem or stem == "" then stem, ext = run, "" end
  if run:match(UUID) or stem:match(UUID) or #stem < 20 then return run end
  if stem:find("%d") or stem:find("%u") or not stem:find("[%-_%.]") then return ":redacted" .. ext end
  return run
end
-- query·fragment 시작 위치: `?`·`#` 와 퍼센트 인코딩된 `%3F`·`%23`(대소문자 무관). `%253F` 는 «%25 + 3F» 라 걸리지 않는다.
local function query_pos(s)
  local p = s:find("[?#]")
  for _, pat in ipairs({ "%%3[Ff]", "%%23" }) do
    local q = s:find(pat)
    if q and (not p or q < p) then p = q end
  end
  return p
end
local function sanitize_path(uri)
  uri = tostring(uri or "")
  local cut = query_pos(uri)
  if cut then uri = uri:sub(1, cut - 1) end
  uri = uri:gsub("[%c]", "")
  uri = uri:gsub(TOKEN_RUN, redact_run)
  return (truncate(mask(uri), 512))
end

-- 줄 전체 백스톱: Nginx 는 요청 줄·헤더를 이스케이프 없이 error 로그에 쓰므로 따옴표 경계가 모호하다(`request: "GET /a"?q=S HTTP/1.1"`).
-- 따옴표와 무관하게 공백으로 나뉜 각 토큰에서 ?·# 뒤를 지우고(토큰 끝의 닫는 `"`·`,` 는 남긴다), '/' 가 든 토큰은 경로 토큰 규칙을 적용한다(스킴://호스트는 건드리지 않는다).
-- upstream URL 의 userinfo(`user:pass@`)는 '@' 째로 지운다. base 는 `스킴://권한부` 라 마지막 '@' 까지가 userinfo 다.
-- '@' 를 남기면 뒤따르는 mask() 의 이메일 규칙이 도메인 호스트를 가리므로 표식 없이 지운다.
local function redact_userinfo(base)
  return (base:gsub("^(.-://).*@", "%1"))
end
local function backstop(text)
  return (text:gsub("%S+", function(tok)
    local pos = query_pos(tok)
    if pos then tok = tok:sub(1, pos - 1) .. tok:sub(pos):match("[\",]*$") end
    if tok:find("/", 1, true) then
      local head, path = tok:match("^(.-://[^/]*)(.*)$")
      if not head then head, path = "", tok end
      tok = redact_userinfo(head) .. path:gsub(TOKEN_RUN, redact_run)
    end
    return tok
  end))
end

-- URL: 스킴·호스트는 보존하고 경로만 sanitize_path(query 제거 + 토큰 세그먼트 치환)에 넘긴다.
local function sanitize_url(u)
  local base, path = u:match("^(%a[%w+.-]*://[^/?#]*)(.*)$")
  if base then return redact_userinfo(base) .. sanitize_path(path) end
  return sanitize_path(u)
end

-- combined: ip ident user [time] "METHOD URI PROTO" status bytes "referer" "agent"
local COMBINED = '^(%S+) %S+ %S+ %[([^%]]*)%] "(%S+) (%S+) ([^"]*)" (%d+) (%S+) "[^"]*" "[^"]*"'

-- [dd/Mon/yyyy:HH:MM:SS +zzzz] -> epoch 초(UTC). 실패하면 nil.
local MONTHS = { Jan = 1, Feb = 2, Mar = 3, Apr = 4, May = 5, Jun = 6, Jul = 7, Aug = 8, Sep = 9, Oct = 10, Nov = 11, Dec = 12 }
local function combined_time(t)
  local d, mon, y, h, mi, s, sign, oh, om = tostring(t or ""):match("^(%d+)/(%a+)/(%d+):(%d+):(%d+):(%d+) ([+-])(%d%d)(%d%d)$")
  mon = MONTHS[mon or ""]
  if not mon then return nil end
  y, d = tonumber(y), tonumber(d)
  -- days-from-civil (Howard Hinnant): os.time 은 로컬 시간대를 타서 쓰지 않는다.
  local yy = mon <= 2 and y - 1 or y
  local era = math.floor(yy / 400)
  local yoe = yy - era * 400
  local doy = math.floor((153 * (mon + (mon > 2 and -3 or 9)) + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  local days = era * 146097 + doe - 719468
  local off = (tonumber(oh) * 3600 + tonumber(om) * 60) * (sign == "-" and -1 or 1)
  return days * 86400 + tonumber(h) * 3600 + tonumber(mi) * 60 + tonumber(s) - off
end

-- combined 파싱에 실패한 access 줄(예: 요청 줄이 "-" 인 400)도 IP·user·referer·query 정책을 지킨다.
local function access_fallback(line)
  local n = 0
  line = line:gsub("^%S+ %S+ %S+ ", "**** - - ", 1)  -- client IP·ident·remote_user
  line = line:gsub('"([^"]*)"', function(q)
    n = n + 1
    if n > 1 then return '"-"' end  -- referer·user-agent
    -- 메서드 대소문자·유무와 무관하게 공백으로 나눈 모든 토큰에서 query·fragment 를 지운다.
    return '"' .. q:gsub("%S+", sanitize_path) .. '"'
  end)
  if select(2, line:gsub('"', "")) % 2 == 1 then line = line:gsub('"[^"]*$', '"-') end  -- 잘려 닫히지 않은 따옴표
  return backstop(line)
end

local function nginx_access(record, line, stream, ts)
  local method, path, status, bytes, duration, edge, upstream_id, connection, connection_requests
  local seconds
  if record["status"] ~= nil and record["method"] ~= nil then
    -- 우리 JSON log_format (server/scripts/nginx-log-format.conf.example)
    method, path, status = record["method"], record["uri"], tonumber(record["status"])
    bytes = tonumber(record["bytes_sent"])
    duration = tonumber(record["request_time"])
    edge = valid_id(record["edge_request_id"], 64)
    upstream_id = valid_id(record["upstream_request_id"], 128)
    connection, connection_requests = tonumber(record["connection"]), tonumber(record["connection_requests"])
    seconds = tonumber(record["msec"])
  else
    -- 기본 combined 형식 줄: client IP·identd·user 는 버리고 query 는 경로 정제에서 제거. referer/user-agent 는 읽지 않는다.
    local _, t, m, u, _, st, b = line:match(COMBINED)
    method, path, status, bytes = m, u, tonumber(st), tonumber(b)
    seconds = combined_time(t)
  end
  -- 시각: JSON msec > combined 원본 시각 > Fluent Bit 이벤트 시각(Read_From_Head·backlog 때 수집 시각으로 덮이지 않게).
  seconds = seconds or (type(ts) == "number" and ts or nil)
  if not (method and status) then return nil end
  method = tostring(method):upper():gsub("[^A-Z]", ""):sub(1, 16)
  local out = {
    schema_version = 1, log_id = uuid4(), log_kind = "access",
    timestamp = iso_ms(seconds or os.time()), logger = "nginx.access",
    http_method = method, http_path = sanitize_path(path), status_code = status,
    level = (status >= 500 and "ERROR") or (status >= 400 and "WARN") or "INFO",
    env = DEFAULT_ENV, stream = stream,
  }
  if bytes then out["bytes_sent"] = bytes end
  if duration then out["duration_ms"] = math.floor(duration * 1000 + 0.5) end
  out["edge_request_id"] = edge
  out["request_id"] = upstream_id
  out["connection"] = connection
  out["connection_requests"] = connection_requests
  if record["upstream_status"] ~= nil and record["upstream_status"] ~= "" then out["upstream_status"] = tostring(record["upstream_status"]):sub(1, 64) end
  if record["upstream_response_time"] ~= nil and record["upstream_response_time"] ~= "" then out["upstream_response_time"] = tostring(record["upstream_response_time"]):sub(1, 64) end
  out["message"] = out["http_method"] .. " " .. out["http_path"] .. " " .. tostring(status)
  return out
end

local NGINX_ERROR = "^(%d%d%d%d)/(%d%d)/(%d%d) (%d%d):(%d%d):(%d%d) %[(%a+)%] (%d+)#(%d+): (.*)$"
local ERROR_LEVELS = { emerg = "ERROR", alert = "ERROR", crit = "ERROR", error = "ERROR", warn = "WARN", notice = "INFO", info = "INFO", debug = "DEBUG" }

local function nginx_error(line, stream)
  local y, mo, d, h, mi, s, level, pid, _, rest = line:match(NGINX_ERROR)
  if not y then return nil end
  local connection
  local conn, after = rest:match("^%*(%d+) (.*)$")
  if conn then connection, rest = tonumber(conn), after end
  -- 요청 줄·upstream·referrer·client 에는 query/토큰/IP 가 들어갈 수 있다.
  -- referrer 는 Nginx 가 이스케이프 없이 줄 끝에 `, referrer: "<값>"` 으로 붙인다(ngx_http_request.c, 항상 마지막 필드).
  -- 값 안에 따옴표가 있어도 되므로 `, referrer: "` 지점부터 줄 끝까지를 통째로 버린다. 다른 규칙보다 먼저 적용한다.
  local ref = rest:find(', referrer: "', 1, true)
  if ref then rest = rest:sub(1, ref - 1) .. ', referrer: "-"' end
  rest = rest:gsub('request: "(%S+) ([^" ]+)([^"]*)"', function(m, u, p) return 'request: "' .. m .. " " .. sanitize_path(u) .. p .. '"' end)  -- 프로토콜이 없는 HTTP/0.9 도
  rest = rest:gsub('upstream: "([^"]*)"', function(u) return 'upstream: "' .. sanitize_url(u) .. '"' end)
  rest = rest:gsub("client: [^,%s]+", "client: ****")
  -- auth_basic: user "<이름>" was not found in "…" / user "<이름>": password mismatch. host:·server: 는 호스트 이름이라 둔다.
  rest = rest:gsub('%f[%w]user "[^"]*"', 'user ":redacted"')
  -- open() "/경로" failed, directory index of "/경로" 처럼 따옴표로 감싼 파일 경로에도 요청 경로가 그대로 들어간다.
  rest = rest:gsub('"(/[^"]*)"', function(p) return '"' .. sanitize_path(p) .. '"' end)
  -- Nginx 는 error 한 줄을 약 2 KiB(NGX_MAX_ERROR_STR)에서 자른다. 그러면 마지막 따옴표 값이 닫히지 않아 위 규칙이 모두 비껴간다.
  -- 따옴표 수가 홀수면 마지막 따옴표 뒤(줄 끝까지)를 정제한다: upstream 은 URL 규칙, 그 밖(request: "GET /…,
  -- open() "/… 뒤에 Nginx 가 붙인 «... (2: No such file …), client: …» 포함)은 query 제거 + 경로 정제.
  local before, tail = rest:match('^(.*")([^"]*)$')
  if before and select(2, rest:gsub('"', '')) % 2 == 1 then
    if before:sub(-11) == 'upstream: "' then tail = sanitize_url(tail)
    else tail = sanitize_path(tail) end
    rest = before .. tail
  end
  rest = backstop(rest)  -- 최종 단계: 위 필드별 규칙이 따옴표 모호성으로 놓친 query·fragment·토큰
  local message, cut = truncate(mask((truncate(rest, MESSAGE_LIMIT * 2))), MESSAGE_LIMIT)
  local out = {
    schema_version = 1, log_id = uuid4(), log_kind = "infrastructure",
    -- ponytail: error.log 시각은 서버 로컬 시간이다. UTC 로 간주한다(dev VM 시간대는 미확인 — runbook).
    timestamp = string.format("%s-%s-%sT%s:%s:%s.000Z", y, mo, d, h, mi, s),
    level = ERROR_LEVELS[level] or "INFO", logger = "nginx.error", message = message,
    env = DEFAULT_ENV, stream = stream, nginx_pid = tonumber(pid), connection = connection,
  }
  if cut then out["truncated"] = true end
  return out
end

local function nginx_finalize(record, ts)
  local src = record["_src"]
  if not src then src = (record["stream"] == "stderr") and "error" or "access" end
  record["_src"] = nil
  local line = tostring(record["log"] or ""):gsub("[\r\n]+$", "")
  local head = truncate(line, MESSAGE_LIMIT * 2)  -- 패턴 매칭·마스킹 전에 먼저 자른다(긴 줄 O(n²) 방지)
  local out
  if src == "access" then out = nginx_access(record, head, record["stream"], ts) else out = nginx_error(head, record["stream"]) end
  if not out and src == "access" and record["status"] == nil then
    out = raw_record(access_fallback(head), record["stream"])
    out["logger"] = "nginx.access"
    if type(ts) == "number" then out["timestamp"] = iso_ms(ts) end
  end
  if not out then out = raw_record(line, record["stream"]) end
  if not ENVS[out["env"]] then out["env"] = "unknown" end
  out["service"] = "nginx"
  out["observed_at"] = os.date("!%Y-%m-%dT%H:%M:%SZ")
  return 1, ts, out
end

function nginx_host_select(tag, ts, record)
  local path = tostring(record["filepath"] or "")
  record["_svc"] = "nginx"
  record["_src"] = path:match("access") and "access" or "error"
  record["filepath"] = nil
  return 1, ts, record
end

-- canary_seq 는 수집기 프로세스마다 1 부터 다시 센다. canary_boot(프로세스마다 새 무작위 값)로 묶으면 빠진 번호 = 어느 sink 에도 안 온 canary.
local canary_seq, CANARY_BOOT = 0, random_hex(4)
function canary(tag, ts, record)
  canary_seq = canary_seq + 1
  local now = type(ts) == "number" and ts or os.time()
  local out = {
    schema_version = 1, log_id = uuid4(), log_kind = "application", timestamp = iso_ms(now),
    level = "INFO", logger = "fluent-bit.canary", thread = "canary", message = "canary",
    service = "canary", env = DEFAULT_ENV, canary_seq = canary_seq, canary_boot = CANARY_BOOT,
    observed_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
  }
  if not ENVS[out["env"]] then out["env"] = "unknown" end
  return 1, ts, out
end

function finalize(tag, ts, record)
  local service = record["_svc"]
  record["_svc"] = nil
  if service == "nginx" then return nginx_finalize(record, ts) end
  local out
  if record["schema_version"] ~= nil and KINDS[record["log_kind"]] then
    -- 앱이 만든 JSON: 필드를 그대로 두고 원문 키와 Docker 의 stream 만 걷어낸다.
    record["log"] = nil
    record["stream"] = nil
    out = record
    if not ENVS[out["env"]] then out["env"] = "unknown" end
  else
    -- JSON 이 아니거나 우리 스키마가 아닌 줄: 버리지 않고 마스킹·크기 제한 뒤 raw 로 보관한다.
    out = raw_record(record["log"], record["stream"])
  end
  -- 서비스는 컨테이너 라벨이 정한다(로그 내용이 라벨 값을 바꾸지 못한다).
  out["service"] = service
  if out["observed_at"] == nil then out["observed_at"] = os.date("!%Y-%m-%dT%H:%M:%SZ") end
  return 1, ts, out
end
