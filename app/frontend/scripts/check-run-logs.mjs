import {mkdir} from 'node:fs/promises';
import {createCheckServer} from './browser-check-server.mjs';
import {chromium,expect} from '@playwright/test';

const server=await createCheckServer();
const address=server.httpServer.address();
const output='node_modules/.run-log-check';
await mkdir(output,{recursive:true});
let browser;
const errors=[];
try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1100}});
    page.on('pageerror',error=>errors.push(error.message));
    // Isolated credentials only; every API request in this fixture is intercepted.
    await page.addInitScript(()=>localStorage.setItem('atomforge.session.token','isolated-log-fixture'));
    const makeEvent=id=>({id,stage:'test',role:'qa',message:`执行记录 ${String(id).padStart(3,'0')}`,at:'2026-09-16T00:00:00Z'});
    const events=Array.from({length:350},(_,i)=>makeEvent(i+1));
    let fail=false;
    await page.route('**/api/v1/studio/runs/log-fixture/events?*',async route=>{
      if(fail){fail=false;await route.fulfill({status:500,json:{detail:'临时读取失败'}});return;}
      const before=new URL(route.request().url()).searchParams.get('before');
      const eligible=events.filter(event=>before===null||event.id<Number(before));
      const items=eligible.slice(-100);
      await route.fulfill({json:{items,total:events.length,has_more:eligible.length>100,next_before:eligible.length>100?items[0].id:null}});
    });
    await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/run-log.html`);
    await page.getByText('执行日志（已保存 350 条）',{exact:true}).click();
    const panel=page.getByLabel('执行日志历史',{exact:true});
    await expect(panel.locator('li')).toHaveCount(100);
    await expect(panel.locator('li').first()).toContainText('执行记录 251');
    await panel.getByRole('button',{name:'查看更早',exact:true}).click();
    await expect(panel.locator('li').first()).toContainText('执行记录 151');
    events.push(makeEvent(351));
    await page.getByRole('button',{name:'新增日志',exact:true}).click();
    await expect(panel.locator('li').first()).toContainText('执行记录 151');
    await panel.getByRole('button',{name:'查看更早',exact:true}).click();
    await expect(panel.locator('li').first()).toContainText('执行记录 051');
    await panel.getByRole('button',{name:'查看更早',exact:true}).click();
    await expect(panel.locator('li').first()).toContainText('执行记录 001');
    await expect(panel.locator('li')).toHaveCount(50);
    await expect(panel.getByRole('button',{name:'查看更早',exact:true})).toBeDisabled();
    await panel.getByRole('button',{name:'查看更新',exact:true}).click();
    await expect(panel.locator('li').first()).toContainText('执行记录 051');
    await page.screenshot({path:`${output}/history-${width}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await panel.getByRole('button',{name:'回到最新',exact:true}).click();
    await expect(panel.locator('li').last()).toContainText('执行记录 351');
    fail=true;
    await panel.getByRole('button',{name:'查看更早',exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText('临时读取失败');
    await panel.getByRole('button',{name:'重试',exact:true}).click();
    await expect(panel.locator('li')).toHaveCount(100);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await page.reload();
    await page.locator('summary').click();
    await expect(page.getByLabel('执行日志历史',{exact:true}).locator('li').last()).toContainText('执行记录 351');
    await page.close();
  }
  expect(errors).toEqual([]);
  console.log('Execution log browser checks passed at 1440px and 390px: 350+ records, pagination, live appends, reload and retry.');
}finally{
  if(browser)await browser.close();
  await server.close();
}
