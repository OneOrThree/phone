import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T, withAlpha } from '@/constants/theme';

// 공용 확인 카드 모달 — 네이티브 Alert를 대체하는 앱 컨셉 다이얼로그(GROMO-1210).
// D7 규격: 반투명 스크림(withAlpha(T.night.bottom, 0.5)) + 중앙 흰 카드(maxWidth 360, r20).
// 스타일 정본은 AccountScreen 탈퇴 확인 모달에서 이식했다(GroupCreateScreen 초대 링크 카드와 동일 계열).
// 주 버튼은 채움(기본 accent — 유도 동작은 파괴적이지 않다), 파괴적 동작만 destructive로 위험색.
// 보조 버튼은 텍스트형이며 secondaryLabel이 있을 때만 렌더한다.
interface ConfirmCardModalProps {
  visible: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  onPrimary: () => void;
  /** 주 버튼 비활성(요청 진행 중 등) */
  primaryDisabled?: boolean;
  /** 파괴적 동작 — 주 버튼을 위험색(accentAlt)으로 */
  destructive?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** 하드웨어 백 버튼·스크림 탭 공통 닫기 */
  onRequestClose: () => void;
  /** testID 접두 — 카드 자체 / `.primary` / `.secondary` / `.backdrop` */
  testID?: string;
}

export default function ConfirmCardModal({
  visible,
  title,
  body,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  destructive,
  secondaryLabel,
  onSecondary,
  onRequestClose,
  testID,
}: ConfirmCardModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={s.overlay}>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={onRequestClose}
          testID={testID ? `${testID}.backdrop` : undefined}
        />
        <View style={s.card} testID={testID}>
          <Text style={s.cardTitle}>{title}</Text>
          <Text style={s.cardBody}>{body}</Text>
          <TouchableOpacity
            style={[
              destructive ? s.dangerBtn : s.primaryBtn,
              primaryDisabled ? s.btnDisabled : null,
            ]}
            activeOpacity={0.85}
            disabled={primaryDisabled}
            onPress={onPrimary}
            testID={testID ? `${testID}.primary` : undefined}
          >
            <Text style={s.primaryText}>{primaryLabel}</Text>
          </TouchableOpacity>
          {secondaryLabel ? (
            <TouchableOpacity
              style={s.secondaryBtn}
              activeOpacity={0.7}
              onPress={onSecondary}
              testID={testID ? `${testID}.secondary` : undefined}
            >
              <Text style={s.secondaryText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // 스크림 — 리그 오버레이와 같던 값(전용 토큰 없음, 원본 ProfileSheet는 GROMO-940에서 폐기)
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: withAlpha(T.night.bottom, 0.5) },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: T.paperLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: T.space.xxl,
    paddingTop: T.space.xxl,
    paddingBottom: T.space.md,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  cardBody: { ...T.text.body, color: T.inkSub, marginTop: T.space.md },
  primaryBtn: {
    marginTop: T.space.xl,
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    alignItems: 'center',
  },
  dangerBtn: {
    marginTop: T.space.xl,
    backgroundColor: T.accentAlt,
    borderRadius: 14,
    paddingVertical: T.space.lg,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryText: { ...T.text.subtitle, color: T.white },
  secondaryBtn: { paddingVertical: T.space.lg, alignItems: 'center' },
  secondaryText: { ...T.text.label, color: T.inkSub },
});
