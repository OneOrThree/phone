import { Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CelebrationModal, CelebrationPill } from '@/components/CelebrationModal';
import { T } from '@/constants/theme';
import { t } from '@/i18n';

// 주간 스트릭 완성 축하 모달(GROMO-667) — 월~일 7일을 모두 채운 주, 일요일 결과 화면의
// ✓ 팝 뒤에 노출(주 1회). 코인/재화 지급 없음(축하+스트릭 정책).
//
// 연출·타이밍·게이트는 전부 CelebrationModal(공통 껍데기)에 있다 — 여기는 문구와 pill만 정한다.
// 이 모달만 캐릭터 위 배지가 없다(badge 생략) — 완주 표기는 문구 아래 pill로 간다.
interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WeekStreakModal({ visible, onClose }: Props) {
  return (
    <CelebrationModal
      visible={visible}
      onClose={onClose}
      testIDPrefix="weekStreak"
      title={t('focus.weekStreakModal.title')}
      sub={t('focus.weekStreakModal.sub')}
      footer={
        <CelebrationPill style={s.weekBox}>
          <Ionicons name="flame" size={15} color={T.flame} />
          <Text style={s.weekText}>{t('focus.weekStreakModal.pill')}</Text>
        </CelebrationPill>
      }
      ctaLabel={t('focus.weekStreakModal.cta')}
    />
  );
}

const s = StyleSheet.create({
  weekBox: { marginTop: T.space.md },
  weekText: { ...T.text.label, fontWeight: '600', color: T.accentDeep },
});
