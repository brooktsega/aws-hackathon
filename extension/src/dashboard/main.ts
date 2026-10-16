import '../styles/app.css';
import { send } from '../shared/client';
import { readCollections, subscribeCollections } from '../shared/ui-state';
import { createDashboard } from './app';
import { downloadCsv } from './csv';

const root = document.getElementById('app');
if (root) {
  const dashboard = createDashboard({
    send,
    readCollections,
    subscribeCollections,
    now: () => Date.now(),
    download: downloadCsv,
  });
  root.replaceChildren(dashboard.element);
}
