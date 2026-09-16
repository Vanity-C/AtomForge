import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
const address=server.httpServer.address();
const output='node_modules/.qa-report-check';
await mkdir(output,{recursive:true});
let browser;
const errors=[];
try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1100}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/qa-report.html`);
    const report=page.getByRole('region',{name:'集中验收报告'});
    await expect(report).toBeVisible();
    await expect(report.getByText('2. 刷新恢复 · 待执行',{exact:true})).toBeVisible();
    await page.getByLabel('报告状态').selectOption('failed');
    await expect(report.getByText('集中反馈 · 2 项',{exact:true})).toBeVisible();
    await expect(report.getByText('2. 刷新恢复 · 失败',{exact:true})).toBeVisible();
    await expect(report.getByText('3. 删除任务 · 阻塞 · 未执行',{exact:true})).toBeVisible();
    await report.getByText('2. 刷新恢复 · 失败',{exact:true}).click();
    await expect(report.getByText('刷新后找不到新增任务',{exact:true})).toBeVisible();
    await expect(report.getByText('外部支付条件未验证',{exact:true})).toBeVisible();
    await page.screenshot({path:`${output}/failed-${width}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByLabel('报告状态').selectOption('passed');
    await expect(report.getByText('源码审查与全部必需测试已通过。',{exact:true})).toBeVisible();
    await expect(report.getByText('集中反馈 · 2 项',{exact:true})).toHaveCount(0);
    await expect(report.getByText('3. 删除任务 · 通过',{exact:true})).toBeVisible();
    await page.getByLabel('报告状态').selectOption('legacy');
    await expect(report.getByText('1. 独立验收 · 待执行',{exact:true})).toBeVisible();
    await page.close();
  }
  expect(errors).toEqual([]);
  console.log('QA report browser checks passed at 1440px and 390px: partial, failed, blocked, passed and legacy reports.');
}finally{
  if(browser)await browser.close();
  await server.close();
}
