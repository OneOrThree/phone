import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { renderFriendScreens } from '../friends/FriendScreens';
import { renderSoundScreen } from '../music/SoundScreen';
import { renderObservatoryScreens } from '../observatory/ObservatoryScreens';
import { renderEntryScreens } from '../onboarding/EntryScreens';
import { renderSettingsScreens } from '../settings/SettingsScreens';
import { renderShopScreens } from '../shop/ShopScreens';
import { renderWardrobeScreen } from '../wardrobe/WardrobeScreen';
import { renderHomeScreens } from './HomeScreens';
import { renderVisitScreens } from './VisitScreens';
import { renderBoatScreens } from './membership/BoatScreens';
import { renderMembershipScreens } from './membership/MembershipScreens';
import { renderScreenFallback } from './navigation/ScreenFallback';
import { useScreenState } from './navigation/useScreenState';

const renderers = [
  renderEntryScreens,
  renderMembershipScreens,
  renderHomeScreens,
  renderSoundScreen,
  renderObservatoryScreens,
  renderVisitScreens,
  renderShopScreens,
  renderBoatScreens,
  renderWardrobeScreen,
  renderFriendScreens,
  renderSettingsScreens,
  renderScreenFallback,
];
export function RedesignScreens({ e }: ScreenProps) {
  const context = useScreenState(e);
  for (const render of renderers) {
    const screen = render(context);
    if (screen !== undefined) return screen;
  }
  return null;
}
