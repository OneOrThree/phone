import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { useFocus } from '../contexts/FocusContext';

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}

export default function FocusModeScreen({ navigation }) {
  const { todayFocusSeconds, addFocusSeconds } = useFocus();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const startTimeRef = useRef(null);

  useFocusEffect(
    React.useCallback(() => {
      startTimeRef.current = Date.now();
      setSessionSeconds(0);

      const timerId = setInterval(() => {
        setSessionSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      return () => clearInterval(timerId);
    }, [])
  );

  function handleStop() {
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    addFocusSeconds(elapsed);
    navigation.navigate('홈');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>포커스 모드</Text>

      <Text style={styles.sessionTimer}>{formatTime(sessionSeconds)}</Text>
      <Text style={styles.sessionLabel}>현재 세션</Text>

      <View style={styles.accumulatedBox}>
        <Text style={styles.accumulatedLabel}>오늘 누적</Text>
        <Text style={styles.accumulatedTime}>{formatTime(todayFocusSeconds + sessionSeconds)}</Text>
      </View>

      <Pressable style={styles.stopButton} onPress={handleStop}>
        <Text style={styles.stopButtonText}>중지하기</Text>
      </Pressable>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: '#aaaaaa',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  sessionTimer: {
    color: '#ffffff',
    fontSize: 64,
    fontWeight: '800',
    marginTop: 24,
  },
  sessionLabel: {
    color: '#aaaaaa',
    fontSize: 13,
    marginTop: 8,
  },
  accumulatedBox: {
    marginTop: 40,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 20,
    backgroundColor: '#242424',
    width: '100%',
  },
  accumulatedLabel: {
    color: '#aaaaaa',
    fontSize: 13,
  },
  accumulatedTime: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 6,
  },
  stopButton: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#ff6b6b',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 48,
  },
  stopButtonText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '700',
  },
});
