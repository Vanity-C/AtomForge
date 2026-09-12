import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium,expect}=require('@playwright/test');
const browser=await chromium.launch({headless:true,channel:'msedge'});
// Run against a local AtomForge frontend. Every API and OAuth response is mocked.
const origin=process.env.AUTH_TEST_ORIGIN||'http://127.0.0.1:15173';
await mkdir('node_modules/.auth-check',{recursive:true});
const user={id:'isolated-auth-user',email:'fixture@example.test',display_name:'测试用户',username:'测试用户'};
let ready=false;const starts=[];const exchanges=[];const forms=[];const errors=[];
async function setup(page){
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());const pathname=url.pathname;const data=route.request().method()==='POST'?route.request().postDataJSON():{};
  if(pathname.endsWith('/oauth/providers'))return route.fulfill({json:{items:['github','gitee'].map(id=>({id,name:id==='github'?'GitHub':'Gitee',configured:ready,connected:false,login:'',publish_authorized:false,callback_url:origin+'/api/v1/af-auth/oauth/'+id+'/callback'}))}});
  if(pathname.endsWith('/username-availability'))return route.fulfill({json:{available:true}});
  if(pathname==='/api/v1/studio/agents')return route.fulfill({status:503,json:{detail:'测试使用默认团队'}});
  if(pathname.endsWith('/login')||pathname.endsWith('/register')){
    forms.push({pathname,data});
    if(data.password==='wrong-password')return route.fulfill({status:401,json:{detail:'用户名或密码不正确'}});
    return route.fulfill({json:{access_token:'isolated-auth-token',user}});
  }
  if(pathname.endsWith('/oauth/exchange')){exchanges.push(data);return route.fulfill({json:{access_token:'isolated-oauth-token',user,redirect:'/p/5'}});}
  if(pathname.endsWith('/start')){const provider=pathname.split('/').at(-2);starts.push({provider,data});return route.fulfill({json:{url:'https://'+(provider==='github'?'github.com/login':'gitee.com')+'/oauth/authorize?client_id=isolated&state=fixture'}});}
  if(pathname.endsWith('/me'))return route.fulfill({json:{user}});
  return route.fulfill({json:{items:[]}});
 });
 await page.route('https://github.com/login/oauth/authorize?*',route=>route.fulfill({contentType:'text/html',body:'<h1>GitHub test consent</h1>'}));
 await page.route('https://gitee.com/oauth/authorize?*',route=>route.fulfill({contentType:'text/html',body:'<h1>Gitee test consent</h1>'}));
}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await setup(page);
 await page.goto(origin+'/auth?redirect=/p/5');
 await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
 await expect(page.getByText('GitHub / Gitee 暂未开通，邮箱登录与注册可正常使用。')).toBeVisible();
 await expect(page.getByRole('button',{name:'使用 GitHub 继续',exact:true})).toHaveAttribute('aria-disabled','true');
 await page.screenshot({path:'node_modules/.auth-check/login.png',fullPage:true});
 await page.getByLabel('用户名或邮箱',{exact:true}).fill('fixture');await page.getByLabel('密码',{exact:true}).fill('wrong-password');
 await page.getByRole('button',{name:'显示密码',exact:true}).click();await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('用户名或密码不正确');
 await page.getByRole('button',{name:'创建账号',exact:true}).click();
 await expect(page.getByRole('heading',{name:'开启你的创作'})).toBeVisible();
 await page.screenshot({path:'node_modules/.auth-check/register.png',fullPage:true});
 await page.getByLabel('用户名',{exact:true}).fill('测试用户');await page.getByLabel('邮箱',{exact:true}).fill('fixture@example.test');await page.getByLabel('密码',{exact:true}).fill('Password123!');
 await page.getByRole('button',{name:'创建账号',exact:true}).click();await page.waitForURL('**/p/5');
 if(!forms.some(f=>f.pathname.endsWith('/register')&&f.data.email==='fixture@example.test'))throw Error('Register did not submit');
 await page.close();
 ready=true;
 for(const provider of ['github','gitee']){
  const tab=await browser.newPage({viewport:{width:1440,height:1000}});await setup(tab);await tab.goto(origin+'/auth?redirect=/p/5');
  await tab.getByRole('button',{name:'使用 '+(provider==='github'?'GitHub':'Gitee')+' 继续',exact:true}).click();
  await tab.waitForURL('https://'+(provider==='github'?'github.com/login':'gitee.com')+'/oauth/authorize?**');
  await tab.goto(origin+'/auth/callback?ticket=isolated-'+provider+'-ticket-1234567890');await tab.waitForURL('**/p/5');
  await tab.close();
 }
 const denied=await browser.newPage({viewport:{width:1440,height:1000}});await setup(denied);await denied.goto(origin+'/auth/callback?error='+encodeURIComponent('授权已取消，请重新选择登录方式'));
 await expect(denied.getByRole('heading',{name:'授权尚未完成'})).toBeVisible();await expect(denied.getByRole('link',{name:'返回登录 →'})).toBeVisible();await denied.close();
 if(starts.length!==2||starts.some(s=>s.data.redirect!=='/p/5'||s.data.purpose!=='login')||exchanges.length!==2)throw Error('OAuth handoff mismatch');
 for(const confirm of [true,false]){
  const tab=await browser.newPage({viewport:{width:1440,height:1000}});await setup(tab);
  await tab.addInitScript(()=>localStorage.setItem('atomforge.session.token','isolated-auth-token'));
  let resolves=0;
  await tab.route('**/oauth/exchange',route=>route.fulfill({json:{status:'confirmation_required',provider:'github',login:'octo',target_name:'当前测试账号'}}));
  await tab.route('**/oauth/transfer',route=>{
    const data=route.request().postDataJSON();resolves++;
    if(data.confirm!==confirm||route.request().headers()['x-atomforge-token']!=='isolated-auth-token')throw Error('Transfer must carry current user and explicit decision');
    if(confirm&&resolves===1)return route.fulfill({status:409,json:{detail:'原账号正在使用 GitHub 发布项目，请等待发布完成后再次确认'}});
    return route.fulfill({json:{redirect:'/account',transferred:confirm}});
  });
  await tab.goto(origin+'/auth/callback?ticket=isolated-transfer-'+confirm+'-1234567890');
  try{await expect(tab.getByRole('heading',{name:'将 GitHub 连接到此账号？'})).toBeVisible();}
  catch(error){console.error('Transfer page:',tab.url(),await tab.locator('body').innerText(),errors);throw error;}
  await expect(tab.getByText('GitHub @octo',{exact:true})).toBeVisible();
  if(resolves!==0)throw Error('Transfer happened without confirmation');
  if(confirm)await tab.screenshot({path:'node_modules/.auth-check/transfer.png',fullPage:true});
  const action=tab.getByRole('button',{name:confirm?'确认转移并连接':'取消，保留原绑定',exact:true});
  await action.click();
  if(confirm){await expect(tab.getByRole('alert')).toContainText('请等待发布完成');await action.click();}
  await tab.waitForURL('**/account');await tab.close();
 }
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: login/register, OAuth exchanges, explicit GitHub transfer confirmation, cancellation and retry. All external responses isolated.');
}finally{await browser.close();}
