import { registerRootComponent } from 'expo';

import App from './App';
import { startTelemetry } from './src/lib/telemetry';

// Before the app renders, so even a startup error is recorded.
startTelemetry();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
