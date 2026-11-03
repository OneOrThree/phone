import { IslandSheet } from '@/screens/island/IslandSheet';

export function Sheet({
  e,
  title,
  bg = 'dock',
  sign = 'boat/raft',
  children,
  footer,
  action,
  actionPress,
  tall = true,
  onClose,
  onBack,
}: any) {
  return (
    <IslandSheet
      bg={bg}
      sign={sign}
      title={title}
      tall={tall}
      onBack={onBack ?? e.back}
      onClose={onClose ?? e.home}
      action={action}
      actionPress={actionPress}
      footer={footer}
    >
      {children}
    </IslandSheet>
  );
}
