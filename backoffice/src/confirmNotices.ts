import { iosStoreNotice, storeWarning, unavailableNotice, unpublishedWarning, type SystemVersions } from './versions.ts';
import type { ContentItem } from './types.ts';

export const FORCE_WARNING = '이 버전보다 낮은 앱은 업데이트 전까지 쓸 수 없습니다. 스토어에 올라간 버전 이하인지 확인하세요. 이 공지의 제목과 본문은 로그인 없이 공개됩니다.';
// 옛 항목은 noticeType 이 없다 — min 이 하나라도 있으면 강제 업데이트다.
export const forces = (value: { noticeType?: string; minIosVersion?: string | null; minAndroidVersion?: string | null }) => (value.noticeType ?? (value.minIosVersion || value.minAndroidVersion ? 'force' : 'patch')) === 'force';

export interface ConfirmNotice { text: string; className: 'callout' | 'field-hint'; role?: 'alert' | 'status' }

// 승인 대화상자 안내. before 는 내용 미리보기 앞, after 는 뒤에 이 순서 그대로 그린다.
// 둘 다 dialog 의 aria-describedby 가 가리키는 요소에 담으므로, 안내를 더하려면 여기에 더한다.
export function confirmNotices(item: Pick<ContentItem, 'kind' | 'status' | 'noticeType' | 'minIosVersion' | 'minAndroidVersion'>, action: string, iosStore: SystemVersions['iosStore'] | null): { before: ConfirmNotice[]; after: ConfirmNotice[] } {
  const force = item.kind === 'notice' && forces(item) && ['review', 'approve', 'publish'].includes(action);
  const store = force ? iosStoreNotice(item.minIosVersion, iosStore) : null;
  const callout = (text: string, role?: ConfirmNotice['role']): ConfirmNotice => ({ text, className: 'callout', role });
  const after: (ConfirmNotice | false)[] = [
    action === 'publish' && callout(item.kind === 'fcm' ? '발송 요청이 접수되어도 실제 기기 수신을 의미하지 않습니다. 발송 게이트가 꺼져 있으면 대기합니다.' : item.kind === 'construction' ? '승인된 비용과 공사 시간을 새 착공에 적용합니다. 이미 시작한 공사는 유지되며, 기준 정책이 바뀌었다면 다시 검토해야 합니다.' : '현재 승인된 수정본을 게시합니다. 게시 이후 내용은 이 초안에서 수정할 수 없습니다.'),
    force && callout(FORCE_WARNING, 'alert'),
    store === 'exceeds' && callout(storeWarning(iosStore?.version ?? ''), 'status'),
    store === 'unpublished' && callout(unpublishedWarning, 'status'),
    store === 'unavailable' && callout(unavailableNotice),
    action === 'cancel' && callout('발행 전 작업을 취소하고 보관 목록으로 옮깁니다. 내용과 변경 이력은 남습니다.'),
    action === 'cancel-delivery' && callout('대기·재시도 중인 발송을 취소합니다. 이미 발송했거나 FCM 호출 중인 알림은 회수할 수 없습니다. 처리 후 수치를 확인하세요.'),
    action === 'withdraw' && callout('앱의 개발자 공지 노출을 즉시 종료합니다. 게시 이력은 남습니다.'),
    action === 'archive' && callout(`운영 작업 목록에서 보관합니다. ${item.kind === 'magazine' ? '발행된 잡지 호는 앱에서 유지됩니다.' : '적용된 건설 정책은 유지됩니다.'}`),
    action === 'approve' && { text: '승인 후 내용이 바뀌면 다시 검토·승인이 필요합니다.', className: 'field-hint' },
  ];
  return {
    before: item.status === 'uncertain' ? [callout('최초 발송과 같은 요청 번호로 재시도합니다. 새로운 발송 요청을 만들지 않습니다.')] : [],
    after: after.filter((notice): notice is ConfirmNotice => !!notice),
  };
}
