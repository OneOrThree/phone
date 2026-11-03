import { boardArtifacts } from './board/Board';
import { hallArtifacts } from './hall/artifacts';
import { MailHome } from './mail/MailHome';
import { IslandRanking, ObservatoryDesk, OldMap } from './observatory/Observatory';
import { shopGramArtifacts } from './shop/ShopGram';
import { ArtifactRenderer } from './types';

const observatoryMailArtifacts: Record<string, ArtifactRenderer> = {
  'observatory-desk': ObservatoryDesk,
  'island-ranking': IslandRanking,
  'old-map': OldMap,
  'mail-home': MailHome,
  'received-letters': MailHome,
  'letter-detail': MailHome,
  'friend-select': MailHome,
  'friend-compose': MailHome,
};

export const artifacts: Record<string, ArtifactRenderer> = {
  ...hallArtifacts,
  ...boardArtifacts,
  ...observatoryMailArtifacts,
  ...shopGramArtifacts,
};
