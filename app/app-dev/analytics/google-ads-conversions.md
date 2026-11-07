# Google Ads 첫 섬 도착 전환

앱의 첫 항해가 계정의 최초 섬 도착일 때 Google CPA 전환 후보를 보낸다. Meta의 `first_island_arrival`과 같은 서버 판정을 사용한다.

| 구간         | 이벤트·판정                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Data API     | `intro-arrivals` 실행 전 도착 이력이 없으면 `firstArrivalEventId`가 있는 응답. 멱등 receipt에 함께 저장한다. 일반 도착에는 사건 ID가 없다. |
| Business API | 최초 판정을 앱으로 전달한다. 구 Data 응답의 누락·null은 전환으로 처리하지 않는다.                                                          |
| 앱           | 성공 응답의 사건 ID가 있을 때만 처리한다. 운영 release 빌드에서 계정·세션이 그대로인 경우에만 발행한다.                                    |
| Airbridge    | `airbridge.completeTutorial`, action=`first_island_arrival`. Core 플랜의 표준 이벤트를 첫 항해 완료 전용으로 쓴다.                         |
| Google Ads   | Airbridge 매핑 화면에 표시되는 이벤트를 전환으로 사용한다. 전환 표시 이름은 `first_island_arrival`로 구분한다.                             |

`airbridge.unlockAchievement`는 기존 집중 완료 이벤트다. 첫 섬 도착 목표에 섞지 않는다. `completeTutorial`을 다른 안내 종료·스킵에 재사용하지 않는다.

## 적용 순서

1. 기존 서버가 `firstArrivalEventId`를 반환하는 버전인지 확인하고 앱 변경을 배포한다. 이 PR은 서버를 변경하지 않으며 별도 서버 배포를 요구하지 않는다. 새 네이티브 의존성은 없다. 기존 Airbridge SDK가 포함된 바이너리가 필요하다. 구 서버에서는 전환을 보내지 않는다.
2. Google Ads의 도구 → 데이터 관리자 → 타사 앱 분석에서 Airbridge의 iOS 연결 ID를 확인한다. 대상은 `com.oneorthree.gromo`, App Store ID `6774498679`다. Android는 플랫폼별 별도 연결 ID를 사용한다.
3. Airbridge의 연동 → 광고 채널 연동 → Google Ads에 해당 플랫폼 연결 ID를 등록한다. 기존 연결이 맞으면 재사용한다.
4. 인앱 이벤트 포스트백에서 `Complete Tutorial (App)`을 추가하고 Google 이벤트 매핑을 저장한다. 실제 매핑 이름을 기록한다. 비프리셋 매핑에는 `abr_` 접두사가 붙을 수 있으므로 `first_island_arrival`이라는 원시 이름만 검색하지 않는다.
5. 배포 후 실제 신규 사용자의 첫 도착 이벤트 수신을 확인한다. 실패·기존 계정의 재설치·같은 도착 재시도로 이벤트를 임의 생성하지 않는다.
6. Google Ads 목표 → 전환 → 요약에서 같은 앱·플랫폼의 해당 전환이 생성됐는지 확인한다. 없으면 앱 → 타사 앱 분석에서 가져온다. 연결 후 수집된 이벤트가 표시되기까지 최대 6시간이 걸릴 수 있다.
7. 해당 캠페인의 인앱 액션 최적화 목표로 이 전환을 선택한다. 설치·집중 완료 이벤트를 첫 도착 전환으로 잘못 선택하지 않는다. 실제 캠페인 게시·예산 변경은 별도 작업이다.

## 보장 범위와 검증 상태

서버 최초 판정은 재설치·새 요청 키에도 기존 도착을 신규로 분류하지 않는다. 앱은 계정별 AsyncStorage 표지와 직렬 처리로 동일 receipt의 동시 응답·재시도 중복을 억제한다. 개발·목업·SDK 미포함 바이너리는 전환을 발행하지 않는다.

SDK 호출 성공은 Google 수신 확인이 아니다. SDK 호출과 로컬 표지 저장 사이에 앱 종료·저장 실패가 발생하면 중복 가능성이 있고, 응답을 받기 전에 앱이 영구 이탈하면 누락될 수 있다. 종단 간 exactly-once 전송이나 Meta 서버 CAPI와 같은 전달 보장은 하지 않는다. 로컬 표지 읽기 실패 또는 로그인 사용자 식별자 부재 시에는 전환을 건너뛰므로 누락될 수 있다. 기존 사용자 전환을 소급 생성하지 않는다.

이 변경은 기존 서버 최초 판정·receipt 재생 계약을 재사용한다. 최종 앱 변경의 관련 Jest 58개와 타입 검사가 통과했으며, 중복 억제·계정 전환·환경 제한 및 기존 PostHog 동작을 검증했다. Google Ads/Airbridge 콘솔 설정, 운영 배포, 실제 이벤트 수신은 별도 검증이 필요하다. 이 문서 작성 시 해당 설정은 적용하지 않았다.

공식 근거: [Airbridge Google Ads 연동](https://help.airbridge.io/en/guides/google-ads), [캠페인 최적화](https://help.airbridge.io/en/guides/google-ads-aap-for-engagement), [표준 이벤트](https://help.airbridge.io/en/guides/airbridge-event-types).
