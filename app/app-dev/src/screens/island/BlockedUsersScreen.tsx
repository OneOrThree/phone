import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Btn, C, Txt } from '@/design-system/patterns';
import { IslandSheet, SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import { unblockUser, type BlockedUser } from '@/services/api/safety';
import { markUserUnblocked, refreshBlockedUsers } from '@/services/blockedUsers';

export function BlockedUsersScreen({ e }: any) {
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const seq = ++sequence.current;
    const generation = sessionGeneration();
    setLoading(true);
    setError('');
    try {
      const next = await refreshBlockedUsers();
      if (seq !== sequence.current || generation !== sessionGeneration()) return;
      setItems(next);
    } catch (thrown) {
      if (seq !== sequence.current || generation !== sessionGeneration()) return;
      if (thrown instanceof ApiError && thrown.code === CLIENT_STALE_SESSION) return;
      setError(thrown instanceof ApiError ? thrown.message : '차단 목록을 불러오지 못했어요.');
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);

  const unblock = async (item: BlockedUser) => {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    try {
      await unblockUser(item.id);
      markUserUnblocked(item.id);
      await load();
      e.friendsScreen?.refresh?.();
      e.notify(`${item.name}님의 차단을 해제했어요.`);
    } catch (thrown) {
      setError(thrown instanceof ApiError ? thrown.message : '차단을 해제하지 못했어요.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <IslandSheet
      bg="dock"
      sign="boat/raft"
      title="차단한 사용자"
      tall
      onBack={e.back}
      onClose={e.home}
    >
      <Txt kind="meta">
        차단한 사용자의 친구 요청과 편지는 내 화면에서 숨겨져요. 차단 중 받은 내용은 해제하면 다시
        보일 수 있어요.
      </Txt>
      {loading ? (
        <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
          불러오는 중…
        </Txt>
      ) : error ? (
        <View style={{ gap: 12, paddingVertical: 16 }}>
          <Txt style={{ color: C.danger }}>{error}</Txt>
          <Btn small kind="sec" title="다시 시도" onPress={load} />
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
                  title={busyId === item.id ? '해제 중…' : '차단 해제'}
                  disabled={busyId !== null}
                  onPress={() => unblock(item)}
                />
              }
            />
          ))}
        </SheetGroup>
      ) : (
        <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
          차단한 사용자가 없어요.
        </Txt>
      )}
    </IslandSheet>
  );
}
