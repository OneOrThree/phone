import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { V2RootStackParamList } from '@/navigation/types';
import SettingsScaffold from '@/v2/screens/settings/components/SettingsScaffold';
import { useUser } from '@/store/UserContext';
import { updateProfile } from '@/services/userApi';
import { getDeviceCountryCode } from '@/utils/deviceLocale';
import { T } from '@/constants/theme';

// 프로필 편집 — 닉네임 입력 + 캐릭터 스킨 그리드(이번엔 미구현 → 딤 오버레이 '준비 중').
// 닉네임은 클라 검증만(2~10자 & 현재값과 다름). 실시간 서버 중복검사 API가 없어 저장 시 확정한다.
const NICK_MIN = 2;
const NICK_MAX = 10;
// 스킨 그리드 자리채움 타일 수(가짜 3칸) — 딤 처리되어 상호작용은 없음.
const SKIN_TILES = [0, 1, 2];

export default function ProfileEditScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { nickname, setNickname } = useUser();

  // 원본 닉네임을 기준값으로 두고, 입력값을 로컬 상태로 관리.
  const original = (nickname ?? '').trim();
  const [value, setValue] = useState(nickname ?? '');
  const [saving, setSaving] = useState(false);

  const trimmed = value.trim();
  const validLength = trimmed.length >= NICK_MIN && trimmed.length <= NICK_MAX;
  const changed = trimmed !== original;
  const valid = validLength && changed; // 저장 가능(유효+변경)
  const canSave = valid && !saving;

  // 저장 — updateProfile 성공 시 컨텍스트 반영 후 뒤로. 실패(중복 등)는 Alert.
  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // 닉네임과 함께 기기 로케일 국가코드도 갱신 전송(GROMO-663). 확정 불가면 생략.
      await updateProfile({ nickname: trimmed, countryCode: getDeviceCountryCode() });
      setNickname(trimmed);
      navigation.goBack();
    } catch (e) {
      // 성공 경로에서만 언마운트되므로 여기서만 저장 상태 해제.
      setSaving(false);
      // 중복 닉네임(409 NICKNAME_DUPLICATE)과 기타 실패를 구분해 정확히 안내 (GROMO-639).
      const duplicated = axios.isAxiosError(e) && e.response?.status === 409;
      Alert.alert(
        '저장 실패',
        duplicated
          ? '이미 사용 중인 닉네임이에요'
          : '저장에 실패했어요. 잠시 후 다시 시도해 주세요',
      );
    }
  };

  const footer = (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={!canSave}
      onPress={onSave}
      style={[s.cta, !canSave ? s.ctaDisabled : null]}
    >
      {saving ? <ActivityIndicator color={T.white} /> : <Text style={s.ctaText}>검사 및 저장</Text>}
    </TouchableOpacity>
  );

  return (
    <SettingsScaffold title="프로필 편집" onBack={() => navigation.goBack()} footer={footer}>
      {/* ── 닉네임 ───────────────────────────────── */}
      <Text style={s.sectionTitle}>닉네임</Text>
      <View style={s.inputCard}>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={setValue}
          placeholder="닉네임을 입력해 주세요"
          placeholderTextColor={T.inkMuted}
          maxLength={NICK_MAX}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={onSave}
          editable={!saving}
        />
        <Text style={s.counter}>
          {trimmed.length}/{NICK_MAX}
        </Text>
      </View>

      {/* 검증 안내 — 형식(2~10자)+변경 시 '사용 가능해요'(낙관적 표시), 변경했는데 길이 미달이면 가이드.
          실제 중복 검사는 서버 검증 API가 없어 '검사 및 저장' 버튼으로 저장 시 확정한다 (GROMO-639). */}
      {valid ? (
        <View style={s.hintRow}>
          <Ionicons name="checkmark-circle" size={15} color={T.successInk} />
          <Text style={[s.hintText, { color: T.successInk }]}>사용 가능해요</Text>
        </View>
      ) : changed && !validLength ? (
        <View style={s.hintRow}>
          <Ionicons name="alert-circle" size={15} color={T.dangerInk} />
          <Text style={[s.hintText, { color: T.dangerInk }]}>
            {NICK_MIN}~{NICK_MAX}자로 입력해 주세요
          </Text>
        </View>
      ) : (
        <Text style={s.hintPlaceholder}>
          {NICK_MIN}~{NICK_MAX}자로 정할 수 있어요
        </Text>
      )}

      {/* ── 캐릭터 스킨(준비 중) ─────────────────── */}
      <Text style={[s.sectionTitle, s.sectionTitleGap]}>캐릭터 스킨</Text>
      <View style={s.skinWrap}>
        <View style={s.skinGrid}>
          {SKIN_TILES.map((i) => (
            <View key={i} style={s.skinTile}>
              <Ionicons name="shirt-outline" size={26} color={T.inkFaint} />
            </View>
          ))}
        </View>

        {/* 반투명 딤 오버레이 — 새 의존성(블러) 없이 View + opacity로 처리. 터치 통과 차단. */}
        <View pointerEvents="none" style={s.skinDim} />

        {/* 준비 중 배지 — 오버레이 위, 딤과 분리해 불투명 유지. */}
        <View pointerEvents="none" style={s.skinBadgeWrap}>
          <View style={s.skinBadge}>
            <Ionicons name="lock-closed" size={13} color={T.inkSub} />
            <Text style={s.skinBadgeText}>캐릭터 스킨 · 준비 중</Text>
          </View>
        </View>
      </View>
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  // 섹션
  sectionTitle: { ...T.text.caption, color: T.inkMuted, marginBottom: 8, marginLeft: 6 },
  sectionTitleGap: { marginTop: 24 },

  // 닉네임 입력 카드
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  input: { flex: 1, ...T.text.body, color: T.ink, paddingVertical: 12 },
  counter: { ...T.text.caption, color: T.inkMuted },

  // 검증 안내
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, marginLeft: 6 },
  hintText: { ...T.text.caption },
  hintPlaceholder: { ...T.text.caption, color: T.inkMuted, marginTop: 8, marginLeft: 6 },

  // 스킨 그리드(준비 중)
  skinWrap: { position: 'relative' },
  skinGrid: { flexDirection: 'row', gap: 12 },
  skinTile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: T.sandLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skinDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: T.paperLight,
    opacity: 0.72,
    borderRadius: 16,
  },
  skinBadgeWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  skinBadgeText: { ...T.text.caption, color: T.inkSub },

  // 저장 CTA
  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { ...T.text.subtitle, color: T.white },
});
