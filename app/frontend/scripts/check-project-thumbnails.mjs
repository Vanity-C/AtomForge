import {chromium, expect} from '@playwright/test';

// Isolated gallery fixture: no real accounts, projects or runner work.
const origin=process.env.AUTH_TEST_ORIGIN||'http://127.0.0.1:15173';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1200}});
  const user={id:'thumbnail-check',username:'预览测试',display_name:'预览测试',email:'preview@example.test'};
  const projects=Array.from({length:6},(_,i)=>({id:i+1,name:`预览测试 ${i+1}`,description:'',initial_prompt:'',agent_mode:'build',status:'ready',current_version:1,updated_at:'2026-09-13T08:00:00Z',role:'owner'}));
  const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e8ebe4"/><text x="80" y="220" font-size="40">Preview test fixture</text></svg>');
  const errors=[],reads=[];
  let active=0,peak=0,releaseCapture;
  const capture=new Promise(resolve=>{releaseCapture=resolve;});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(user=>{
    localStorage.setItem('atomforge.session.token','thumbnail-test-token');
    localStorage.setItem('atomforge.session.user',JSON.stringify(user));
  },user);
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/af-auth/me'))return route.fulfill({json:{user}});
    if(url.pathname==='/api/v1/af/projects')return route.fulfill({json:{items:projects}});
    if(url.pathname.endsWith('/thumbnail')){
      const id=Number(url.pathname.split('/').at(-2)),cached=url.searchParams.has('cached_only');
      reads.push({id,cached});active++;peak=Math.max(peak,active);
      if(id===6&&!cached)await capture;else await new Promise(resolve=>setTimeout(resolve,200));
      active--;
      return route.fulfill({json:id===6&&cached?{status:'pending',version:1}:{status:'ready',version:1,src}});
    }
    return route.fulfill({json:{items:[]}});
  });
  await page.goto(origin+'/dashboard?view=projects');
  await expect(page.locator('.project-cover img')).toHaveCount(5);
  // The missing cover is deliberately held; ready covers must already be visible.
  expect(reads.some(r=>r.id===6&&!r.cached)).toBeTruthy();
  expect(peak).toBeGreaterThan(1);
  releaseCapture();
  await expect(page.locator('.project-cover img')).toHaveCount(6);
  const coldReads=reads.length;
  await page.getByRole('link',{name:'灵感',exact:true}).click();
  await page.getByRole('link',{name:'我的项目',exact:true}).click();
  await expect(page.locator('.project-cover img')).toHaveCount(6);
  expect(reads.length).toBe(coldReads);
  await page.getByRole('textbox',{name:'搜索项目',exact:true}).fill('不存在');
  await expect(page.locator('.project-cover img')).toHaveCount(0);
  await page.getByRole('button',{name:'清空搜索',exact:true}).click();
  await expect(page.locator('.project-cover img')).toHaveCount(6);
  expect(reads.length).toBe(coldReads);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({result:'PASS',projects:6,peakParallelRequests:peak,coldReads,routeReturnAdditionalReads:reads.length-coldReads,slowCaptureDoesNotBlockReadyCovers:true}));
} finally {await browser.close();}
