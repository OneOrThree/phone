#!/bin/sh
# 로컬 Nginx 의 라우팅 생성 (GROMO-2216) — nginx 공식 이미지가 기동 때 /docker-entrypoint.d/*.sh 를 순서대로 실행한다.
#
# dev 공개 라우팅 정본(nginx-dev-2.0-routes.conf.example)을 «복제하지 않고» 그대로 읽어, upstream 두 곳만
# 호스트에서 도는 Business·Realtime 포트로 바꿔 server 블록에 넣는다. 정본이 바뀌면 로컬도 다음 기동부터 같이 바뀐다.
#
# dev 정본의 upstream 은 호스트 loopback(127.0.0.1:8083 · 127.0.0.1:8081)인데, 컨테이너 안에서 127.0.0.1 은
# 컨테이너 자신이라 호스트의 JVM 에 닿지 않는다. 그래서 compose 가 넘긴 LOCAL_*_UPSTREAM(host.docker.internal:포트)으로
# 치환한다. 치환 대상은 `proxy_pass http://127.0.0.1:<포트>;` 의 그 두 주소뿐이고(뒤의 `;` 까지 맞춰 8083 이
# 80831 같은 긴 문자열의 앞부분으로 잡히지 않게 한다) location·헤더 정리·404 규칙은 손대지 않는다.
set -eu

me=nginx-local-routes.sh
fail() { echo "$me: $*" >&2; exit 1; }

: "${LOCAL_BUSINESS_UPSTREAM:?compose 가 LOCAL_BUSINESS_UPSTREAM 을 넘겨야 한다}"
: "${LOCAL_REALTIME_UPSTREAM:?compose 가 LOCAL_REALTIME_UPSTREAM 을 넘겨야 한다}"

# upstream 은 host:port 모양만 받는다. `&`·`|` 같은 문자가 들어오면 sed 치환식이 뜻을 바꾸거나(`&` 는 매치 전체로
# 바뀐다) 깨진 설정이 nginx 파싱 단계까지 흘러가므로 여기서 멈춘다.
for v in "$LOCAL_BUSINESS_UPSTREAM" "$LOCAL_REALTIME_UPSTREAM"; do
  case $v in
    *[!A-Za-z0-9._:-]*|'') fail "upstream 값은 host:port 모양이어야 한다 — '$v'" ;;
  esac
done

# 호스트 이름은 IPv4 주소로 풀어 넣는다. host.docker.internal 은 IPv4·IPv6 둘로 풀리는데, nginx 가 IPv6 를 먼저 골라
# 연결에 실패하면 GET 은 다음 주소로 재시도하지만 POST 는 비멱등이라 재시도하지 않아 그대로 502 가 된다
# (proxy_next_upstream 기본값). 로그인 POST /auth/sessions 가 간헐적으로 502 나는 것으로 실측했다(2026-10-07).
ipv4() {
  host=${1%:*}
  addr=$(getent ahostsv4 "$host" | awk 'NR==1{print $1}')
  [ -n "$addr" ] || fail "upstream 호스트 '$host' 의 IPv4 주소를 찾지 못했다"
  echo "$addr:${1##*:}"
}
LOCAL_BUSINESS_UPSTREAM=$(ipv4 "$LOCAL_BUSINESS_UPSTREAM")
LOCAL_REALTIME_UPSTREAM=$(ipv4 "$LOCAL_REALTIME_UPSTREAM")

src=/etc/nginx/gromo/routes.conf.example
[ -r "$src" ] || fail "정본 $src 를 읽을 수 없다 — compose 의 volumes 마운트를 확인한다"

out=/etc/nginx/conf.d/default.conf
{
  echo '# 생성 파일 — nginx-local-routes.sh 가 nginx-dev-2.0-routes.conf.example 에서 만든다. 직접 고치지 않는다.'
  echo 'server {'
  echo '    listen 80;'
  sed -e "s|127\.0\.0\.1:8083;|${LOCAL_BUSINESS_UPSTREAM};|g" \
      -e "s|127\.0\.0\.1:8081;|${LOCAL_REALTIME_UPSTREAM};|g" \
      "$src"
  echo '}'
} > "$out"

# 정본에 새 loopback upstream 이 생기면 치환에서 조용히 빠져 그 경로만 502 가 된다. 기동을 실패시켜 바로 드러낸다.
if grep -q 'proxy_pass http://127\.0\.0\.1:' "$out"; then
  grep -n 'proxy_pass http://127\.0\.0\.1:' "$out" >&2
  fail "치환되지 않은 loopback upstream 이 남았다 — 정본이 바뀌었으면 이 스크립트의 치환 목록을 늘린다"
fi
