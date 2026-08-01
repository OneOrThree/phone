import { useCallback, useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { ObjectCharacter } from '@/screens/spike/ObjectCharacter';
import {
  cutoutSubject,
  isSubjectMaskSupported,
  subjectMaskReasonLabel,
  type SubjectMaskResult,
} from '@/services/subjectMask';
import { T } from '@/constants/theme';

// 오브젝트 캐릭터 스파이크 화면 — 앨범에서 사물 사진을 고르면 온디바이스 누끼(Vision) 후
// 만화 팔·다리·눈을 붙여 "내 물건이 공부하는" 모습을 보여준다. 전부 로컬, 서버 전송 없음.
// 정식 기능이 아니라 바이럴 훅 기술 검증용 임시 화면이다.

const STAGE_HEIGHT = 340; // 캐릭터가 서는 무대 높이
const DESK_EMOJI = ['📚', '☕️', '✏️'];

type Phase = 'idle' | 'working' | 'ready';

export default function ObjectCharacterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<never>>();
  const { width } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SubjectMaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supported = useMemo(() => isSubjectMaskSupported(), []);
  const stageWidth = width - T.space.xl * 2 - T.space.xl;

  const pick = useCallback(async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: false,
    }).catch(() => null);

    if (!picked || picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];

    setPhase('working');
    const cut = await cutoutSubject(asset.uri, {
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    });
    setResult(cut);
    setError(cut.cutout ? null : subjectMaskReasonLabel(cut.reason));
    setPhase('ready');
  }, []);

  const aspect = result && result.height > 0 ? result.width / result.height : 1;

  return (
    <SettingsScaffold
      title="내 물건 캐릭터 (실험)"
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
              <ObjectCharacter
                uri={result.uri}
                aspect={aspect}
                maxWidth={stageWidth}
                maxHeight={STAGE_HEIGHT - 90}
              />
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
          <TouchableOpacity style={s.primary} onPress={pick} activeOpacity={0.85}>
            <Ionicons name="images-outline" size={18} color={T.white} />
            <Text style={s.primaryText}>{result ? '다시 선택' : '사진 고르기'}</Text>
          </TouchableOpacity>
          <Text style={s.footnote}>
            선택한 사진은 기기 안에서만 처리돼요. 어디에도 올라가지 않아요.
          </Text>
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
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
  },
  primaryText: { ...T.text.subtitle, color: T.white },
  footnote: { ...T.text.caption, color: T.inkMuted, textAlign: 'center' },
});
