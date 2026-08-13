import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  /** 본문을 길게 눌러 복사할 수 있게 한다(링크 폴백 등 — 본문에 URL이 들어가는 경우) */
  bodySelectable?: boolean;
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
  bodySelectable,
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
          {/* 제목과 본문을 **함께** 스크롤시킨다 — 버튼만 이 바깥이라 항상 화면 안에 남는다.
              제목을 밖에 두면, 작은 기기(SE 320pt) + 최대 글자 배율에서 제목이 여러 줄로 감겨
              그것만으로 카드의 maxHeight를 먹고 버튼을 밀어낸다. 스크롤해야 닿는 버튼은
              「없는 버튼」과 같고, 실패 모달에서는 그게 유일한 복구 경로다. */}
          <ScrollView
            style={s.bodyScroll}
            contentContainerStyle={s.bodyScrollInner}
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.cardTitle}>{title}</Text>
            <Text style={s.cardBody} selectable={bodySelectable}>
              {body}
            </Text>
          </ScrollView>
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
    // 본문이 길거나(폴백 URL 등) 글자 배율이 크면 카드가 화면 밖까지 자란다 —
    // 그러면 버튼이 밀려나 유일한 복구 경로에 손이 닿지 않는다. 스크림이 보이도록 80%로 제한.
    maxHeight: '80%',
    backgroundColor: T.paperLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: T.space.xxl,
    paddingTop: T.space.xxl,
    paddingBottom: T.space.md,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  // flexGrow:0 — 본문이 짧으면 내용 높이만 차지해 기존 호출부의 겉모습이 그대로 유지된다.
  // ⚠️ flexShrink:1 이 **반드시** 필요하다. RN 기본값은 flexShrink:0 이라, 이게 없으면
  //    카드가 maxHeight 에 걸려도 이 ScrollView 는 줄지 않고 그대로 넘쳐 버튼을 화면 밖으로
  //    밀어낸다 — 정작 이 스크롤을 넣은 이유(작은 기기 + 큰 글자 배율)에서만 안 듣는다.
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  bodyScrollInner: { paddingBottom: 0 },
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
