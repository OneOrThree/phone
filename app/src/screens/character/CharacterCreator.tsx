import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { ObjectCharacter } from '@/screens/character/ObjectCharacter';
import {
  cutoutSubject,
  isSubjectMaskSupported,
  saveCustomCharacter,
  subjectMaskReasonLabel,
  type SubjectMaskResult,
} from '@/services/subjectMask';
import { T } from '@/constants/theme';

// 캐릭터 생성기(자립 컴포넌트) — 앨범/카메라로 사물 사진을 얻으면 온디바이스 누끼(Vision) 후
// 만화 팔·다리·눈을 붙여 "내 물건이 공부하는" 모습을 만든다. "저장"하면 합성된 미리보기를
// 그대로 캡처(captureRef)해 팔다리·눈까지 구워진 투명 PNG로 기기에 영구 저장하고 그 경로를
// onSaved로 돌려준다.
//
// ⚠️ 이 컴포넌트는 useNavigation·useCharacter를 쓰지 않는다(완전 자립) — NavigationContainer·
//    CharacterProvider 밖(온보딩 Modal)에서도 그대로 동작해야 하기 때문이다. 화면 크롬(뒤로가기·
//    저장 후 이동/반영)은 감싸는 쪽(설정 화면 래퍼 / 온보딩 Modal)이 onSaved로 처리한다.

const STAGE_HEIGHT = 340; // 캐릭터가 서는 무대 높이
const DESK_EMOJI = ['📚', '☕️', '✏️'];

type Phase = 'idle' | 'working' | 'ready' | 'saving';

interface Props {
  // 저장 완료 시 만들어진 커스텀 캐릭터의 file:// 경로를 넘긴다.
  onSaved: (uri: string) => void;
  // 유저별 파일로 저장하기 위한 userId(JWT sub). 이 컴포넌트는 context-free라 직접 얻지 못하므로
  // 감싸는 쪽(설정 화면=useUser / 온보딩=토큰 디코드)이 넘긴다. 없으면 단일 파일명으로 폴백한다.
  userId?: string | null;
}

export default function CharacterCreator({ onSaved, userId }: Props) {
  const { width } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<SubjectMaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 오브젝트 이미지 디코드 완료 여부 — cutout 반환 즉시 phase는 ready가 되지만 <Image>가
  // 아직 디코딩 중일 수 있어, 그 전에 저장하면 captureRef가 사진 물체가 빠진 채로 굽는다.
  // 새 결과·회전으로 uri가 바뀌면 false로 리셋하고 ObjectCharacter onLoad에서 다시 true로.
  const [imageLoaded, setImageLoaded] = useState(false);

  // 합성 미리보기를 감싸는 컨테이너 — 저장 시 이 View를 통째로 캡처해 PNG로 굽는다.
  const captureViewRef = useRef<View>(null);

  const supported = useMemo(() => isSubjectMaskSupported(), []);
  const stageWidth = width - T.space.xl * 2 - T.space.xl;

  // 얻은 사진(앨범/카메라 공통)을 같은 누끼 흐름에 태운다.
  const runCutout = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setPhase('working');
    setImageLoaded(false); // 새 물체 이미지 — 디코드 완료 전까지 저장 잠금
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
      setImageLoaded(false); // 회전된 새 이미지 — 디코드 완료 전까지 저장 잠금
      setResult((prev) =>
        prev ? { ...prev, uri: out.uri, width: out.width, height: out.height } : prev,
      );
    } catch {
      setError('사진을 돌리지 못했어요. 다시 시도해 주세요.');
    }
  }, [result]);

  // 저장 — 합성 미리보기를 캡처해 투명 PNG로 굽고 영구 저장한 뒤 경로를 onSaved로 돌려준다.
  const save = useCallback(async () => {
    if (!result) return;
    setPhase('saving');
    try {
      const base64 = await captureRef(captureViewRef, { format: 'png', result: 'base64' });
      // userId를 넘겨 유저별 파일로 저장 — 한 기기 두 계정이 서로 덮어쓰지 않게 한다.
      const uri = await saveCustomCharacter(base64, userId);
      // 위젯·실드가 읽는 App Group 스냅샷(focusCharacter.png)은 여기서 발행하지 않는다 —
      // '생성'은 '장착'이 아니라(생성 후에도 choice는 default 유지) 여기서 발행하면 미장착 커스텀이
      // 위젯·실드에 먼저 떠 버린다(코드리뷰). 스냅샷은 집중 세션이 장착된 캐릭터로 갱신하며,
      // 장착 즉시 반영은 후속 작업이다.
      onSaved(uri);
    } catch {
      setError('캐릭터를 저장하지 못했어요. 다시 시도해 주세요.');
      setPhase('ready');
    }
  }, [result, onSaved, userId]);

  const aspect = result && result.height > 0 ? result.width / result.height : 1;
  const saving = phase === 'saving';
  // 처리 중(working)엔 result에 이전 값이 남아 액션이 보이지만 미리보기는 스피너다 —
  // 이때 저장하면 captureRef가 언마운트된 타깃을 잡아 실패하므로 회전·재선택·저장을 모두 잠근다.
  const busy = phase === 'working' || saving;

  return (
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
                onLoad={() => setImageLoaded(true)}
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
                disabled={busy}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-outline" size={20} color={T.ink} />
                <Text style={s.toolText}>돌리기</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.tool} onPress={pick} disabled={busy} activeOpacity={0.85}>
                <Ionicons name="images-outline" size={20} color={T.ink} />
                <Text style={s.toolText}>갤러리</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.tool}
                onPress={takePhoto}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Ionicons name="camera-outline" size={20} color={T.ink} />
                <Text style={s.toolText}>카메라</Text>
              </TouchableOpacity>
            </View>

            {/* 저장 — 처리 중(busy)이거나 이미지 디코드 완료 전(imageLoaded=false)엔 잠근다 */}
            <TouchableOpacity
              style={[s.primary, (busy || !imageLoaded) && s.primaryDisabled]}
              onPress={save}
              disabled={busy || !imageLoaded}
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
