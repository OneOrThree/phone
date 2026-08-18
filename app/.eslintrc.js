module.exports = {
  root: true,
  extends: ['@react-native/eslint-config'],
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
    babelOptions: {
      configFile: false,
      babelrc: false,
      plugins: ['@babel/plugin-syntax-jsx'],
    },
  },
  globals: {
    atob: 'readonly',
  },
  rules: {
    'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
    // 워클릿 안에서 모션 토큰 객체(M)를 읽는 것을 막는다 (GROMO-1601).
    // 워클릿의 클로저 캡처는 **식별자 단위**라 `M.never` 하나만 읽어도 `M` 전체가 UI 런타임으로
    // 복사되고, 그 안의 `M.curve.*.fn`(= Easing.bezier() 결과 = 클래스 인스턴스)에서
    // "[Worklets] Cannot copy value of type `CubicBezierEasing`"으로 죽는다.
    // 값만 모듈 스코프 상수로 꺼내 참조할 것 — 실물: constants/motion.ts `STANDARD_POINTS`,
    // screens/league/rankSwap.ts, components/ConfettiBurst.tsx `REDUCE_NEVER`.
    'no-restricted-syntax': [
      'error',
      {
        // useAnimatedStyle·useAnimatedReaction 등의 콜백은 'worklet' 지시어가 없어도
        // babel 플러그인이 워클릿으로 만든다 — 호출 자체를 훑는다.
        selector:
          "CallExpression[callee.name=/^use(AnimatedStyle|AnimatedReaction|AnimatedProps|DerivedValue|FrameCallback)$/] MemberExpression[object.name='M']",
        message:
          '워클릿 안에서 M.…을 읽지 마세요 — M 전체가 UI 런타임으로 복사되며 CubicBezierEasing에서 죽습니다(GROMO-1601). 값을 모듈 스코프 상수로 꺼내 쓰세요.',
      },
      {
        selector:
          ":function:has(> BlockStatement > ExpressionStatement > Literal[value='worklet']) MemberExpression[object.name='M']",
        message:
          '워클릿 안에서 M.…을 읽지 마세요 — M 전체가 UI 런타임으로 복사되며 CubicBezierEasing에서 죽습니다(GROMO-1601). 값을 모듈 스코프 상수로 꺼내 쓰세요.',
      },
    ],
  },
  overrides: [
    {
      // TS 파일은 @typescript-eslint 파서 사용 (@react-native/eslint-config가 의존성으로 번들)
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        requireConfigFile: false,
      },
    },
  ],
  ignorePatterns: ['android/', 'ios/'],
};
