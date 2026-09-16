import {mkdir} from 'node:fs/promises';
import {createCheckServer} from './browser-check-server.mjs';
import {chromium,expect} from '@playwright/test';

const server=await createCheckServer();
const output='node_modules/.test-limits-check';
await mkdir(output,{recursive:true});
let browser;
try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1100}});
    const errors=[],saved=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('atomforge.session.token','isolated-test-limits-fixture'));
    await page.route('**/api/v1/studio/runs/qa-fixture/strategy',async route=>{
      saved.push(route.request().postDataJSON());
      await route.fulfill({json:{revision:2}});
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/qa-report.html`);
    await page.getByLabel('测试完整看板').check();
    await page.getByRole('button',{name:'领导战略看板',exact:true}).click();
    const limit=page.getByLabel('测试步骤上限',{exact:true});
    await expect(limit).toHaveValue('1000');
    await limit.fill('10001');
    expect(await limit.evaluate(input=>input.validity.rangeOverflow)).toBe(true);
    await limit.fill('1');
    expect(await limit.evaluate(input=>input.validity.rangeUnderflow)).toBe(true);
    await limit.fill('1500');
    await page.getByLabel('调整原因',{exact:true}).fill('完整执行长测试计划');
    await page.locator('form').getByRole('button',{name:/保存/}).click();
    await expect.poll(()=>saved.length).toBe(1);
    await expect(page.locator('form').getByRole('button',{name:'策略已保存',exact:true})).toBeVisible();
    expect(saved[0]).toMatchObject({max_test_steps:1500,min_tests:2,revision:1,reason:'完整执行长测试计划'});
    expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`${output}/strategy-${width}.png`,fullPage:true});
    await page.close();
  }
  console.log('Test-step strategy checks passed at 1440px and 390px: default, bounds and PATCH payload.');
}finally{
  if(browser)await browser.close();
  await server.close();
}
