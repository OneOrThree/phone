# 운영 Presence Redis ACL 회귀 시험

`presence-production.acl`은 cattus-infra의 `prod/catus/runtime/env.py`가 생성하는
Presence Redis ACL에 2416의 movement·Sea 키와 TIME 보정을 적용한 계약이다.
비밀번호는 테스트 전용 합성 값이며 운영 자격 증명을 읽지 않는다.

- Data 비밀번호: `acl-test-data-password`
- Realtime 비밀번호: `acl-test-realtime-password`
- Redis 이미지: 운영 compose와 같은 `redis:7.4.11-alpine`
- Phone 소스 기준: `4f3a3d96c204d57ba0a593ffb2caacdd7be7ef88`
- Infra 보정 전 기준: `020f02d717aff3e6d69787e1affed8a33fe76a95`
- Infra ACL 수정: [2a2958cfc159a27e0e130db05d1e64766cf03b91](https://github.com/OneOrThree/cattus-infra/commit/2a2958cfc159a27e0e130db05d1e64766cf03b91)
- 아래 SHA-256은 비밀번호 해시 토큰만 제외하고 각 user 행의 토큰을 한 칸으로 연결한
  문자열에 줄바꿈을 붙여 계산한다. 명령·키·채널 권한 변경 시 양쪽 계약을 함께 갱신한다.

`4154ffec178d66207d26377750e438313c3ddc100b6ab10f84e7c70465006a57`

Infra의 `PresenceRedisAclTest.test_Phone_통합시험_fixture가_운영생성_ACL과_동일하다`은
`PHONE_PRESENCE_ACL`에 이 파일 경로를 주면 생성 결과와 권한 토큰 전체를 대조한다.
Phone CI는 이 고정 fixture로 실제 제품 Lua·STOMP·탈퇴 처리기를 실행한다.
운영 배포 후 10명 FullState 지연과 outbox 재처리 확인은 별도 검증이다.
