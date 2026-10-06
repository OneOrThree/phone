#!/bin/sh
# 로컬 Nginx 의 라우팅 생성 (GROMO-2216) — nginx 공식 이미지가 기동 때 /docker-entrypoint.d/*.sh 를 순서대로 실행한다.
#
# dev 공개 라우팅 정본(nginx-dev-2.0-routes.conf.example)을 «복제하지 않고» 그대로 읽어, upstream 두 곳만
# 호스트에서 도는 Business·Realtime 포트로 바꿔 server 블록에 넣는다. 정본이 바뀌면 로컬도 다음 기동부터 같이 바뀐다.
#
# dev 정본의 upstream 은 호스트 loopback(127.0.0.1:8083 · 127.0.0.1:8081)인데, 컨테이너 안에서 127.0.0.1 은
# 컨테이너 자신이라 호스트의 JVM 에 닿지 않는다. 그래서 compose 가 넘긴 LOCAL_*_UPSTREAM(host.docker.internal:포트)으로
# 치환한다. 치환 대상은 그 두 주소뿐이고 location·헤더 정리·404 규칙은 손대지 않는다.
set -eu

: "${LOCAL_BUSINESS_UPSTREAM:?compose 가 LOCAL_BUSINESS_UPSTREAM 을 넘겨야 한다}"
: "${LOCAL_REALTIME_UPSTREAM:?compose 가 LOCAL_REALTIME_UPSTREAM 을 넘겨야 한다}"

{
  echo '# 생성 파일 — nginx-local-routes.sh 가 nginx-dev-2.0-routes.conf.example 에서 만든다. 직접 고치지 않는다.'
  echo 'server {'
  echo '    listen 80;'
  sed -e "s|127\.0\.0\.1:8083|${LOCAL_BUSINESS_UPSTREAM}|g" \
      -e "s|127\.0\.0\.1:8081|${LOCAL_REALTIME_UPSTREAM}|g" \
      /etc/nginx/gromo/routes.conf.example
  echo '}'
} > /etc/nginx/conf.d/default.conf
