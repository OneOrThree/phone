import { View } from 'react-native';
import { fill } from '../shared/styles';
import { ArtifactRenderer } from '../types';
import { BuildingFlow } from './Construction';
import { HallDesk } from './HallDesk';
import { IslandManagement } from './IslandManagement';
import { Ledger } from './Ledger';

export const hallArtifacts: Record<string, ArtifactRenderer> = {
  'hall-desk': (props) => <HallDesk {...props} />,
  'building-models': (props) => <BuildingFlow {...props} />,
  'building-blueprint': (props) => <BuildingFlow {...props} />,
  'village-ledger': (props) => <Ledger {...props} />,
  // 섬 정보 · 주민 · 가입 신청 세 시안이 같은 kind라 시안이 바뀌면 새로 그린다
  'island-management': (props) => (
    <View key={props.index} style={fill}>
      <IslandManagement
        width={props.width}
        isStatic
        initialTab={props.concept.managementTab ?? 'info'}
        shown
        reduceMotion={props.reduceMotion}
        showToast={props.showToast}
        onClose={() => {}}
      />
    </View>
  ),
};
