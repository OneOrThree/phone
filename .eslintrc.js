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
  rules: {
    'react/no-unstable-nested-components': ['warn', { allowAsProps: true }],
  },
  ignorePatterns: ['android/', 'ios/'],
};
