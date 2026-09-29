# dev 2.0 공개 라우팅 전환 (GROMO-2115)

`gromo-dev-app`의 호스트 Nginx는 TLS를 종료하고 공개 요청을 Business API와 Realtime으로만 전달한다. Data API는 내부 계약 호출과 로컬 CD 헬스 검사에만 사용한다. PostgreSQL 컨테이너와 `phone_postgres_dev_data` 볼륨은 이 전환에서 건드리지 않는다.

## 선행 확인

1. GROMO-2114 Data API CD가 성공하고 `phone-data-api`가 healthy인지 확인한다. `docker inspect phone-db --format '{{.Id}}'`의 결과를 전후에 비교한다.
2. Business API가 `127.0.0.1:8083`, Realtime이 `127.0.0.1:8081`, Data API가 `127.0.0.1:8080`에서 응답하는지 확인한다. Realtime CD는 `docker-compose.realtime.yml`의 loopback 바인드를 적용해야 한다.
3. `python3 -m unittest discover -s .github/scripts -p 'test_dev_public_ingress.py' -v`를 통과시킨다.

## 호스트 Nginx 적용

리포지토리의 `server/scripts/nginx-dev-2.0-routes.conf.example`이 공개 경로 정본이다. 이를 서버의 `/etc/nginx/snippets/gromo-dev-2.0-routes.conf`에 복사한다. `/etc/nginx/sites-enabled/gromo-dev-app`의 **HTTPS 서버 블록 안에 있는** 기존 Business 정규식 `location`과 Data로 프록시하는 기본 `location /`을 제거하고, 그 자리에 `include /etc/nginx/snippets/gromo-dev-2.0-routes.conf;`를 둔다. 기존 `listen`, 인증서, HTTP→HTTPS 리다이렉트는 유지한다. 백업은 `sites-enabled` 바깥에 둔다. 그 디렉터리 안에 백업을 두면 Nginx가 둘 다 읽어 중복 `listen` 오류가 난다.

적용 전 `sudo nginx -t`를 실행하고 통과했을 때만 `sudo systemctl reload nginx`를 실행한다. `/auth/sessions/guest`·`/screens/board`는 Business, `/ws/realtime`은 Realtime, `/health`는 Business로 연결되어야 한다. `/internal/`, `/actuator/`, 옛 Data API 기본 경로는 404여야 한다. 인증이 필요한 Business 경로는 인증 없이 401일 수 있다. 유효한 UUID로 게스트 세션을 생성하면 201이어야 한다. 응답의 토큰은 로그에 남기지 않는다.

## 되돌리기

Nginx 검증이 실패하면 백업한 사이트 파일을 복원하고 `sudo nginx -t && sudo systemctl reload nginx`를 실행한다. Realtime 바인드 변경만 문제라면 이전 이미지와 Compose 정의로 Realtime만 재생성한다. Data API와 PostgreSQL은 변경하지 않는다. 공개 경로 검증 결과와 DB 컨테이너 ID를 GROMO-2115에 남긴다.
