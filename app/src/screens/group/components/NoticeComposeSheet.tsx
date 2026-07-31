import { StyleSheet, Text } from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import type { GroupAnnouncementResponse } from '@/types/dto/group';

// 공지 작성·수정 시트 — 명세 docs/app/group-plan.md §6-5.
// ⚠️ 스켈레톤: SheetShell 껍데기와 props 계약만 있고 입력·저장은 후속 워커(APP-6)가 채운다.
//
// 구현 가이드(§6-5):
//  · 입력 2개 — 제목(≤100자, 필수) / 본문(필수, 멀티라인). 검증 실패 시 저장 버튼 비활성.
//  · editing이 null이면 createAnnouncement(groupId, body), 있으면
//    updateAnnouncement(groupId, editing.id, body) (@/services/groupApi).
//  · 저장 성공 → onSaved() (부모가 시트를 닫고 목록 재조회)
//  · 저장 중 중복 탭 방지(진행 플래그). 에러는 groupErrorCode로 분기하고 모르는 코드는 공통 문구.
//    NOTICE_FORBIDDEN(403)은 애초에 진입점을 감춰 예방하는 게 원칙이라 여기선 공통 문구로 충분하다.

export interface NoticeComposeSheetProps {
  groupId: string;
  // 수정 모드일 때 대상 공지. 없거나 null이면 새 공지 작성.
  editing?: GroupAnnouncementResponse | null;
  onClose: () => void;
  // 작성·수정 성공 — 부모가 닫고 목록을 재조회한다.
  onSaved: () => void;
}

// TODO(APP-6, §6-5): props.editing 유무로 작성/수정을 분기해 저장한다.
export default function NoticeComposeSheet(props: NoticeComposeSheetProps) {
  return (
    <SheetShell onClose={props.onClose}>
      <Text style={s.title}>{props.editing ? '공지 수정' : '공지 쓰기'}</Text>
      <Text style={s.placeholder}>공지 작성은 준비 중이에요</Text>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  placeholder: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.xxl,
  },
});
