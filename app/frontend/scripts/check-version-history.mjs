import {mkdir, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium, expect} = require('@playwright/test');

// All API responses are isolated fixtures; no real account or model is used.
const origin = process.env.WORKSPACE_TEST_ORIGIN || 'http://127.0.0.1:15174';
const output = 'node_modules/.version-history-check';
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true, channel: 'msedge'});
const errors = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({viewport: {width, height: 1000}, acceptDownloads: true});
    await context.addInitScript(() => {
      if (window.top === window) localStorage.setItem('atomforge.session.token', 'isolated-version-token');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let project = {id: 42, name: '版本回归', agent_mode: 'build', status: 'ready', current_version: 2,
      entry_file: 'App.tsx', role: 'owner', is_public: false, share_slug: '', view_count: 0};
    const snapshot = text => [{path: 'App.tsx', language: 'tsx', content: `export default function App(){return <h1>${text}</h1>}`}];
    const versions = [2, 1].map(version => ({id: version, project_id: 42, version,
      summary: `snapshot ${version}`, files_snapshot: JSON.stringify(snapshot(`version ${version}`)), source: 'manual_edit'}));
    const messages = [];
    const rollbacks = [];
    let exported = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      const json = body => route.fulfill({json: body});
      if (path.endsWith('/af-auth/me')) return json({user: {id: 'isolated-version-user', display_name: '测试用户', username: 'fixture'}});
      if (path === '/api/v1/studio/agents') return route.fulfill({status: 503, json: {detail: 'Use fixture fallback'}});
      if (path === '/api/v1/af/projects/42') return json({project});
      if (path.endsWith('/projects/42/files')) return json({items: snapshot(`version ${project.current_version}`)});
      if (path.endsWith('/projects/42/versions')) return json({items: versions});
      if (path.endsWith('/projects/42/rollback')) {
        const data = route.request().postDataJSON();
        expect(data).toEqual({version_id: 1, expected_version: 2});
        rollbacks.push(data);
        project = {...project, current_version: 1};
        return json({version: 1, files: snapshot('version 1'), project});
      }
      if (path.endsWith('/projects/42/messages')) {
        if (method === 'POST') {
          const message = {id: messages.length + 1, ...route.request().postDataJSON()};
          messages.push(message);
          return json({message});
        }
        return json({items: messages});
      }
      if (path.endsWith('/projects/42/share')) {
        project = {...project, is_public: method === 'POST', share_slug: 'version-fixture'};
        return json({project});
      }
      if (path.endsWith('/projects/42/export')) {
        exported++;
        return json({entries: snapshot(`version ${project.current_version}`)});
      }
      if (path.endsWith('/artifact')) return json({artifact: null, cloud_slug: null});
      if (path.endsWith('/build')) return json({ok: true});
      if (path.endsWith('/cloud')) return json({enabled: false, collections: {}, slug: ''});
      return json({items: []});
    });

    await page.goto(origin + '/p/42');
    await expect(page.getByRole('button', {name: '版本历史', exact: true})).toBeVisible();
    await page.getByRole('button', {name: '版本历史', exact: true}).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', {name: '回滚到此版本'})).toHaveCount(2);
    await expect(dialog.getByRole('button', {name: '回滚到此版本'}).first()).toBeDisabled();
    await dialog.getByRole('button', {name: '回滚到此版本'}).nth(1).click();
    await expect(dialog).toBeHidden();
    expect(rollbacks).toHaveLength(1);
    expect(messages[0].content).toBe('已回滚到 v1，历史版本保持不变。');
    expect(messages[0].version).toBe(1);

    await page.reload();
    await page.getByRole('button', {name: '版本历史', exact: true}).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', {name: '回滚到此版本'})).toHaveCount(2);
    await expect(dialog.getByRole('button', {name: '回滚到此版本'}).first()).toBeEnabled();
    await expect(dialog.getByRole('button', {name: '回滚到此版本'}).nth(1)).toBeDisabled();
    await page.screenshot({path: `${output}/history-${width}.png`});
    await page.keyboard.press('Escape');

    await page.getByRole('button', {name: '分享', exact: true}).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', {name: '公开分享'})).toBeVisible();
    await expect(dialog.getByText('导出源码', {exact: true})).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: /下载/})).toHaveCount(0);
    await dialog.getByRole('switch').click();
    await expect(dialog.getByRole('textbox')).toHaveValue(origin + '/s/version-fixture');
    await expect(dialog.getByRole('button', {name: '复制', exact: true})).toBeVisible();
    await page.screenshot({path: `${output}/share-${width}.png`});
    await page.keyboard.press('Escape');

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', {name: '导出源码', exact: true}).click();
    const download = await downloading;
    await download.saveAs(`${output}/export-${width}.zip`);
    expect((await stat(`${output}/export-${width}.zip`)).size).toBeGreaterThan(0);
    expect(exported).toBe(1);
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log('Workspace browser checks passed at 1440px and 390px: rollback, refresh, share and ZIP export.');
} finally {
  await browser.close();
}
