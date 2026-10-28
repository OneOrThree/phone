# dev Business API 공개 경로 장애 기록

## 현상과 확인

2026-09-23 TestFlight의 게스트 로그인과 게시판 요청이 공개 dev 호스트에서 Data API의 `RESOURCE_NOT_FOUND` 404를 받았다. 당시 호스트 Nginx의 기본 `location /`은 `127.0.0.1:8080`의 Data API로 향했고, Business 공개 경로 설정은 적용되지 않았다.

임시로 Nginx에 `/auth/sessions`, `/screens` 등의 Business 분기를 추가한 뒤 2026-09-24 확인한 결과, 인증 헤더가 없는 `POST /auth/sessions/guest`는 Business의 400, `GET /screens/board`는 Business의 401을 반환했다. 다만 임시 분기의 upstream은 Business 컨테이너의 당시 IP `172.19.0.4:8080`이었다. 컨테이너가 재생성되면 IP가 달라질 수 있으므로 이 상태를 완료로 판단하지 않았다.

## 영구 배선

`docker-compose.satellites.dev.yml`에서 Business API의 컨테이너 포트 8080을 호스트 `127.0.0.1:8083`에만 바인드한다. `Satellite Dev CD`는 이 dev 전용 오버레이를 항상 포함한다. 호스트 Nginx의 Business upstream을 `127.0.0.1:8083`으로 설정한다. 다른 외부 인터페이스와 prod 위성 구성에는 이 포트를 열지 않는다.

Nginx 설정을 바꿀 때는 기존 서버 블록과 TLS 설정을 보존한다. 기존 공개 경로 정본인 `server/scripts/nginx-satellites.include.conf.example`을 참조하고, 먼저 `sudo nginx -t`를 통과시킨 뒤 `sudo systemctl reload nginx`를 실행한다. 이 작업 이후 Business 컨테이너를 재생성해도 호스트 포트는 유지된다.

## 검증

1. `docker compose ... -f docker-compose.satellites.dev.yml config`에서 Business 포트의 `host_ip=127.0.0.1`, `published=8083`을 확인한다.
2. `ss -ltnp`에서 `127.0.0.1:8083`만 열렸는지 확인한다.
3. 공개 HTTPS `POST /auth/sessions/guest`에 `X-Device-Id`가 없으면 Business의 `400 INVALID_REQUEST`, 유효한 UUID를 보내면 `201` 세션 응답을 확인한다. 실제 세션 생성은 명시적 테스트 계정으로만 실행한다.
4. 공개 HTTPS `GET /screens/board`의 무인증 응답이 Business의 `401 UNAUTHORIZED`인지 확인한다.
5. Business 컨테이너 재생성 후 3~4를 반복하고, `/api/v1` 및 `/health`의 기존 Data 연결을 확인한다. 이 Data 공개 경로는 후속 2.0 전환에서 별도로 닫는다.

## 복구

Nginx 변경 전 파일을 호스트에 백업한다. `nginx -t` 또는 공개 경로 검증이 실패하면 백업을 복원하고 `sudo nginx -t && sudo systemctl reload nginx`로 되돌린다. Compose 포트 바인드 실패 시 Business 컨테이너 로그와 `ss -ltnp`를 확인하고, 이전 이미지 digest와 기존 env 파일로 Business만 재기동한다. 이 절차에서 PostgreSQL 컨테이너와 볼륨은 변경하지 않는다.
