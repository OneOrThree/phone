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
