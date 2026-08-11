import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import CharacterCreator from '@/screens/character/CharacterCreator';
import { isSubjectMaskModuleAvailable } from '@/services/subjectMask';
import { getUserIdFromToken } from '@/services/api';
import { STORAGE_KEYS } from '@/types/storage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

// 누끼 체험 스텝 — 캐릭터 소개(CharacterIntroStep) 다음, 닉네임 앞. 스킵 불가.
// "이렇게 내 물건으로 캐릭터를 만들 수 있어요"를 한 번 직접 해보게 하는 체험/맛보기다.
// 여기서 누끼를 만들어도 기본 장착은 그로몬 유지 — 만든 결과는 온보딩 데이터(cutoutCharacterUri)에
// 담아 두고, 완료 시 App이 CharacterContext에 시드한다(장착은 나중에 홈 캐릭터 선택에서).
//
// 자립 배선: 생성기(CharacterCreator)는 useNavigation·useCharacter를 쓰지 않으므로
// NavigationContainer·CharacterProvider 밖(온보딩)에서도 동작한다. 여기선 RN Modal로 띄우고,
// 저장 결과는 onSaved 콜백으로 받아 update()로 온보딩 데이터에 담는다.

type IconName = ComponentProps<typeof Ionicons>['name'];

// 안내 3가지(해요체) — ① 직접 해보기 ② 홈에서 장착 ③ 함께 집중 기능 예고.
const GUIDES: { icon: IconName; text: string }[] = [
  { icon: 'sparkles-outline', text: '이렇게 사진 속 물건으로 캐릭터를 만들 수 있어요.' },
  { icon: 'home-outline', text: '만든 캐릭터는 홈에서 변경할 수 있어요.' },
  {
    icon: 'people-outline',
    text: '앱 내에서 내가 만든 캐릭터로 다른 사람들과 같이 집중할 수 있는 기능은 준비중이에요',
  },
];

export default function CutoutStep({ data, update, onNext }: StepProps) {
  const [modalOpen, setModalOpen] = useState(false);
  // 서버 모더레이션이 '검사 불가(unavailable)'로 막힌 적이 있는지. 이때만 온보딩 갇힘을 피하려
  // 캐릭터 없이 다음으로 넘어가게 열어 준다(정상 상황의 '체험 필수'는 그대로).
  const [moderationUnavailable, setModerationUnavailable] = useState(false);
  // 생성기를 한 번 열었다가 X로 닫아 체험을 포기한 적이 있는지. 누끼(온디바이스/서버)가 실패해도
  // 온보딩에 갇히지 않도록, 이때는 캐릭터를 못 만들었어도 '다음'을 열어 준다(저장 안 함 → 기본 그로몬 유지).
  const [creatorDismissed, setCreatorDismissed] = useState(false);
  const created = !!data.cutoutCharacterUri;

  // 유저별 파일 저장용 userId. 온보딩은 Provider 밖이라 useUser를 못 쓰고, 로그인 스텝이 누끼보다
  // 앞서 있어 이 시점엔 토큰이 이미 저장돼 있다 — 저장된 토큰의 JWT sub를 그대로 쓴다. 이 값을
  // 생성기에 넘겨 한 기기 두 계정이 서로의 캐릭터 파일을 덮어쓰지 않게 한다.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.accessToken).then((token) => {
      setUserId(token ? getUserIdFromToken(token) : null);
    });
  }, []);

  // 만들기 가능 여부 = 저장(saveCustomCharacter)을 지원하는 네이티브 모듈이 링크됐는가.
  // 모듈이 없는 빌드(안드로이드·구 바이너리 OTA)에선 만들기 자체가 불가하므로, 온보딩이 영구
  // 차단되지 않도록 그냥 통과시킨다(기본 그로몬 유지). E2E 빌드도 사진 선택 자동화가 불가능해 통과 허용.
  const canCreate = isSubjectMaskModuleAvailable();
  const canSkip = !canCreate || process.env.EXPO_PUBLIC_E2E === '1';

  // 생성기가 저장 경로를 돌려주면 온보딩 데이터에 담고 Modal을 닫는다. 저장 경로는 고정 파일이라
  // 그대로 두면 RN <Image>가 URI를 캐시 키로 잡아 '다시 만들어보기' 미리보기가 옛 이미지로 남는다.
  // 캐시버스트 쿼리를 붙여 매 저장마다 키를 바꾼다(CharacterCreateRoute와 동일한 처리).
  const handleSaved = (uri: string) => {
    update({ cutoutCharacterUri: `${uri}?t=${Date.now()}` });
    setModerationUnavailable(false);
    setModalOpen(false);
  };

  // 생성기 X(닫기) — 모달을 닫고, 못 만들었어도 넘어갈 수 있게 '다음'을 연다.
  const closeCreator = () => {
    setModalOpen(false);
    setCreatorDismissed(true);
  };

  return (
    <StepScaffold
      testID="onboarding.step.cutout_experience"
      title={'내가 찍은 사진으로 내 캐릭터를 만들 수 있어요!'}
      subtitle="사진 한 장이면 나만의 캐릭터가 완성돼요."
      // 작은 화면(SE 등)에서 가이드+만들기 버튼이 뷰포트를 넘겨 잘리지 않게 스크롤 허용(스킵 불가 스텝).
      scrollable
      ctaLabel="다음"
      // 만들어(cutoutCharacterUri 생성) 체험을 완료해야 다음으로. 단, 만들기 불가 기기(canSkip),
      // 서버 모더레이션 '검사 불가'(moderationUnavailable, 백엔드 미배포·장애 등), 그리고 생성기를
      // 열었다가 X로 닫아 포기한 경우(creatorDismissed, 누끼 실패 대비)는 영구 차단을 막기 위해 그냥
      // 통과시킨다(그 사진은 저장하지 않아 기본 그로몬 유지). 능동 스킵 버튼은 두지 않는다.
      ctaDisabled={!created && !canSkip && !moderationUnavailable && !creatorDismissed}
      onCta={onNext}
    >
      <View style={s.guides}>
        {GUIDES.map((g) => (
          <View key={g.text} style={s.guideRow}>
            <Ionicons name={g.icon} size={20} color={T.accent} style={s.guideIcon} />
            <Text style={s.guideText}>{g.text}</Text>
          </View>
        ))}
      </View>

      {canCreate ? (
        <>
          <TouchableOpacity
            testID="onboarding.cutout.create"
            style={s.makeBtn}
            activeOpacity={0.85}
            onPress={() => setModalOpen(true)}
          >
            <Ionicons name="camera-outline" size={20} color={T.accent} />
            <Text style={s.makeText}>{created ? '다시 만들어보기' : '내 물건으로 만들어보기'}</Text>
          </TouchableOpacity>

          {created ? (
            <View style={s.doneRow}>
              <CharacterImage size={64} sourceUri={data.cutoutCharacterUri} />
              <Text style={s.doneText}>이 캐릭터로 만들었어요.</Text>
            </View>
          ) : moderationUnavailable ? (
            // 검사 불가로 지금은 못 만드는 경우 — 갇히지 않게 안내하고 다음으로 넘어갈 수 있게 한다.
            <Text style={s.hint}>
              지금은 확인이 어려워요. 나중에 홈에서 ‘캐릭터 변경’으로 만들 수 있어요. 지금은
              넘어가도 괜찮아요.
            </Text>
          ) : creatorDismissed ? (
            // 생성기를 열었다가 닫은 경우 — 지금 안 만들어도 넘어갈 수 있게 안내한다.
            <Text style={s.hint}>지금 안 만들어도 괜찮아요. 나중에 홈에서 만들 수 있어요.</Text>
          ) : (
            <Text style={s.hint}>먼저 캐릭터를 만들어 주세요.</Text>
          )}

          {/* 생성기 — NavigationContainer가 필요 없는 RN Modal로 띄운다. 닫기는 상단 X 버튼. */}
          <Modal visible={modalOpen} animationType="slide" onRequestClose={closeCreator}>
            {/* RN Modal은 별도 네이티브 window라 바깥(App.tsx)의 SafeAreaProvider가 주는 inset이
                안쪽까지 오지 않는다 — edges를 줘도 top이 0으로 잡혀 제목·닫기 버튼이 상태바와
                겹친다(GROMO-1211). 특히 다른 앱에서 돌아와 '◀ 앱이름' 표시로 상태바가 커진
                상태에서 두드러진다. Provider를 Modal 안에 다시 두면 이 window에서 실제 inset을
                측정한다(safe-area-context 공식 권장, react-navigation도 모달에 같은 처리). */}
            <SafeAreaProvider>
              <SafeAreaView style={s.modalRoot} edges={['top', 'bottom']}>
                <View style={s.modalBar}>
                  <Text style={s.modalTitle}>사진에서 캐릭터 만들기</Text>
                  <TouchableOpacity
                    onPress={closeCreator}
                    style={s.modalClose}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="close" size={24} color={T.ink} />
                  </TouchableOpacity>
                </View>
                <View style={s.modalBody}>
                  <CharacterCreator
                    userId={userId}
                    onSaved={handleSaved}
                    onUnavailable={() => setModerationUnavailable(true)}
                  />
                </View>
              </SafeAreaView>
            </SafeAreaProvider>
          </Modal>
        </>
      ) : (
        // 만들기 불가 기기 — 만들기 버튼 대신 안내만 띄우고 '다음'으로 통과시킨다(기본 그로몬 유지).
        <Text style={s.hint}>
          이 기기에서는 캐릭터 만들기가 아직 지원되지 않아요. 나중에 홈에서 만들 수 있어요.
        </Text>
      )}
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  guides: { gap: T.space.md },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    padding: T.space.lg,
  },
  guideIcon: { marginTop: 1 },
  guideText: { ...T.text.body, color: T.ink, flex: 1 },
  makeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.paper,
    borderWidth: 1.5,
    borderColor: T.accent,
    marginTop: T.space.xxl,
  },
  makeText: { ...T.text.subtitle, color: T.accent },
  hint: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.lg, textAlign: 'center' },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    marginTop: T.space.lg,
  },
  doneText: { ...T.text.caption, color: T.inkSub },

  // 생성기 Modal 크롬 — 설정 화면(SettingsScaffold)과 같은 톤의 상단바 + 좌우 패딩.
  modalRoot: { flex: 1, backgroundColor: T.paperLight },
  modalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.xs,
    paddingBottom: T.space.md,
  },
  modalTitle: { ...T.text.heading, color: T.ink },
  modalClose: { padding: T.space.xs },
  modalBody: { flex: 1, paddingHorizontal: T.space.xl },
});
