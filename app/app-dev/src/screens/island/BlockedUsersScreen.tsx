import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Btn, C, Txt } from '@/design-system/patterns';
import { IslandSheet, SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { unblockUser, type BlockedUser } from '@/services/api/safety';
import { errorTextOr, t } from '@/i18n';
import {
  markUserUnblocked,
  revalidateBlockedUsers,
  useBlockedUsers,
} from '@/services/blockedUsers';

export function BlockedUsersScreen({ e }: any) {
  const blockedUsers = useBlockedUsers(true, true);
  const items = blockedUsers.users;
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const visibleLoading = blockedUsers.status === 'loading';
  const visibleError =
    actionError ||
    (blockedUsers.status === 'error'
      ? errorTextOr(blockedUsers.error, 'account.blocked.loadFailed')
      : '');

  const load = useCallback(async () => {
    setActionError('');
    try {
      await revalidateBlockedUsers();
    } catch {}
  }, []);

  const unblock = async (item: BlockedUser) => {
    if (busyId) return;
    setBusyId(item.id);
    setActionError('');
    try {
      await unblockUser(item.id);
      markUserUnblocked(item.id);
      e.notify(t('account.blocked.unblocked', { name: item.name }));
      await load();
    } catch (thrown) {
      setActionError(errorTextOr(thrown, 'account.blocked.unblockFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <IslandSheet
      bg="dock"
      sign="boat/raft"
      title={t('account.blocked.title')}
      tall
      onBack={e.back}
      onClose={e.home}
    >
      <Txt kind="meta">{t('account.blocked.description')}</Txt>
      {visibleLoading ? (
        <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
          {t('account.blocked.loading')}
        </Txt>
      ) : visibleError ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Txt style={{ color: C.danger }}>{visibleError}</Txt>
          <Btn small kind="sec" title={t('common.retry')} onPress={load} />
        </View>
      ) : items.length ? (
        <SheetGroup flat>
          {items.map((item) => (
            <SheetRow
              key={item.id}
              title={item.name}
              tail={
                <Btn
                  small
                  kind="sec"
                  title={
                    busyId === item.id
                      ? t('account.blocked.unblocking')
                      : t('account.blocked.unblock')
                  }
                  disabled={busyId !== null}
                  onPress={() => unblock(item)}
                />
              }
            />
          ))}
        </SheetGroup>
      ) : (
        <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
          {t('account.blocked.empty')}
        </Txt>
      )}
    </IslandSheet>
  );
}
