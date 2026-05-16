import React, {
  Suspense,
  useRef,
  useMemo,
  useEffect,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Canvas } from '@react-three/fiber/native';
import { useGLTF, OrbitControls } from '@react-three/drei/native';
import { Asset } from 'expo-asset';
import * as THREE from 'three';
import { useEquipment } from '../contexts/EquipmentContext';
import { useFocus } from '../contexts/FocusContext';

const CHARACTER_MODULE = require('../assets/character/character.glb');

function Character(props) {
  const asset = Asset.fromModule(CHARACTER_MODULE);

  if (!asset.localUri && !asset.uri) {
    throw asset.downloadAsync();
  }

  const { scene } = useGLTF(asset.localUri || asset.uri);
  const ref = useRef();

  const safeScene = useMemo(() => {
    const cloned = scene.clone(true);

    cloned.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;

        if (!object.material) {
          object.material = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.6,
            metalness: 0.1,
          });
        }

        object.material.needsUpdate = true;
      }
    });

    return cloned;
  }, [scene]);

  return <primitive ref={ref} object={safeScene} {...props} />;
}

function EquippedItem({ item, ...props }) {
  if (!item || !item.model) {
    return null;
  }

  return <EquippedItemModel model={item.model} {...props} />;
}

function EquippedItemModel({ model, ...props }) {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadAsset() {
      if (!model) return;

      const asset = Asset.fromModule(model);
      await asset.downloadAsync();

      const nextUri = asset.localUri || asset.uri;

      if (mounted && nextUri) {
        setUri(nextUri);
      }
    }

    loadAsset();

    return () => {
      mounted = false;
    };
  }, [model]);

  if (!uri) {
    return null;
  }

  return <LoadedEquippedItem uri={uri} {...props} />;
}

function LoadedEquippedItem({ uri, ...props }) {
  const { scene } = useGLTF(uri);

  const safeScene = useMemo(() => {
    const cloned = scene.clone(true);

    cloned.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;

        object.material = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          roughness: 0.6,
          metalness: 0.1,
        });

        object.material.needsUpdate = true;
      }
    });

    return cloned;
  }, [scene]);

  return <primitive object={safeScene} {...props} />;
}

function Room() {
  return (
    <group position={[0, -1, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>

      <mesh position={[0, 1, -2]}>
        <planeGeometry args={[4, 2]} />
        <meshStandardMaterial color="#f1eadf" />
      </mesh>

      <mesh rotation={[0, -Math.PI / 2, 0]} position={[2, 1, 0]}>
        <planeGeometry args={[4, 2]} />
        <meshStandardMaterial color="#f7f1e8" />
      </mesh>

      <mesh position={[0, 0.04, -2]}>
        <boxGeometry args={[4.1, 0.08, 0.08]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[2, 0.04, 0]}>
        <boxGeometry args={[0.08, 0.08, 4.1]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[0, 0.04, 2]}>
        <boxGeometry args={[4.1, 0.08, 0.08]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[-2, 0.04, 0]}>
        <boxGeometry args={[0.08, 0.08, 4.1]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[-2, 1, -2]}>
        <boxGeometry args={[0.08, 2.1, 0.08]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[2, 1, -2]}>
        <boxGeometry args={[0.08, 2.1, 0.08]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[2, 1, 2]}>
        <boxGeometry args={[0.08, 2.1, 0.08]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[0, 2.04, -2]}>
        <boxGeometry args={[4.1, 0.08, 0.08]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>

      <mesh position={[2, 2.04, 0]}>
        <boxGeometry args={[0.08, 0.08, 4.1]} />
        <meshStandardMaterial color="#6f6f6f" />
      </mesh>
    </group>
  );
}

function Loader() {
  return (
    <View style={styles.loader} pointerEvents="none">
      <ActivityIndicator size="large" color="#ffffff" />
      <Text style={styles.loaderText}>캐릭터 로딩 중…</Text>
    </View>
  );
}

function formatFocusTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  if (minutes > 0) {
    return `${minutes}분 ${seconds}초`;
  }

  return `${seconds}초`;
}

export default function HomeScreen({ navigation }) {
  const { equippedItem } = useEquipment();
  const { todayFocusSeconds } = useFocus();

  const goalPhoneTime = '3시간';
  const currentPhoneTime = '1시간 20분';
  const remainingPhoneTime = '1시간 40분';

  return (
    <View style={styles.container}>
      <View style={styles.topArea}>
        <View style={styles.usageRow}>
          <View style={styles.usageBox}>
            <Text style={styles.usageLabel}>목표 핸드폰 사용 시간</Text>
            <Text style={styles.usageValue}>{goalPhoneTime}</Text>
          </View>

          <View style={styles.usageBox}>
            <Text style={styles.usageLabel}>현재 사용 시간</Text>
            <Text style={styles.usageValue}>{currentPhoneTime}</Text>
          </View>

          <View style={styles.usageBox}>
            <Text style={styles.usageLabel}>남은 시간</Text>
            <Text style={styles.usageValue}>{remainingPhoneTime}</Text>
          </View>
        </View>
      </View>

      <View style={styles.canvasArea}>
        <Canvas
          style={styles.canvas}
          camera={{ position: [3, 2.2, 4], fov: 45 }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.setClearColor('#1a1a1a');
          }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 5, 5]} intensity={1.3} />
          <directionalLight position={[-5, 3, -5]} intensity={0.6} />

          <Suspense fallback={null}>
            <Room />

            <Character
              scale={0.8}
              position={[0, -0.5, 0]}
            />

            {equippedItem?.type === 'furniture' && (
              <EquippedItem
                item={equippedItem}
                scale={0.45}
                position={[0.9, -0.75, 0.4]}
                rotation={[0, -0.6, 0]}
              />
            )}
          </Suspense>

          <OrbitControls
            enablePan={false}
            enableZoom={true}
            minDistance={3}
            maxDistance={8}
          />
        </Canvas>

        <Suspense fallback={<Loader />}>
          <View />
        </Suspense>
      </View>

      <View style={styles.bottomArea}>
        <View>
          <Text style={styles.bottomTitle}>오늘의 집중</Text>
          <Text style={styles.focusTimeText}>
            {formatFocusTime(todayFocusSeconds)}
          </Text>

          {equippedItem && (
            <Text style={styles.equippedText}>
              장착 아이템: {equippedItem.name}
            </Text>
          )}
        </View>

        <Pressable
          style={styles.focusStartButton}
          onPress={() => navigation.navigate('FocusMode')}
        >
          <Text style={styles.focusStartButtonText}>집중 시작하기</Text>
        </Pressable>
      </View>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },

  topArea: {
    flex: 1,
    paddingTop: 48,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },

  usageRow: {
    flexDirection: 'row',
    gap: 8,
  },

  usageBox: {
    flex: 1,
    minHeight: 76,
    borderRadius: 16,
    backgroundColor: '#242424',
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  usageLabel: {
    color: '#aaaaaa',
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
  },

  usageValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },

  canvasArea: {
    flex: 3,
    marginHorizontal: 16,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },

  canvas: {
    flex: 1,
  },

  bottomArea: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    backgroundColor: '#242424',
  },

  bottomTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },

  focusTimeText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
  },

  focusStartButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },

  focusStartButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },

  equippedText: {
    color: '#7CFF8A',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },

  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loaderText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 14,
  },
});