import { Route } from '@/services/model';

export const shouldGateScreenTimeBoard = (
  route: Route,
  options: { isIOS: boolean; promptSeen: boolean },
) => ['board', 'quest'].includes(route) && options.isIOS && !options.promptSeen;
