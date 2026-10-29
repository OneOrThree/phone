# 설계 검토 기록

## 1차 독립 검토 — 2026-10-29

| 발견 | 근거 | 반영 결정 |
| --- | --- | --- |
| JS progress/abort로 엄격한 디스크 상한 보장 불가 | 설치된 Expo 57.0.6 Android 수신 루프가 write 후 이벤트 전달 | 별도 Expo native module에서 write 전 bytes 제한·deadline·streaming SHA 수행. 새 바이너리 필요 |
| overwrite move를 원자 교체로 가정하면 iOS에서 이전 index 유실 가능 | Expo iOS FileSystemPath overwrite 구현은 remove 후 move | seq+digest 불변 snapshot과 직전 정상본으로 복구, 기존 파일 덮어쓰기 제거 |
| 채널 성공과 팩 실패의 재시도 상태 혼재 | 6시간 채널 정책과 파일 실패 후 롤백 확인 사이 모호성 | 팩별 backoff 분리, 실패 후 다음 재시도 기회에 채널도 재확인 |
| commonBandPath는 실제 계약 이름 아님 | customizationCatalog의 renderData.commonBand.path | image/source/rig/colorRig/commonBand의 실제 경로 명시 |

검토 범위는 설계·소스·공식 문서이며 실제 native 동작/인프라 배포를 검증한 것은 아니다. 최초 보고서의 차단 항목을 위 결정으로 수정하고 재검토를 요청했다.

## 재검토 결과

같은 문서 세트 재검토에서 남은 설계 확정 차단 사유 없음. 4개 지적 해소. 이 결론은 설계·티켓 확정에 한정하며 네이티브 구현·실기기 성능·실제 배포 승인을 뜻하지 않는다.

## 시범 구현 검증 (2026-10-29)

- 발행기: 해시 경로·정규 JSON·S3 조건부 쓰기·CDN GET 무결성·롤백 구현. 숫자형 키 정렬과 상속 속성 이름을 처리하고 현재 이미지 빌드가 롤백을 막지 않게 보완했다. 로컬 Node 테스트 10개 통과.
- 인프라: 전용 환경별 S3/CloudFront OAC/OIDC와 독립 state 구성. Terraform mock 3개 및 모듈/dev/prod validate 통과. 실제 AWS plan/apply는 미실행.
- 네이티브: Android Expo wrapper 컴파일과 JUnit 8개, iOS simulator pod target 빌드와 Swift core 54개, optional wrapper Jest 3개 통과. 새 runtimeVersion으로 기존 바이너리와 구분한다.
- 앱 캐시: 최신 snapshot 손상·최대 seq·직전 정상 팩 fallback·용량 예약·7/30일·lease와 GC 경합·동일 버전 재확인·화면 오류와 복귀 경합을 검증한다. 기존 회관 원본 번들 fallback을 유지한다.
- 실제 TLS CDN, JS stall 중 취소, 기기 강제 종료/OS 캐시 회수, 설치 크기 비교는 미실행이다. 시범 팩 기기 검증 이후에만 꾸미기 rig 확대와 번들 제거 티켓을 진행한다.

독립 Spec 검토에서 실제 PNG 헤더의 사전 검사를 보완했다. Android/Swift `inspectPng`는 처음 33바이트만 읽어 signature·IHDR·실제 해상도를 검사하고, 앱은 manifest 해상도까지 일치해야 디코더를 호출한다. malformed/과대/치수 불일치 시 디코더 호출 0회를 확인했다. Standards/Spec 최종 검토는 추가 발견 사항 없이 통과했으며 자동 companion 재검토 1회는 모델 용량 부족으로 실패했음을 별도 기록했다.
