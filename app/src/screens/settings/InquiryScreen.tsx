import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import InquiryCategoryChips from '@/screens/settings/components/InquiryCategoryChips';
import InquiryContactCard from '@/screens/settings/components/InquiryContactCard';
import { openInquiryChat } from '@/screens/settings/inquiryLink';
import ConfirmCardModal from '@/components/ConfirmCardModal';
import {
  INQUIRY_CONTACTS,
  type InquiryCategoryId,
  type InquiryContact,
} from '@/constants/inquiryContacts';
import {
  logInquiryCategorySelected,
  logInquiryContactOpened,
  logInquiryScreenViewed,
} from '@/services/analyticsEvents';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 1:1 문의 화면(docs/prd/inquiry/low-level-design.md §5).
// 담당 개발자를 골라 카카오톡 1:1 오픈채팅방으로 나간다 — 앱의 경계는 openURL에서 끝나고,
// 서버에는 아무것도 남지 않는다(policy.md D1 · D13). 그래서 네트워크 호출도, 로딩 상태도 없다.
//
// 이 화면에서 다른 화면으로 navigate 하는 경로는 없다 — goBack뿐이다(흐름의 종착점이 앱 밖).

/**
 * 노출 이벤트 재발화 간격 — GA4 기본 세션 타임아웃(30분).
 * 콘솔에서 세션 타임아웃을 바꾸면 이 값도 같이 바꿔야 한다.
 */
const VIEWED_REFIRE_MS = 30 * 60 * 1000;

export default function InquiryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [category, setCategory] = useState<InquiryCategoryId | null>(null);
  // 아래 셋은 한 몸이다 — closeModal()에서만 함께 되돌린다(§5.4 · IA §7).
  const [target, setTarget] = useState<InquiryContact | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  // 요청 세대 — await 사이에 모달을 닫았거나 다시 열었으면 늦게 온 결과를 폐기한다.
  // ⚠️ 「대상 담당자가 같은지」로 비교하면 안 된다. INQUIRY_CONTACTS의 원소는 상수라 매번
  //    같은 객체이고, 「닫았다가 **같은 담당자**를 다시 열기」가 그 검사를 그대로 통과한다.
  //    그러면 폐기했어야 할 이전 실패가 새 모달을 실패 화면으로 갈아 끼운다.
  const reqIdRef = useRef(0);

  // ── 노출 계측 ────────────────────────────────────────────────────────────
  // 사용자를 앱 밖으로 내보내는 화면이라 「떠났다 돌아온다」가 정상 경로다. 그 사이 GA4 세션이
  // 새로 시작되면 화면은 계속 마운트돼 있어 useEffect가 다시 안 돌고, 새 세션에는
  // inquiry_contact_opened만 남아 전환율이 100%를 넘는다(분자 ⊄ 분모).
  const lastViewedAt = useRef(0);
  const markViewed = useCallback(() => {
    const now = Date.now();
    if (now - lastViewedAt.current < VIEWED_REFIRE_MS) return;
    lastViewedAt.current = now;
    logInquiryScreenViewed();
  }, []);

  useEffect(() => {
    markViewed();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') markViewed();
    });
    return () => sub.remove();
  }, [markViewed]);

  // 선택된 카테고리의 담당자를 맨 앞으로. 나머지는 상수 순서를 유지한다(sort는 안정 정렬).
  // 목록에서 빼지 않는다 — 「사용자가 직접 지목」(policy.md D2)이 유지되려면 항상 3장 다 보여야 한다.
  const ordered = useMemo(() => {
    if (!category) return INQUIRY_CONTACTS;
    return [...INQUIRY_CONTACTS].sort(
      (a, b) => Number(b.categoryId === category) - Number(a.categoryId === category),
    );
  }, [category]);

  // 모달을 닫는 유일한 경로 — 취소·백드롭 탭·Android 뒤로 가기·실패 상태의 「닫기」가 전부 여기로 온다.
  // ⚠️ failed를 같이 리셋하지 않으면: 담당자 A에서 실패해 failed=true가 된 뒤 「닫기」로 내리고,
  //    담당자 B 카드를 누르면 **B는 시도조차 안 했는데** 곧바로 「카카오톡을 열 수 없어요」가 뜬다.
  const closeModal = useCallback(() => {
    reqIdRef.current += 1; // 진행 중인 요청 무효화
    setTarget(null);
    setFailed(false);
    setPending(false);
  }, []);

  const handleSelectCategory = useCallback(
    (id: InquiryCategoryId | null) => {
      setCategory(id);
      // 해제(null)는 이벤트를 쏘지 않는다 — 선택만 센다.
      if (id === null) return;
      markViewed(); // 이 화면의 이벤트는 전부 markViewed()를 먼저 통과시킨다
      logInquiryCategorySelected(id);
    },
    [markViewed],
  );

  // 카드 CTA — 확인 모달을 연다. setTarget을 그대로 넘기지 않는다(useState 업데이터 형태와 헷갈린다).
  const handleOpenContact = useCallback((contact: InquiryContact) => {
    setTarget(contact);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!target || pending) return;
    setPending(true);
    const requested = target;
    const myId = ++reqIdRef.current;
    // ⚠️ 분석 이벤트는 openURL **앞에서** 쏜다 — 뒤에서 쏘면 앱이 백그라운드로 넘어가는
    //    타이밍과 겹쳐 유실된다(high-level-design.md §3.1).
    // ⚠️ 「다시 시도」(= failed 상태에서의 재호출)에서는 쏘지 않는다. 재시도는 새로운 「선택」이
    //    아니다 — 그대로 세면 링크·기기가 나쁜 쪽 유형이 과대표집되어 추천 일치율(prd.md §5)이
    //    왜곡된다. failed 상태의 호출은 정의상 재시도뿐이므로 이 한 줄로 「모달 1회 = 선택 1건」이 된다.
    markViewed();
    if (!failed) {
      logInquiryContactOpened({
        category,
        contactId: requested.id,
        isRecommended: requested.categoryId === category,
      });
    }
    const ok = await openInquiryChat(requested.openChatUrl);
    // await 사이에 모달을 닫았거나 다시 열었으면 이 결과는 폐기한다.
    if (reqIdRef.current !== myId) return;
    if (ok) {
      // 성공하면 닫아 둔다 — 카카오톡에서 돌아왔을 때 모달이 떠 있으면 「아직 안 갔나?」로 읽힌다.
      closeModal();
    } else {
      setFailed(true);
      setPending(false); // 「다시 시도」를 누를 수 있어야 한다
    }
  }, [target, pending, failed, category, closeModal, markViewed]);

  return (
    <SettingsScaffold title="1:1 문의" onBack={() => navigation.goBack()}>
      <Text style={s.lead}>무엇을 도와드릴까요?</Text>
      <Text style={s.desc}>담당 개발자에게 카카오톡으로 직접 물어보실 수 있어요.</Text>

      <Text style={s.sectionLabel}>어떤 내용인가요?</Text>
      <InquiryCategoryChips selected={category} onSelect={handleSelectCategory} />

      <Text style={s.sectionLabel}>담당 개발자</Text>
      {ordered.map((contact) => (
        <InquiryContactCard
          key={contact.id}
          contact={contact}
          recommended={contact.categoryId === category}
          onPress={handleOpenContact}
        />
      ))}

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={16} color={T.accentDeep} />
        <Text style={s.noteText}>
          카카오톡 앱으로 이동해요. 24시간 응대는 어려워 답장이 하루 이틀 걸릴 수 있어요.
        </Text>
      </View>

      {/* ConfirmCardModal의 제목·본문에는 textAlign이 없어 왼쪽 정렬이다 —
          가운데 정렬을 가정한 줄바꿈을 넣지 말 것. */}
      <ConfirmCardModal
        visible={target !== null}
        title={failed ? '카카오톡을 열 수 없어요' : '카카오톡으로 이동할까요?'}
        body={
          target === null
            ? ''
            : failed
              ? `아래 주소를 길게 눌러 복사한 뒤 브라우저에서 열어 주세요.\n\n${target.openChatUrl}`
              : `${target.name}님의 1:1 오픈채팅방이 열려요.\n대화 내용은 카카오톡에 저장되고, gromo 서버에는 남지 않아요.`
        }
        primaryLabel={failed ? '다시 시도' : '이동하기'}
        onPrimary={handleConfirm}
        primaryDisabled={pending}
        // 실패 상태에서만 켠다 — 본문의 URL이 유일한 수동 복구 경로다(policy.md D7).
        bodySelectable={failed}
        secondaryLabel={failed ? '닫기' : '취소'}
        onSecondary={closeModal}
        onRequestClose={closeModal}
        testID="inquiry.confirm"
      />
    </SettingsScaffold>
  );
}

const s = StyleSheet.create({
  // 배경을 깔지 않는다 — SettingsScaffold의 root가 T.paperLight(#FFFFFF)라 이 화면은 흰 바탕이고,
  // 카드는 1px T.paperAlt 테두리로만 구분된다. T.bg를 깔면 카드가 실제보다 또렷해져 시안과 갈린다.
  lead: { ...T.text.heading, color: T.ink, marginTop: T.space.sm },
  desc: { ...T.text.body, color: T.inkSub, marginTop: T.space.sm },

  sectionLabel: { ...T.text.label, color: T.ink, marginTop: T.space.xxl, marginBottom: T.space.md },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.xxl,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },
});
