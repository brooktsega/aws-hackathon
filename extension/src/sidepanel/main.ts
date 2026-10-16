import '../styles/app.css';
import { send } from '../shared/client';
import { openOrFocusDashboard } from '../shared/open-dashboard';
import { readCollections, subscribeCollections } from '../shared/ui-state';
import { createApp } from './app';
import { readActiveViewState, watchActiveViewState } from './context';

const root = document.getElementById('app');
if (root) {
  const app = createApp({
    send,
    readCollections,
    subscribeCollections,
    readViewState: readActiveViewState,
    watchViewState: watchActiveViewState,
    openDashboard: () => void openOrFocusDashboard(),
  });
  root.replaceChildren(app.element);
}
