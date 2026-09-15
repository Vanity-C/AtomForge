// Isolated browser regression: no real accounts, model calls or settings writes.
import {createServer} from 'vite';
import {chromium, expect} from '@playwright/test';
const server = await createServer({server: {host: '127.0.0.1', port: 15437}});
await server.listen();
const browser = await chromium.launch({headless: true, channel: 'msedge'});
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({viewport: {width, height: 900}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let settings = {provider: 'deepseek', model: 'deepseek-flash', temperature_pct: 35, auto_preview: true};
    let fail = false, failLoad = false, release;
    const writes = [];
    await page.addInitScript(() => localStorage.setItem('atomforge.session.token', 'fixture-token'));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname;
      if (endpoint.endsWith('/af-auth/me')) return route.fulfill({json: {user: {id: 'fixture', display_name: '测试用户', email: 'fixture@example.test'}}});
      if (endpoint.endsWith('/af/settings')) {
        if (route.request().method() === 'PUT') {
          writes.push(route.request().postDataJSON());
          await new Promise(resolve => { release = resolve; });
          if (fail) return route.fulfill({status: 503, json: {detail: '模拟保存失败'}});
          settings = writes.at(-1);
        } else if (failLoad) return route.fulfill({status: 503, json: {detail: '模拟加载失败'}});
        return route.fulfill({json: {settings}});
      }
      if (endpoint.endsWith('/studio/models')) return route.fulfill({json: {providers: [], items: [
        {id: 'deepseek-v4-pro', label: 'DeepSeek Pro', provider: 'deepseek', traits: [], note: '复杂需求'},
        {id: 'deepseek-flash', label: 'DeepSeek Flash', provider: 'deepseek', traits: ['版本推荐', '性价比首选'], note: '推荐'},
        {id: 'gpt-unavailable', label: '不可用模型', provider: 'codex', traits: [], note: '', available: false},
      ]}});
      if (endpoint.endsWith('/studio/usage')) return route.fulfill({json: {input_tokens: 0, output_tokens: 0, projects: [], scope: ''}});
      if (endpoint.endsWith('/studio/budget')) return route.fulfill({json: {token_limit: 0, used_tokens: 0, month: '2026-09', estimated_cost: 0, prices: {}}});
      return route.fulfill({json: {items: []}});
    });
    await page.goto(server.resolvedUrls.local[0] + 'settings');
    const flash = page.getByRole('button', {name: /DeepSeek Flash deepseek-flash/});
    const pro = page.getByRole('button', {name: /DeepSeek Pro deepseek-v4-pro/});
    const save = page.getByRole('button', {name: '保存其他设置'});
    const preview = page.getByRole('switch', {name: '生成后自动切到预览'});
    await expect(flash).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', {name: /不可用模型/})).toBeDisabled();
    await preview.click(); // An unsaved draft must not be committed with the model.
    await pro.click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(pro).toHaveAttribute('aria-busy', 'true');
    await expect(save).toBeDisabled();
    await expect(flash).toBeDisabled();
    expect(writes[0]).toMatchObject({model: 'deepseek-v4-pro', auto_preview: true});
    release();
    await expect(pro).toHaveAttribute('aria-pressed', 'true');
    await expect(preview).not.toBeChecked();
    await pro.click();
    expect(writes.length).toBe(1); // Clicking the selected model does not write again.
    await save.click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({model: 'deepseek-v4-pro', auto_preview: false});
    release();
    await expect(save).toBeEnabled();
    await page.reload();
    await expect(pro).toHaveAttribute('aria-pressed', 'true');
    await expect(preview).not.toBeChecked();
    fail = true;
    await flash.click();
    await expect.poll(() => writes.length).toBe(3);
    release();
    await expect(page.getByText('模型切换失败，仍使用原模型', {exact: true})).toBeVisible();
    await expect(pro).toHaveAttribute('aria-pressed', 'true');
    await expect(flash).toHaveAttribute('aria-pressed', 'false');
    fail = false;
    await flash.click();
    await expect.poll(() => writes.length).toBe(4);
    release();
    await expect(flash).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    failLoad = true;
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('模拟加载失败');
    await expect(flash).toBeDisabled();
    await expect(save).toBeDisabled();
    failLoad = false;
    await page.getByRole('button', {name: '重新加载设置'}).click();
    await expect(flash).toBeEnabled();
    expect(errors).toEqual([]);
    await page.close();
  }
  console.log('PASS: desktop/mobile automatic model persistence, reload, failure recovery, duplicate-click lock, draft isolation, unavailable models and load retry.');
} finally {
  await browser.close();
  await server.close();
}
