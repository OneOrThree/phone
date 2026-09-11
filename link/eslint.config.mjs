import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // 내부 API 는 외부 입력을 unknown 으로 받아 좁혀 쓰는 코드가 많다 — any 만 금지한다.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          // 링크 서버는 코어(Data/Business)를 부르지 않는다 — 단방향 규칙(정본 §3).
          selector:
            "CallExpression[callee.name='fetch'] > Literal.arguments[value=/oneorthree|data-api|business-api/]",
          message: '링크 서버는 코어를 호출하지 않는다 (정본 service-architecture §3 단방향 규칙).',
        },
      ],
    },
  },
];

export default config;
