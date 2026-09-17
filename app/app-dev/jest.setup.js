/* eslint-env jest */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(() => ({
    replace: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    volume: 1,
    loop: false,
  })),
}));
