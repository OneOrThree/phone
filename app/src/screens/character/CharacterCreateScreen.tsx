import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { ObjectCharacter } from '@/screens/character/ObjectCharacter';
import {
  cutoutSubject,
  isSubjectMaskSupported,
  saveCustomCharacter,
  subjectMaskReasonLabel,
  type SubjectMaskResult,
} from '@/services/subjectMask';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { T } from '@/constants/theme';

// 사진에서 캐릭터 만들기 화면 — 앨범/카메라로 사물 사진을 얻으면 온디바이스 누끼(Vision) 후
// 만화 팔·다리·눈을 붙여 "내 물건이 공부하는" 모습을 만든다. "저장"하면 합성된 미리보기를
// 그대로 캡처(captureRef)해 팔다리·눈까지 구워진 투명 PNG로 기기에 영구 저장하고 그 경로를
// onComplete로 돌려준다 — 라우트 래퍼(CharacterCreateRoute)가 이 경로를 CharacterContext의
// 커스텀 캐릭터로 저장한다. onComplete 미지정이면 저장 후 이전 화면으로 돌아간다.

const STAGE_HEIGHT = 340; // 캐릭터가 서는 무대 높이
const DESK_EMOJI = ['📚', '☕️', '✏️'];

type Phase = 'idle' | 'working' | 'ready' | 'saving';

interface Props {
  // 저장 완료 시 만들어진 커스텀 캐릭터의 file:// 경로를 넘긴다.
  // 미지정이면(네비게이션으로 바로 열린 경우) 저장 후 이전 화면으로 돌아간다.
  onComplete?: (uri: string) => void;
}

export default function CharacterCreateScreen({ onComplete }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<never>>();
  const { width } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SubjectMaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 합성 미리보기를 감싸는 컨테이너 — 저장 시 이 View를 통째로 캡처해 PNG로 굽는다.
  const captureViewRef = useRef<View>(null);

  const supported = useMemo(() => isSubjectMaskSupported(), []);
  const stageWidth = width - T.space.xl * 2 - T.space.xl;

  // 얻은 사진(앨범/카메라 공통)을 같은 누끼 흐름에 태운다.
  const runCutout = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setPhase('working');
    const cut = await cutoutSubject(asset.uri, {
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    });
    setResult(cut);
    setError(cut.cutout ? null : subjectMaskReasonLabel(cut.reason));
    setPhase('ready');
  }, []);

  // 앨범에서 고르기
  const pick = useCallback(async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: false,
    }).catch(() => null);

    if (!picked || picked.canceled || !picked.assets?.length) return;
    await runCutout(picked.assets[0]);
  }, [runCutout]);

  // 카메라로 찍기 — 권한을 먼저 요청하고, 거부되면 해요체로 안내한다.
  const takePhoto = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('카메라 권한이 필요해요. 설정에서 카메라 접근을 허용해 주세요.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    }).catch(() => null);

    if (!shot || shot.canceled || !shot.assets?.length) return;
    await runCutout(shot.assets[0]);
  }, [runCutout]);

  // 시계방향 90도 회전 — 현재 물체 PNG를 90도 돌려 다시 굽는다(탭할 때마다 90도씩 누적).
  // 90도 회전은 가로·세로가 뒤바뀌므로 결과 크기를 그대로 받아 aspect를 갱신한다.
  const rotate = useCallback(async () => {
    if (!result) return;
    try {
      const context = ImageManipulator.manipulate(result.uri);
      context.rotate(90);
      const image = await context.renderAsync();
      const out = await image.saveAsync({ format: SaveFormat.PNG });
      setResult((prev) =>
        prev ? { ...prev, uri: out.uri, width: out.width, height: out.height } : prev,
      );
    } catch {
      setError('사진을 돌리지 못했어요. 다시 시도해 주세요.');
    }
  }, [result]);

  // 저장 — 합성 미리보기를 캡처해 투명 PNG로 굽고 영구 저장한다.
  const save = useCallback(async () => {
    if (!result) return;
    setPhase('saving');
    try {
      const base64 = await captureRef(captureViewRef, { format: 'png', result: 'base64' });
      const uri = await saveCustomCharacter(base64);
      // 생성 즉시 위젯 반영 — 방금 구운 base64를 App Group 스냅샷에도 전파해, 다음 집중 세션까지
      // 안 기다리고 홈 위젯이 바로 갱신되게 한다. 스냅샷은 비필수라 실패해도 저장/onComplete를
      // 막지 않게 삼킨다(집중 화면이 스냅샷을 비필수로 다루는 것과 동일).
      // 참고: 이건 '생성' 시 반영이다. 선택 화면에서 재생성 없이 기본↔커스텀 '장착만' 전환할 때의
      //       즉시 반영은 후속 작업이며, 그 경우엔 다음 집중 세션에 갱신된다.
      try {
        await ScreenTimeModule.saveCharacterSnapshot(base64);
      } catch {
        /* 스냅샷 전파 실패는 무시 */
      }
      if (onComplete) {
        onComplete(uri);
      } else {
        navigation.goBack();
      }
    } catch {
      setError('캐릭터를 저장하지 못했어요. 다시 시도해 주세요.');
      setPhase('ready');
    }
  }, [result, onComplete, navigation]);

  const aspect = result && result.height > 0 ? result.width / result.height : 1;
  const saving = phase === 'saving';

  return (
    <SettingsScaffold
      title="사진에서 캐릭터 만들기"
      onBack={() => navigation.goBack()}
      scroll={false}
    >
      <View style={s.flex1}>
        {/* 무대 — 단색 배경 + 책상 띠 + 소품 이모지 위에 캐릭터가 선다 */}
        <View style={s.stage}>
          <View style={s.desk}>
            {DESK_EMOJI.map((e) => (
              <Text key={e} style={s.deskEmoji}>
                {e}
              </Text>
            ))}
          </View>

          <View style={s.stageCenter}>
            {phase === 'working' ? (
              <View style={s.center}>
                <ActivityIndicator color={T.accent} />
                <Text style={s.hint}>물건만 오려내는 중…</Text>
              </View>
            ) : result ? (
              // 저장 시 이 컨테이너를 통째로 캡처한다(배경 투명 → 팔다리·눈까지 구워진 PNG).
              <View ref={captureViewRef} collapsable={false}>
                <ObjectCharacter
                  uri={result.uri}
                  aspect={aspect}
                  maxWidth={stageWidth}
                  maxHeight={STAGE_HEIGHT - 90}
                />
              </View>
            ) : (
              <View style={s.center}>
                <Ionicons name="cube-outline" size={44} color={T.inkMuted} />
                <Text style={s.hint}>사진을 고르면 여기에 캐릭터가 서요</Text>
              </View>
            )}
          </View>
        </View>

        {/* 상태 안내 — 누끼 폴백 사유 / 지원 여부 */}
        {error ? <Text style={s.notice}>{error}</Text> : null}
        {!supported && !error ? (
          <Text style={s.notice}>
            이 기기·빌드에서는 배경 제거가 지원되지 않아요(iOS 17+ 실기기 필요). 원본 사진 그대로
            보여줄게요.
          </Text>
        ) : null}
        {result?.cutout ? <Text style={s.ok}>배경 제거 성공 — 온디바이스 처리</Text> : null}

        <View style={s.actions}>
          {result ? (
            <>
              {/* 도구 — 회전 / 다른 사진 고르기(앨범·카메라) */}
              <View style={s.toolRow}>
                <TouchableOpacity
                  style={s.tool}
                  onPress={rotate}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh-outline" size={20} color={T.ink} />
                  <Text style={s.toolText}>돌리기</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.tool}
                  onPress={pick}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <Ionicons name="images-outline" size={20} color={T.ink} />
                  <Text style={s.toolText}>갤러리</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.tool}
                  onPress={takePhoto}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <Ionicons name="camera-outline" size={20} color={T.ink} />
                  <Text style={s.toolText}>카메라</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[s.primary, saving && s.primaryDisabled]}
                onPress={save}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <>
                    <ActivityIndicator color={T.white} />
                    <Text style={s.primaryText}>저장 중…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={T.white} />
                    <Text style={s.primaryText}>저장</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={s.primary} onPress={pick} activeOpacity={0.85}>
                <Ionicons name="images-outline" size={18} color={T.white} />
                <Text style={s.primaryText}>사진 고르기</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.secondary} onPress={takePhoto} activeOpacity={0.85}>
                <Ionicons name="camera-outline" size={18} color={T.accent} />
                <Text style={s.secondaryText}>사진 찍기</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  stage: {
    height: STAGE_HEIGHT,
    borderRadius: 20,
    backgroundColor: T.sandLight,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  // 책상 띠 — 캐릭터 발이 닿는 바닥
  desk: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
    backgroundColor: T.sand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
  },
  deskEmoji: { fontSize: 26 },
  stageCenter: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 52 },
  center: { alignItems: 'center', gap: T.space.sm, paddingBottom: 40 },
  hint: { ...T.text.caption, color: T.inkMuted },

  notice: {
    ...T.text.caption,
    color: T.dangerInk,
    backgroundColor: T.dangerBg,
    borderWidth: 1,
    borderColor: T.dangerBorder,
    borderRadius: 12,
    padding: T.space.md,
    marginTop: T.space.lg,
  },
  ok: {
    ...T.text.caption,
    color: T.successInk,
    backgroundColor: T.successBg,
    borderWidth: 1,
    borderColor: T.successBorder,
    borderRadius: 12,
    padding: T.space.md,
    marginTop: T.space.lg,
  },

  actions: { marginTop: 'auto', paddingTop: T.space.xl, gap: T.space.md },
  // 도구 3버튼 한 줄 — 회전 / 갤러리 / 카메라
  toolRow: { flexDirection: 'row', gap: T.space.md },
  tool: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    height: 48,
    borderRadius: 14,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
  },
  toolText: { ...T.text.caption, color: T.ink },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
  },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { ...T.text.subtitle, color: T.white },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.paper,
    borderWidth: 1,
    borderColor: T.accent,
  },
  secondaryText: { ...T.text.subtitle, color: T.accent },
});
