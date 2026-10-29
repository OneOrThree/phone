# 이미지 팩 발행

Node.js 24 이상과 AWS CLI v2를 사용한다. 추가 npm 의존성은 없다. 초기 팩은 `interior-hall/background`이며 원본 번들 참조를 유지한다.

```sh
node --test scripts/assets-cdn/*.test.mjs
node scripts/assets-cdn/build.mjs local-v1
node scripts/assets-cdn/serve.mjs local-v1
```

로컬 서버는 `127.0.0.1:4301`에서 `channels/dev/1.json`, 불변 manifest와 PNG를 제공한다. 포트는 `PORT`로 바꾼다. 실제 기기 연결용 공개 서버가 아니다. 산출물은 `dist/assets-cdn/`이며 커밋하지 않는다. 같은 releaseId로 다른 내용의 빌드를 덮어쓰면 실패한다. 원본 PNG는 변환·축소하지 않고 signature/IHDR, 크기, 해상도를 검사한다. 실제 이미지 디코드 검증은 기기 검증에 남는다.

팩 정의는 `packs/*.json`에 `{ "packId": "...", "files": { "assetId": "저장소 상대 PNG 경로" } }` 형태로 작성한다. 원본 symlink가 저장소를 벗어나면 거부한다. 정렬된 키의 UTF-8 JSON에 줄바꿈을 붙이지 않으며 pack version은 files의 정규 JSON SHA-256이다.

## 수동 발행과 롤백

GitHub `이미지 CDN` workflow의 main 수동 실행만 클라우드에 쓴다. PR/main push는 테스트와 빌드만 한다. `image-assets-dev` / `image-assets-prod` GitHub environment에 다음 변수를 설정한다. 환경 승인 규칙과 OIDC trust는 인프라에서 설정해야 한다.

- `ASSET_BUCKET`: 전용 비공개 S3 버킷
- `ASSET_CDN_URL`: 경로 없는 HTTPS CDN origin
- `AWS_REGION`: 버킷 리전
- `ASSET_PUBLISH_ROLE_ARN`: 해당 환경만 발행하는 OIDC 역할

장기 AWS 키는 사용하지 않는다. workflow는 환경별 채널을 직렬화한다. 발행기는 최초 S3 채널 GET의 ETag를 보관하고, PNG→manifest를 `If-None-Match: *`로 업로드한다. 이미 존재하면 실제 바이트와 Content-Type/Cache-Control이 같은지 확인한다. CDN에서 모든 파일과 manifest를 GET하여 해시·크기·헤더를 검증한 뒤 채널만 최초 ETag의 `If-Match`로 변경한다. 최초 채널은 `If-None-Match: *`다. CAS 충돌을 새 ETag로 자동 재시도하지 않는다.

`rollback`은 기존 releaseId의 S3 manifest와 CDN 파일을 다시 검증하고 generation을 증가시켜 이전 릴리스를 가리킨다. 원본 객체를 지우거나 덮어쓰지 않는다. CDN 오류나 CAS 실패 시 현재 채널은 유지되지만 업로드된 미참조 불변 객체는 남을 수 있다. 자동 GC는 하지 않는다.

CLI 직접 실행은 동일한 `ASSET_ENVIRONMENT`, `ASSET_BUCKET`, `ASSET_CDN_URL`과 AWS 인증이 필요하다.

```sh
node scripts/assets-cdn/publish.mjs release-id
node scripts/assets-cdn/publish.mjs previous-release-id --rollback
```

검증 완료 범위는 로컬 계약·실제 회관 빌드·localhost HTTP와 주입한 AWS runner 장애 테스트다. 실제 S3 직접 접근 차단, CloudFront hit/miss·TTL·오류 캐시, OIDC 권한과 실제 CAS 경합은 인프라 적용 후 별도 검증해야 한다.
