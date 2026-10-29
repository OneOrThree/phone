-- GROMO-2555 — Fluent Bit Lua 필터 두 개.
--   select_container : 컨테이너의 compose 서비스·프로젝트 라벨을 config.v2.json 에서 읽어 허용 목록만 통과
--   finalize         : JSON 파싱 성공/실패 판정, Loki 라벨 값 정규화, 실패 줄 마스킹·크기 제한
--
-- 마스킹은 data-api MaskingConverter.mask 의 4규칙(민감 키=값 → 이메일 → 휴대폰 → 주민번호, 순서 고정)을
-- Lua 패턴으로 근사한 것이다. 한계: Lua 패턴은 교대(|)·{n,m}·(?i) 가 없어 키 목록을 풀어 쓰고, 문자 클래스가
-- ASCII 기준이다(한글 로컬 파트의 이메일 등은 Java 와 결과가 다를 수 있다). 앱이 이미 마스킹한 JSON 줄에는
-- 다시 적용하지 않는다(신뢰 경계: 앱이 provider 로 마스킹한 JSON 은 믿는다) — 이 마스킹은 JSON 이 아닌 줄
-- (parse_error)만을 위한 2차 그물이다. raw 줄은 «앱이 마스킹하지 못한 줄» 이라 Java 보다 키 목록을 넓혔다.
-- 성능: 이메일 패턴은 '@' 없는 긴 단어 열에서 O(n²) 라서 mask 전에 입력을 MESSAGE_LIMIT*2 로 먼저 자른다.

local ALLOWED = { ["data-api"] = true, ["business-api"] = true, ["notification"] = true, ["realtime"] = true }
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
  text = text:gsub("(" .. BEARER .. ")[%w%-._~+/]+=*", "%1****")
  for _, key in ipairs(SENSITIVE) do
    for _, sep in ipairs(SEPARATORS) do
      text = text:gsub("(" .. ci(key) .. sep .. ")" .. VALUE, "%1****")
    end
  end
  text = text:gsub("([%w._%%+%-]+)@([%w.%-]+)%.(%a%a+)", function(local_part)
    return local_part:sub(1, 3) .. "****@****.***"
  end)
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

function finalize(tag, ts, record)
  local service = record["_svc"]
  record["_svc"] = nil
  local out
  if record["schema_version"] ~= nil and KINDS[record["log_kind"]] then
    -- 앱이 만든 JSON: 필드를 그대로 두고 원문 키와 Docker 의 stream 만 걷어낸다.
    record["log"] = nil
    record["stream"] = nil
    out = record
    if not ENVS[out["env"]] then out["env"] = "unknown" end
  else
    -- JSON 이 아니거나 우리 스키마가 아닌 줄: 버리지 않고 마스킹·크기 제한 뒤 raw 로 보관한다.
    local line = tostring(record["log"] or ""):gsub("[\r\n]+$", "")
    local original = #line
    local head = truncate(line, MESSAGE_LIMIT * 2)
    local message, cut = truncate(mask(head), MESSAGE_LIMIT)
    cut = cut or #head < original
    out = { parse_error = true, log_kind = "raw", message = message, stream = record["stream"], env = DEFAULT_ENV }
    if not ENVS[out["env"]] then out["env"] = "unknown" end
    if cut then
      out["truncated"] = true
      out["original_size_bytes"] = original
    end
  end
  -- 서비스는 컨테이너 라벨이 정한다(로그 내용이 라벨 값을 바꾸지 못한다).
  out["service"] = service
  if out["observed_at"] == nil then out["observed_at"] = os.date("!%Y-%m-%dT%H:%M:%SZ") end
  return 1, ts, out
end
