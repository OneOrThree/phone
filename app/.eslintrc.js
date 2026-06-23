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
