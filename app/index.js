import { registerRootComponent } from 'expo';
import { initializeKakaoSDK } from '@react-native-kakao/core';
import App from './App';

initializeKakaoSDK('af3ff0c5b4fb9cd38b78428b88add65d');

registerRootComponent(App);
