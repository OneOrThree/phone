# 이미지 CDN Low-level Design

상태: 구현 계약 초안. 정책 숫자는 [policy](policy.md)가 정본. 아래 경로는 새 구현의 예정 위치이며 존재/완료를 뜻하지 않는다.

## 1. 파일 배치

- 앱: `src/services/assets/{contracts,channelClient,repository,nativeAdapter,policy}.ts`, `src/hooks/useAssetPack.ts`.
- 원본/팩 목록: `assets-cdn/packs/*.json`. 번들 이전 원본은 `assets-cdn/source/`로 옮기고 Metro 그래프에서 제거한다. 아트 원본 자체는 삭제하지 않는다.
- 빌더/배포: `scripts/assets-cdn/{build,publish,verify}.mjs`, 산출물 `dist/assets-cdn/`(gitignore).
- 개발 정적 서버: 기존 serve-map-assets를 변경하지 않고 새 manifest 계약용 로컬 서버를 둔다.
- Infra: 이미지 전용 Terraform 모듈과 dev/prod 인스턴스. 기존 배포 artifact/log 버킷 재사용 금지.
- 네이티브: `modules/catus-asset-cache` 로컬 Expo 모듈(Kotlin/Swift). bounded download·스트리밍 SHA-256·디스크 flush를 제공하며 새 Android/iOS 바이너리가 필요하다. 기존 바이너리에는 CDN 기능을 켜는 OTA를 보내지 않는다.
- 시범 화면: `BuildingInteriors`의 회관 그림만 `useAssetPack('interior-hall')`로 연결. 다른 건물의 기능과 레이아웃은 그대로 유지.

## 2. 배포 계약

```ts
type Channel = {
  schemaVersion: 1;
  assetApiVersion: 1;
  generation: number; // positive safe integer
  releaseId: string;
  manifestPath: string; // releases/<releaseId>/manifest.json
  manifestSha256: string;
  manifestBytes: number;
};
type AssetFile = {
  path: string; // assets/<sha256>.png 또는 .json
  sha256: string; // lowercase 64 hex
  bytes: number;
  mediaType: "image/png" | "application/json";
  width?: number;
  height?: number; // PNG에 필수
};
type AssetPack = {
  version: string; // canonical pack payload의 SHA-256
  files: Record<string, AssetFile>; // assetId → 항목
};
type Manifest = {
  schemaVersion: 1;
  assetApiVersion: 1;
  releaseId: string;
  packs: Record<string, AssetPack>;
};
```

CI는 정렬된 키/UTF-8 JSON 직렬화로 재현 가능한 산출물을 만든다. manifest SHA는 실제 업로드한 raw bytes 기준이다. `pack.version`은 version 필드를 제외한 files 정규 직렬화의 digest다. 앱은 신뢰된 manifest의 digest/값을 검증한다. CDN 문자열을 객체 경로로 그대로 이어붙이지 않는다.

`packId`, `assetId`, `releaseId`는 제한된 ASCII 토큰/최대 길이 128. path는 정규식으로 지정된 구조만 허용하며 `..`, 절대 URL, query, fragment, percent-encoded slash를 거부한다. production base URL은 앱 빌드 설정 HTTPS allowlist로 고정한다. 테스트 환경의 localhost HTTP만 별도 주입한다. 응답 redirect 후 임의 호스트 신뢰를 확장하지 않는다.

다운로드 대상은 채널→해시 검증된 manifest→팩의 파일이다. 서버가 보낸 bytes를 무조건 신뢰하지 않고 progress/final size와 상한을 대조한다. JSON 메타는 허용 schema만 읽으며 코드를 실행하지 않는다. 초기 팩은 PNG만 사용하고 rig JSON은 별도 꾸미기 팩 검증기를 추가한 뒤 허용한다.

## 3. 기기 저장 모델

```text
Paths.cache/image-cdn/v1/
  indexes/<seq>.<digest>.json # 불변 검증 가능 snapshot, 최신/직전 정상본 유지
  objects/<sha256>.png
  objects/<sha256>.json
  staging/<jobId>/*.partial
```

논리 `index`(불변 snapshot payload): seq, schemaVersion, assetApiVersion, channels[environment]의 generation/ETag/lastSuccess/nextRetry/failureCount/검증된 manifest, packRecords[(packId,version)]의 files/adoptedAt/lastUsedAt/previousSince, activePacks[packId]의 version, badHashes 및 packFailures[(environment,assetApiVersion,packId,packVersion)]의 nextRetry/failureCount. index 크기와 새/이전 snapshot 동시 보존량도 예산에 포함한다. manifest가 커지면 immutable metadata file로 분리하되 이것도 참조/복구 계약에 포함한다.

공유 파일 bytes는 hash+mediaType로 한 번만 계산한다. 같은 bytes를 서로 다른 미디어 형식으로 선언하면 거부한다. 계정 ID/토큰은 index에 저장하지 않는다. 앱 코드 호환 세대가 바뀌면 채널 확인 시각·불량 목록의 namespace를 분리한다. 구세대 파일 삭제는 열린 lease가 없을 때만 허용한다.

## 4. 공개 API와 일관성

```ts
type PackLease = {
  id: string;
  packId: string;
  version: string;
  assets: Readonly<
    Record<
      string,
      | { mediaType: "image/png"; uri: string; width: number; height: number }
      | { mediaType: "application/json"; uri: string }
    >
  >;
  release(): void; // idempotent
};
type EnsureResult =
  | { status: "ready"; version: string }
  | {
      status: "deferred";
      reason: "offline" | "backoff" | "space" | "incompatible";
    }
  | {
      status: "failed";
      reason: "network" | "integrity" | "decode" | "storage";
    };
interface AssetRepository {
  initialize(): Promise<void>;
  acquirePack(packId: string): Promise<PackLease | null>;
  ensurePack(packId: string): Promise<EnsureResult>;
  onForeground(): Promise<void>;
  collect(): Promise<void>;
}
```

한 앱 프로세스의 singleton이다. index 변경·예산 예약·lease 획득·팩 승격·GC는 단일 async mutex/직렬 큐에서 수행한다. 네트워크/해시 작업은 큐 밖에서 하고 완료 시 다시 잠금 안에서 generation과 작업 소유권을 검사한다. 서로 다른 화면 ensure는 packId+version으로 합치며 파일 수신은 hash로 합친다. 한 소비자의 화면 종료가 다른 소비자가 기다리는 공유 다운로드를 취소하지 않는다.

`acquirePack`은 파일 존재/크기 확인과 pin을 같은 잠금 안에서 수행한다. 실제 사용 시 lastUsedAt을 갱신한다. hook cleanup은 idempotent release를 호출한다. 화면은 버전 포인터 대신 lease의 로컬 URI를 사용한다. 기존 lease는 ensure 완료로 바뀌지 않는다. 캐시 없던 첫 화면만 팩 준비 후 acquire하여 전체 교체한다.

## 5. 수신·검증·커밋

1. 저장된 호환 채널이 없거나 policy의 확인 기한/예외 조건을 만족하면 채널 조회. ETag는 환경+assetApiVersion 단위다.
2. 성공한 304도 lastSuccess를 갱신. 저장된 manifest가 없으면 조건 없는 요청 1회. 낮은 generation은 무시하고 같은 generation의 다른 digest는 계약 위반으로 거부한다.
3. 채널·manifest가 검증된 성공 확인과 팩 수신 실패 backoff는 별도다. 팩 실패 뒤 다음 백오프 만료 기회에는 6시간 이내라도 채널을 재확인해 롤백을 발견한다. 채널 실패는 공통 backoff, 팩 실패는 pack key backoff를 적용하며 둘 중 늦은 재시도 시각을 따른다. 채널 성공만으로 같은 팩의 실패 횟수를 초기화하지 않는다. 다른 packVersion이 발표되면 새 팩 실패 상태는 비어 있다.
   3-1. 채널 generation이 높아도 releaseId 감소는 허용한다(롤백). manifest의 releaseId/호환 버전이 채널과 같아야 한다.
4. 팩 파일 검증 후 누락 SHA만 계산. 전역 예산/여유 공간 확보와 예약을 잠금 안에서 수행. 기존 파일 삭제/이동 여부와 충돌하지 않도록 작업 pin 부여.
5. 로컬 Expo 모듈 `CatusAssetCache.downloadVerified`를 사용한다. 입력은 allowlist HTTPS URL, jobId, expectedBytes, expectedSha256, timeoutMs=60000. 네이티브가 cache root 내부의 고유 staging 경로를 생성한다. 호출자가 임의 파일 경로를 지정하지 않는다.
6. Kotlin/Swift 수신 루프에서 각 청크를 쓰기 **전에** 누적 bytes와 expectedBytes/예약 상한을 검사한다. 과대 Content-Length는 수신 전 거부하고, chunked 응답도 실제 bytes로 제한한다. 네이티브 타이머/네트워크 timeout으로 deadline을 검사하고 취소한다. Promise는 파일 핸들 종료·취소 완료 후에만 settle하며 JS 타이머에 제한 보장을 맡기지 않는다. 사용자가 다운로드한 콘텐츠는 모든 redirect를 거부하고 Accept-Encoding: identity를 사용한다.
7. 수신 청크마다 네이티브 incremental SHA-256을 갱신한다. EOF 뒤 실제 크기/해시가 manifest와 같아야 verified 결과를 반환한다. 실패 시 임시 파일 정리까지 결과에 포함하고 삭제 실패 bytes는 계속 디스크 사용으로 계산한다. JS에 원본 전체 bytes를 전달하지 않는다. 기존 sha256Hex 및 표준 fixture로 빈 파일/청크 경계/큰 PNG digest를 대조한다. 이 경로는 별도 네이티브 바이너리와 실기기 검증이 필요하다.
8. PNG signature/IHDR 해상도·면적 확인 후 실제 디코드 검증. RN 소비자는 이미지 디코드 probe, Skia 소비자는 Skia decode 검증 후 즉시 해제. 한 번에 하나의 디코드 probe를 실행한다. JSON은 전용 스키마 검증기를 적용한다.
9. 모든 객체가 검증되면 digest 경로로 rename. 동일 해시가 이미 준비됐으면 이를 재사용하고 임시 파일만 정리한다. 새 객체를 내구성 있게 flush한 뒤 metadata snapshot을 공개한다.
10. lock 안에서 전체 pack record와 activePacks를 담은 손상 파일을 포함한 최대 디스크 seq + 1 snapshot을 고유 파일에 쓴다. canonical payload의 SHA-256을 파일명에 넣고 파일을 닫아 flush한다. 기존 snapshot을 overwrite하지 않는다. 파일 내용을 다시 읽어 digest/schema를 검증한 뒤에만 메모리 상태를 채택한다. 파일명의 seq와 payload의 seq도 같아야 한다.
11. 부팅은 indexes의 후보를 seq 내림차순으로 검사하여 완전히 검증된 최신 snapshot을 선택한다. 중간에 잘린 파일은 digest 불일치로 무시하고 이전 snapshot을 사용한다. 프로세스 종료가 새 snapshot 검증 직전이면 부팅에서 정상 새 snapshot 또는 정상 이전 snapshot을 선택할 수 있다. 어느 경우에도 반쯤 받은 팩은 선택하지 않는다.
12. 최신/직전 정상 snapshot과 그 참조 객체를 함께 보존한다. 추가 snapshot 정리는 새 snapshot 완료 후 수행하며 디렉터리 조작을 중단해도 이전 정상 snapshot 하나 이상이 남는다. snapshot 쓰기/flush 실패 시 기존 snapshot을 손대지 않는다. 파일만 남은 경우 orphan으로 다음 GC에서 회수한다. 모든 종료 경로에서 native 완료 확인 후 예약/작업 pin을 해제한다.

Expo `File.move(..., overwrite=true)`의 삭제 후 이동을 원자 교체로 가정하지 않는다. 위 프로토콜은 체크섬과 이전 snapshot 보존으로 중단을 복구한다. 저장소 전체 손상/OS 캐시 회수는 별도 캐시 미스 복구이며 전원 상실 내구성까지 검증했다고 주장하지 않는다. 메타데이터의 flush·새 파일 공개는 네이티브 어댑터 책임이다.

## 6. 용량과 GC 알고리즘

`charged = committedObjectBytes + metadataBytes + actualStagingBytes + reservedRemainingBytes`.
예약 후 다운로드가 진행되면 실제 파일 bytes가 늘어난 만큼 remaining을 줄여 이중 계산을 피한다. 동일 SHA shared job은 예약도 한 번만 한다. OS 여유 공간 검사에는 이미 진행 중인 remaining을 포함한다. commit 시 파일 중복 복사를 피하고 rename한다.

GC는 policy 순서로 후보 팩 참조를 제거한 새 snapshot을 먼저 완성한다. 최신/직전 snapshot이 모두 해당 참조를 제거한 상태가 될 때까지 이전 snapshot을 순차 교체한 뒤, 두 snapshot/lease/job 어느 곳에서도 참조하지 않는 객체만 삭제한다. 이 GC checkpoint 과정이 중단되면 파일을 더 보존할 뿐, 복구 가능한 snapshot의 파일을 먼저 삭제하지 않는다. 삭제 실패 파일은 실제 bytes 집계에 남기고 재시도한다. 앱 종료로 orphan이 남아도 다음 부팅 스캔에서 실제 디스크 사용으로 계산한다. 후보 삭제와 lease 획득은 같은 잠금으로 배타 처리한다. 192MiB 도달 불가 시 256MiB 상한/여유 공간 조건을 만족하는 예약만 허용한다.

## 7. 부팅·오류·기능 플래그

모든 snapshot이 손상됐을 때만 번들 대체 표시로 시작하고 파일 스캔 후 새 index를 구성한다. 새 snapshot만 손상된 경우 직전 정상 snapshot의 팩을 오프라인에서 재사용한다. 메타 없이 해시 이름만 보고 팩을 활성화하지 않는다. 소유 작업 없는 staging을 제거하고, 기록된 객체가 사라지면 해당 팩을 미완료로 바꾼다. 그 뒤 채널과 manifest를 다시 받아 검증된 객체를 재활용한다.

`EXPO_PUBLIC_IMAGE_ASSETS_URL`이 비어 있으면 CDN 경로 비활성. rollout용 `EXPO_PUBLIC_IMAGE_ASSETS_ENABLED`를 빌드/OTA 공개 설정에 주입한다. 최초 시범에서는 네이티브 capability 확인 후에만 CDN을 활성화하고, 기존 원본 fallback으로 기능 비교하고, 번들 경량화 단계에서는 소형 fallback으로 교체한다. 원본이 빠진 바이너리에서 플래그 off는 소형 fallback을 뜻한다. 원본을 복구하려면 기존 앱/OTA 롤백 또는 CDN 정상 릴리스가 필요하다.

이 플래그는 개인정보 권한/세션/기기 캐시 폐기 정책을 조작하지 않는다. 일반 시작/복귀 채널 확인과 선택 팩 ensure만 실행하며 앱 시작을 네트워크 완료까지 막지 않는다.

## 8. 기존 꾸미기 경로 연결

`STATIC_ASSETS_BASE_URL`에 CDN origin을 넣어도 imageUrl 외 renderData.source.path/renderData.rigPath/renderData.colorRigPaths.*/renderData.commonBand.path가 같은 정적 origin으로 해석되는지 계약 테스트한다. `/static/customization/**` 파일 경로는 S3에 그대로 미러해 구 카탈로그와 호환한다. legacy 파일명의 짧은 해시를 신뢰하지 않고 실제 바이트의 전체 SHA-256을 담은 sidecar manifest를 생성한다.

sidecar는 catalog에 등장하는 정적 상대 경로→팩/전체 digest를 매핑한다. image+관련 rig+common band를 하나의 검증 묶음으로 처리한다. 기존 앱은 imageUrl 끝의 source.path로 정적 base를 복원한다. 새 lease 경로를 사용할 때 이 resolver를 로컬 URI와 섞지 않도록 sidecar의 원래 정적 경로와 resolved URI를 분리한다. 아직 매핑되지 않은 상품은 원래 URL 경로로 동작하며 새 캐시 보장을 주장하지 않는다. 앱 캐시는 업무 메타의 1시간 TTL·계정 범위·보유/장착 권한을 바꾸지 않는다. nginx 기존 경로 제거는 이 범위 밖이다.

## 9. 검증과 작업 분해

단위: validator 경로 탈출/숫자 한도, SHA 청크 경계, 304+로컬 손실, generation 경합/롤백, 중복 다운로드, 디스크 예산, 공유 참조, lease/GC, 6h/7d/30d와 시계 이동.
통합: 로컬 HTTP→실제 디스크→검증→index→회관 소비자, CI 업로드 실패/CAS 경쟁/롤백.
실환경: CDN S3 직접 접근 거부/GET hit·miss·TTL·오류 캐시, Android/iOS RN·Skia 실제 디코드/취소/강제 종료/저장 공간 부족. 전체 결과는 코드 SHA와 기기/환경을 같이 남긴다.

검증 번호와 티켓은 [implementation-plan](implementation-plan.md)에서 추적한다. SDK별 취소/디코드 probe 동작을 실측하기 전에는 네이티브 동작 검증을 완료 처리하지 않는다.

## 시범 구현 계약 보완

초기 pack은 `interior-hall/background`, source는 `src/assets/interiors/hall-cute-v1.png`이며 원본 번들 fallback을 유지한다. 초기 manifest는 PNG만 지원한다. JSON rig 확장은 별도 스키마 검증과 카탈로그 resolver가 포함된 후속 작업이다.

`getAssetCacheNative()`가 optional 모듈의 `apiVersion === 1`을 확인한다. Android 런타임은 `2.0.0-no-special-use-assets-v1`, iOS는 `2.0.0-push-meta-assets-v1`로 구분한다. 모듈이 없으면 번들 경로만 사용한다. `EXPO_PUBLIC_IMAGE_ASSETS_ENABLED=true`, HTTPS origin `EXPO_PUBLIC_IMAGE_ASSETS_URL`, 환경 `EXPO_PUBLIC_IMAGE_ASSETS_ENV=dev|prod`가 모두 유효해야 활성화한다.

채널은 16KiB, manifest는 1MiB, snapshot은 2MiB 상한이다. 네이티브 bounded metadata 수신에도 redirect 거부·identity encoding·timeout을 적용한다. 다운로드 origin allowlist는 원격 manifest가 아니라 빌드에 포함된 공개 CDN 설정에서 얻는다. 전체 캐시 256MiB 중 메타데이터 8MiB를 확보하고 이미지·staging·남은 예약 합계는 248MiB로 제한한다. 시범은 프로세스 중단 복구를 검증하며 전원 상실 내구성이나 실기기 디코드 성공을 로컬 테스트만으로 단정하지 않는다.
