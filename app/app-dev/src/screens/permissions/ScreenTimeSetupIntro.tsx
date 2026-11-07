import { Modal } from 'react-native';
import { IslandPopup } from '@/screens/island/IslandSheet';
import { FocusBlockingGuide } from '@/screens/focus/FocusBlockingGuide';
import { useScreenTimeSetup, type ScreenTimeSetupProps } from './useScreenTimeSetup';

/** 집중 화면과 폰 사용 기록이 같은 안내·설정·계정 이력을 사용한다. */
export function ScreenTimeSetupIntro(props: ScreenTimeSetupProps) {
  const { busy, error, setup, close } = useScreenTimeSetup(props);
  return (
    <Modal transparent animationType="fade" onRequestClose={() => void close()}>
      <IslandPopup onClose={() => void close()}>
        <FocusBlockingGuide busy={busy} error={error} onSetup={() => void setup()} />
      </IslandPopup>
    </Modal>
  );
}
