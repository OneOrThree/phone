import { View, Text, StyleSheet } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import Svg, { Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W13 · 알림 권한 — OS 알림 권한 요청. 앱 푸시 스택이 FCM(@react-native-firebase/messaging)이라
// 권한도 messaging().requestPermission()으로 요청한다(expo-notifications가 아님).
//   → registerPushToken의 messaging().hasPermission() 확인과 API가 일치하고, iOS APNs 등록도
//     이 호출에서 함께 이뤄져 로그인 후 getToken()이 정상 동작한다.
//   (expo-notifications로 요청하면 firebase가 알림 델리게이트를 쥔 상태라 프롬프트가 안 뜰 수 있음.)
// FCM 토큰 등록은 로그인 후 PushGate가 담당 — 여기선 권한만 받아 notificationGranted 저장.
const STAR = 'M12 3l2.5 5.4 5.9.5-4.5 3.9 1.4 5.8L12 16.9 6.2 20.3l1.6-6.6L2.6 9.3l6.8-.5z';
const MOON = 'M20 15a8 8 0 01-11-7 8 8 0 108 11z';

const ITEMS = [
  { title: '승급했어요!', sub: '초집중 모드 → 갓생러', icon: 'star', color: T.accent },
  { title: '목표 달성 응원', sub: '한 걸음 더 나아가요', icon: 'star', color: T.green },
  {
    title: '심야 절제 알림',
    sub: '밤 12시, 이제 쉴까요?',
    icon: 'moon',
    color: T.subjectPalette[5],
  },
] as const;

export default function NotificationPermissionStep({ update, onNext, onBack }: StepProps) {
  const allow = async () => {
    let granted = false;
    try {
      const status = await messaging().requestPermission();
      granted =
        status === messaging.AuthorizationStatus.AUTHORIZED ||
        status === messaging.AuthorizationStatus.PROVISIONAL;
    } catch {
      granted = false;
    }
    update({ notificationGranted: granted });
    onNext();
  };
  const skip = () => {
    update({ notificationGranted: false });
    onNext();
  };

  return (
    <StepScaffold
      center
      title={'챙길 건 챙기고\n더 나아가게요'}
      ctaLabel="허용"
      onCta={allow}
      secondaryLabel="건너뛰기"
      onSecondary={skip}
      onBack={onBack}
    >
      <View style={s.list}>
        {ITEMS.map((it) => (
          <View key={it.title} style={s.card}>
            <View style={s.iconBox}>
              <Svg width={17} height={17} viewBox="0 0 24 24">
                {it.icon === 'star' ? (
                  <Path d={STAR} fill={it.color} />
                ) : (
                  <Path
                    d={MOON}
                    fill="none"
                    stroke={it.color}
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                  />
                )}
              </Svg>
            </View>
            <View style={s.texts}>
              <Text style={s.cardTitle}>{it.title}</Text>
              <Text style={s.cardSub}>{it.sub}</Text>
            </View>
          </View>
        ))}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  list: { alignSelf: 'stretch', gap: 9 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1 },
  cardTitle: { ...T.text.caption, fontWeight: '700', color: T.ink },
  cardSub: { fontSize: 11, fontWeight: '500', color: T.inkMuted, marginTop: 1 },
});
