import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin=process.env.AUTH_TEST_ORIGIN||'http://127.0.0.1:15173';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  await mkdir('node_modules/.delivery-check',{recursive:true});
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let body;
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('atomforge.session.token','isolated-fixture-token'));
    await page.route('**/api/**',route=>{body=route.request().postDataJSON();return route.fulfill({json:{revision:1}});});
    await page.goto(origin+'/scripts/fixtures/delivery-board.html');
    try{await expect(page.getByRole('region',{name:'团队双层看板'})).toBeVisible();}
    catch(error){console.error('Fixture rendering errors:',errors,await page.locator('body').innerText());throw error;}
    await expect(page.locator('.delivery-column')).toHaveCount(7);
    await expect(page.locator('.delivery-card')).toHaveCount(5);
    await expect(page.getByRole('heading',{name:'实现任务筛选',exact:true})).toBeVisible();
    await expect(page.getByText('切换筛选后只显示对应状态的任务',{exact:true})).toBeVisible();
    await page.screenshot({path:`node_modules/.delivery-check/delivery-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'领导战略看板',exact:true}).click();
    await page.getByLabel('工作包 SLA（分钟）',{exact:true}).fill('8');
    await page.getByLabel('调整原因',{exact:true}).fill('缩短等待观察窗口');
    await page.getByRole('button',{name:'保存战略调整',exact:true}).click();
    await expect(page.getByRole('button',{name:'策略已保存',exact:true})).toBeDisabled();
    expect(body.sla_minutes).toBe(8);expect(body.revision).toBe(0);
    await page.screenshot({path:`node_modules/.delivery-check/strategy-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'模拟结束任务',exact:true}).click();
    await expect(page.getByRole('button',{name:'本轮策略已归档',exact:true})).toBeDisabled();
    expect(errors).toEqual([]);await page.close();
  }
  console.log('PASS: desktop/mobile delivery columns, card details, strategic changes and terminal read-only policy. All data isolated.');
}finally{await browser.close();}
