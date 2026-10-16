import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../public/manifest.json'), 'utf8'),
) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('manifest.json (R1)', () => {
  it('is Manifest V3 with a module service worker as the only background context (R1.1)', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({
      service_worker: 'background/service-worker.js',
      type: 'module',
    });
  });

  it('injects the content script only on mail.google.com (R1.2)', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual(['https://mail.google.com/*']);
  });

  it('limits host permissions to Gmail and the Anthropic API (R1.3)', () => {
    expect([...manifest.host_permissions].sort()).toEqual([
      'https://api.anthropic.com/*',
      'https://mail.google.com/*',
    ]);
  });

  it('requests only the four allowed permissions (R1.4)', () => {
    expect([...manifest.permissions].sort()).toEqual([
      'alarms',
      'notifications',
      'sidePanel',
      'storage',
    ]);
  });

  it('uses a restrictive CSP with no remote code (R1.5, R11.6)', () => {
    const csp: string = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/https?:|unsafe-eval|unsafe-inline/);
  });

  it('declares the side panel and a toolbar action (R1.6)', () => {
    expect(manifest.side_panel.default_path).toBe('sidepanel/index.html');
    expect(manifest.action).toBeDefined();
  });
});
