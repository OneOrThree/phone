# CatusAssetCache

SDK 57 로컬 Expo 모듈. 새 네이티브 바이너리가 필요하며, `getAssetCacheNative()`가 `null`인 구 바이너리에서는 번들 이미지를 사용한다.

- `downloadVerified`: native cache/image-cdn/v1/staging 안에 제한 수신한다. 매 청크 쓰기 전 크기 검사, 60초 이하 네이티브 deadline, 증분 SHA-256, flush/close를 완료한다. 실패 파일 삭제가 실패하면 에러 메시지에 `remainingBytes`를 포함한다. 런타임은 실제 디스크 스캔으로 잔여 파일을 계속 집계해야 한다.
- `fetchMetadata`: 채널·manifest를 최대 1MiB, 10초 이내에서 메모리에 제한 수신한다. 호출자는 채널에 16KiB 한도를 준다. 200은 UTF-8 text, 304/4xx/5xx는 빈 text와 status를 반환한다. 선택적 `If-None-Match`만 추가한다.
- 둘 모두 신뢰된 빌드 설정에서 전달한 HTTPS origin만 허용하며 userinfo/query/fragment, 모든 redirect, identity 외 Content-Encoding을 거부한다. 허용 origin을 원격 manifest에서 만들면 안 된다.
- `cancelDownload`: writer 종료와 핸들 닫기·실패 정리가 완료될 때까지 기다린다.
- `publishObject`: root 내부 staging 파일을 다시 해시 검사하고 objects에 공개한다. 기존 정상 객체는 유지하고 손상 객체만 삭제 후 검증된 staging으로 복구한다. 열린 lease의 손상 객체 복구 보류는 런타임 책임이다.
- `writeSnapshot`: 최대 2MiB UTF-8, 양의 safe integer seq. `indexes/<seq>.<sha>.json`을 exclusive 생성하고 flush/close/해시 재검증한다. 기존 snapshot을 삭제하지 않는다. schema/seq 검증, 최신·직전 참조 보존과 GC는 런타임 책임이다.

오류 코드는 `E_INPUT`, `E_ORIGIN`, `E_PATH`, `E_BUSY`, `E_EXISTS`, `E_SIZE`, `E_ENCODING`, `E_INTEGRITY`, `E_TIMEOUT`, `E_CANCELLED`, `E_REDIRECT`, `E_HTTP_<status>`, `E_IO`이다. 파일 flush는 프로세스 종료 복구를 위한 것이며 전원 상실 내구성을 주장하지 않는다.

## 로컬 검증

모듈 디렉터리에서:

```sh
mkdir -p tests/.build
swiftc ios/AssetCacheStore.swift tests/AssetCacheStoreTests.swift -o tests/.build/swift-tests
tests/.build/swift-tests tests/.build
python3 tests/run-kotlin-tests.py
```

Swift 테스트는 macOS Foundation/CryptoKit와 URLProtocol을 사용한다. Kotlin 테스트는 로컬 Gradle 캐시의 Kotlin 2.2.0, OkHttp 4.9.2, JUnit 4.13.2를 사용한다. 테스트는 운영 수신/저장소 구현에 응답 경계만 주입한다. Android/iOS 모듈 타깃 컴파일과 앱 전체 링크/실행은 별도 검증이다. 실제 TLS 서버, JS stall 및 실기기 강제 종료 검증도 별도로 수행해야 한다.

앱 디렉터리에서 wrapper 검증:

```sh
npx jest --runInBand --roots modules/catus-asset-cache --testMatch '**/index.test.ts'
```

Android Expo wrapper와 JUnit 검증은 앱 `android/` 디렉터리에서 수행한다. CI에서도 로컬 캐시 helper 대신 이 task를 사용한다.

```sh
./gradlew :catus-asset-cache:compileDebugKotlin :catus-asset-cache:testDebugUnitTest --console=plain
```

iOS Expo wrapper 컴파일은 의존성 설치 후 앱 `ios/` 디렉터리에서 수행한다. `prebuild`는 필요하지 않다.

```sh
pod install
xcodebuild -project Pods/Pods.xcodeproj -target CatusAssetCache -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```
