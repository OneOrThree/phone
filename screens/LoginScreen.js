import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { T } from '../components/theme';

export default function LoginScreen({ onLogin }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>otium</Text>
      <TouchableOpacity onPress={onLogin} style={styles.kakaoButton} activeOpacity={0.8}>
        <Image
          source={require('../assets/kakao_login_medium_narrow.png')}
          style={styles.kakaoImage}
          resizeMode="contain"
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 160,
    paddingBottom: 80,
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    color: T.ink,
    letterSpacing: 4,
  },
  kakaoButton: {
    width: 280,
  },
  kakaoImage: {
    width: '100%',
    height: 54,
  },
});
