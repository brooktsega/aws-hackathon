// Opens the dashboard in a tab, focusing the existing one if it is already open (R8.1).
// Uses runtime.getContexts (Chrome 116+), which needs no extra permission to find our own tabs.

export interface DashboardApi {
  runtime: {
    getURL(path: string): string;
    getContexts(filter: { contextTypes: string[]; documentUrls: string[] }): Promise<{ tabId?: number; windowId?: number }[]>;
  };
  tabs: {
    create(props: { url: string }): Promise<unknown>;
    update(tabId: number, props: { active: boolean }): Promise<unknown>;
  };
  windows: { update(windowId: number, props: { focused: boolean }): Promise<unknown> };
}

export async function openOrFocusDashboard(api: DashboardApi = chrome as unknown as DashboardApi): Promise<void> {
  const url = api.runtime.getURL('dashboard/index.html');
  try {
    const [existing] = await api.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    if (existing?.tabId !== undefined && existing.tabId >= 0) {
      await api.tabs.update(existing.tabId, { active: true });
      if (existing.windowId !== undefined && existing.windowId >= 0) await api.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    // Fall through and open a new tab.
  }
  await api.tabs.create({ url });
}
