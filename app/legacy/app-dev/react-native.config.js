// RN 커뮤니티 라이브러리 오토링킹 설정.
module.exports = {
  dependencies: {
    // LINE 로그인(v4.1.0)은 안드로이드 네이티브 코드가 RN 0.86과 비호환(구 ActivityEventListener
    // 시그니처·currentActivity 참조)이라 컴파일이 깨짐. LINE은 현재 UI 미노출(602 검토 대기)이라
    // 안드로이드에서만 링크 제외 — iOS는 그대로. 노출 결정 시 라이브러리 업데이트 후 이 항목 삭제.
    '@xmartlabs/react-native-line': {
      platforms: { android: null },
    },
  },
};
