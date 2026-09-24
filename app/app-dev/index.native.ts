import { registerRootComponent } from 'expo';
import App from './src/App';
import { initDatadog } from './src/services/datadog';
import { initPostHog } from './src/services/posthog';

initDatadog();
initPostHog();

registerRootComponent(App);
