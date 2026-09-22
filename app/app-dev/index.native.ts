import { registerRootComponent } from 'expo';
import App from './src/App';
import { initDatadog } from './src/services/datadog';

initDatadog();

registerRootComponent(App);
