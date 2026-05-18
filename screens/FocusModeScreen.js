import React, { useRef, useState, useMemo, Suspense } from 'react';
import { View, Text, StyleSheet, Pressable, PixelRatio } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { Canvas } from '@react-three/fiber/native';
import { useGLTF, OrbitControls } from '@react-three/drei/native';
import { Asset } from 'expo-asset';
import * as THREE from 'three';
import { useFocus } from '../contexts/FocusContext';
import { useEquipment } from '../contexts/EquipmentContext';

const DEFAULT_CHARACTER = require('../assets/character/character.glb');

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

function FocusCharacter({ characterModule }) {
  const asset = Asset.fromModule(characterModule);

  if (!asset.localUri && !asset.uri) {
    throw asset.downloadAsync();
  }

  const { scene } = useGLTF(asset.localUri || asset.uri);

  const safeScene = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) obj.material.needsUpdate = true;
      }
    });
    return cloned;
  }, [scene]);

  return <primitive object={safeScene} scale={1.1} position={[0, -0.3, 0]} />;
}

export default function FocusModeScreen({ navigation }) {
  const { todayFocusSeconds, addFocusSeconds } = useFocus();
  const { equippedItem } = useEquipment();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const startTimeRef = useRef(null);

  const characterModule = equippedItem?.focusCharacterModel ?? DEFAULT_CHARACTER;

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

      <View style={styles.characterArea}>
        <Canvas
          style={styles.canvas}
          camera={{ position: [0, 1, 2.2], fov: 45 }}
          gl={{ antialias: true }}
          shadows
          onCreated={({ gl }) => {
            gl.setClearColor('#1a1a1a');
            gl.setPixelRatio(PixelRatio.get());
          }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 8, 5]} intensity={1.5} castShadow />
          <directionalLight position={[-4, 3, -3]} intensity={0.5} />
          <pointLight position={[0, 5, 2]} intensity={0.4} />

          <Suspense fallback={null}>
            <FocusCharacter characterModule={characterModule} />
          </Suspense>

          <OrbitControls enablePan={false} enableZoom={false} />
        </Canvas>
      </View>

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
  characterArea: {
    width: '100%',
    height: 220,
    marginTop: 24,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  canvas: {
    flex: 1,
  },
  accumulatedBox: {
    marginTop: 24,
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
    marginTop: 24,
  },
  stopButtonText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '700',
  },
});
