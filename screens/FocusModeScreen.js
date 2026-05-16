import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocus } from '../contexts/FocusContext';

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
}

export default function FocusModeScreen({ navigation }) {
  const { todayFocusSeconds, addFocusSeconds } = useFocus();

  const [displaySeconds, setDisplaySeconds] = useState(todayFocusSeconds);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();

    const timerId = setInterval(() => {
      const currentSessionSeconds = Math.floor(
        (Date.now() - startTimeRef.current) / 1000
      );

      setDisplaySeconds(todayFocusSeconds + currentSessionSeconds);
    }, 1000);

    return () => {
      clearInterval(timerId);
    };
  }, [todayFocusSeconds]);

  function handleStop() {
    const currentSessionSeconds = Math.floor(
      (Date.now() - startTimeRef.current) / 1000
    );

    addFocusSeconds(currentSessionSeconds);
    navigation.navigate('홈');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>포커스 모드</Text>

      <Text style={styles.timer}>{formatTime(displaySeconds)}</Text>

      <Text style={styles.description}>
        오늘 누적 집중 시간이 실시간으로 표시됩니다.
      </Text>

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
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  timer: {
    color: '#ffffff',
    fontSize: 56,
    fontWeight: '800',
    marginTop: 32,
  },
  description: {
    color: '#aaaaaa',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
  stopButton: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 48,
  },
  stopButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '700',
  },
});