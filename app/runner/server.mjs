import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import Babel from '@babel/standalone';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'recharts', 'date-fns', 'clsx'];
const safeFile = /^(?!.*(?:\.\.|\\))[a-zA-Z0-9_][a-zA-Z0-9_./-]*\.(?:jsx?|tsx?|css|json)$/;
function transform(source, filename, visitor) {
  return Babel.transform(source,{filename,parserOpts:{sourceType:'module',plugins:['jsx',...(/\.tsx?$/.test(filename)?['typescript']:[])]},plugins:[({types:t})=>({visitor:{JSXOpeningElement(p){visitor(p,t);}}})]}).code;
}
export function visualEdit(files, selection) {
  const split=String(selection.source||'').lastIndexOf(':');
  const filename=selection.source?.slice(0,split);const offset=Number(selection.source?.slice(split+1));
  let changed=false;
  const style=selection.style||{};
  const allowed=['color','backgroundColor','fontSize','fontWeight','padding','margin','gap','borderRadius','textAlign','width','maxWidth'];
  if(Object.keys(style).some(k=>!allowed.includes(k)||typeof style[k]!=='string'||style[k].length>80||!/^[#a-zA-Z0-9 .%,()-]*$/.test(style[k])))throw Error('样式属性无效');
  const output=files.map(f=>{
    if(f.path!==filename)return f;
    const content=transform(f.content,f.path,(p,t)=>{
      if(p.node.start!==offset)return;
      if(!t.isJSXIdentifier(p.node.name)||! /^[a-z]/.test(p.node.name.name))throw Error('仅支持编辑 HTML 元素');
      changed=true;
      if(selection.text!==undefined){
        if(typeof selection.text!=='string'||selection.text.length>2000)throw Error('文字过长');
        const parent=p.parentPath.node;
        if(p.node.selfClosing||!parent.children.every(n=>t.isJSXText(n)||(t.isJSXExpressionContainer(n)&&t.isStringLiteral(n.expression))))throw Error('这个元素包含动态内容或子组件，请通过对话修改');
        parent.children=[t.jsxExpressionContainer(t.stringLiteral(selection.text))];
      }
      if(Object.keys(style).length){
        const old=p.node.attributes.find(a=>t.isJSXAttribute(a)&&a.name.name==='style');
        const props=[];
        if(old&&t.isJSXExpressionContainer(old.value))props.push(t.spreadElement(old.value.expression));
        props.push(...Object.entries(style).map(([k,v])=>t.objectProperty(t.identifier(k),t.stringLiteral(v))));
        const attr=t.jsxAttribute(t.jsxIdentifier('style'),t.jsxExpressionContainer(t.objectExpression(props)));
        if(old)p.node.attributes[p.node.attributes.indexOf(old)]=attr;else p.node.attributes.push(attr);
      }
    });return {...f,content};
  });
  if(!changed)throw Error('元素位置已变化，请刷新预览后重新选择');
  return output;
}
export const CLIENT = `
(() => {
  let seq = 0; const pending = new Map();
  window.addEventListener('message', e => {
    if (e.source !== parent || e.data?.source !== 'atomforge-cloud-response' || e.data?.channel !== window.__AF_CHANNEL__) return;
    const p = pending.get(e.data.id); if (!p) return;
    pending.delete(e.data.id); clearTimeout(p.timer);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
  });
  function call(action, data = {}) {
    if (window.__AF_TEST__) return window.__AF_TEST__(action, data);
    return new Promise((resolve,reject) => {
      const id = String(++seq); const timer = setTimeout(() => {pending.delete(id); reject(new Error('应用服务请求超时'));}, 95000);
      pending.set(id, {resolve,reject,timer});
      parent.postMessage({source:'atomforge-cloud-request',channel:window.__AF_CHANNEL__,id,action,data}, '*');
    });
  }
  window.AtomForge = {
    auth: {register:(email,password)=>call('register',{email,password}),login:(email,password)=>call('login',{email,password}),me:()=>call('me'),logout:()=>call('logout')},
    db: {list:(collection)=>call('list',{collection}),create:(collection,data)=>call('create',{collection,data}),update:(collection,id,data)=>call('update',{collection,id,data}),remove:(collection,id)=>call('remove',{collection,id})},
    ai: {chat:(prompt)=>call('ai',{prompt})},
    payments: {checkout:()=>call('checkout'),status:()=>call('payments')}
  };
})();`;

export async function compile(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 40) throw Error('文件数量必须为 1–40');
  const names = new Set(); let total = 0;
  for (const f of files) {
    if (!safeFile.test(f.path) || f.path.length > 200 || names.has(f.path) || typeof f.content !== 'string') throw Error('文件路径或内容无效');
    names.add(f.path); total += Buffer.byteLength(f.content);
    if (Buffer.byteLength(f.content) > 200000 || total > 1500000) throw Error('项目代码过大');
  }
  const entry = ['App.tsx','App.jsx','App.ts','App.js'].find(n=>names.has(n));
  if (!entry) throw Error('缺少 App.jsx 或 App.tsx 入口');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'af-jobs-'));
  try {
    for (const f of files) {const p=path.join(dir,f.path); await mkdir(path.dirname(p),{recursive:true}); await writeFile(p,f.content);}
    const css = files.filter(f=>f.path.endsWith('.css')).map(f=>`import ${JSON.stringify('./'+f.path)};`).join('\n');
    // A separate side-effect import initializes globals before any app module.
    // Static imports are evaluated before the entry module's own statements.
    await writeFile(path.join(dir,'.atomforge-runtime.js'),`import React from 'react'; Object.assign(globalThis,{React,...React}); ${CLIENT}`);
    const entryCode = `import './.atomforge-runtime.js'; import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './${entry}'; ${css}\ncreateRoot(document.getElementById('root')).render(React.createElement(App));`;
    const output = await build({stdin:{contents:entryCode,resolveDir:dir,loader:'jsx',sourcefile:'atomforge-entry.jsx'}, bundle:true,write:false,outdir:path.join(dir,'out'),format:'iife',platform:'browser',jsx:'automatic',nodePaths:[path.join(ROOT,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',minify:false,
      plugins:[{name:'project-imports',setup(b){
        b.onLoad({filter:/\.[jt]sx?$/},async args=>{
          if(!args.path.startsWith(dir+path.sep))return;
          const filename=path.relative(dir,args.path).replaceAll('\\','/');
          const source=await readFile(args.path,'utf8');
          const contents=transform(source,filename,(p,t)=>{
            if(t.isJSXIdentifier(p.node.name)&&/^[a-z]/.test(p.node.name.name)){
              p.node.attributes=p.node.attributes.filter(a=>!t.isJSXAttribute(a)||a.name.name!=='data-af-source');
              p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-af-source'),t.stringLiteral(filename+':'+p.node.start)));
            }
          });
          return {contents,loader:/\.tsx?$/.test(filename)?'tsx':'jsx',resolveDir:path.dirname(args.path)};
        });
        b.onResolve({filter:/.*/},args=>{
        if (args.importer.includes('node_modules')) return;
        if (args.path.startsWith('.')) {
          const target=path.resolve(args.resolveDir,args.path);
          if (!target.startsWith(dir+path.sep)) return {errors:[{text:'引用不得离开项目目录'}]};
          return;
        }
        if (PACKAGES.some(p=>args.path===p || args.path.startsWith(p+'/'))) return;
        return {errors:[{text:'暂不支持依赖 '+args.path+'；可用：'+PACKAGES.join(', ')}]};
      });}}]});
    return {js:output.outputFiles.find(f=>f.path.endsWith('.js'))?.text || '',css:output.outputFiles.find(f=>f.path.endsWith('.css'))?.text || '',warnings:output.warnings.map(w=>w.text)};
  } finally {await rm(dir,{recursive:true,force:true});}
}

export const MAX_TEST_STEPS = 48;
export async function check(artifact, steps=[]) {
  if (!Array.isArray(steps)) throw Error('测试协议错误：tests 必须是步骤数组');
  if (steps.length > MAX_TEST_STEPS) throw Error(`测试协议错误：提交了 ${steps.length} 步，单次最多支持 ${MAX_TEST_STEPS} 步。请精简重复测试，保留核心流程；此错误不代表应用代码有问题。`);
  for (const [index, step] of steps.entries()) {
    if (!step || !['click','fill','text','visible'].includes(step.action) ||
        typeof step.selector !== 'string' || !step.selector.trim() || step.selector.length > 300 ||
        (['fill','text'].includes(step.action) && typeof step.value !== 'string')) {
      throw Error(`测试协议错误：第 ${index+1} 步需要有效的 action、CSS selector（最多 300 字符），fill/text 还需要字符串 value；请修正测试步骤。`);
    }
  }
  const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox','--js-flags=--max-old-space-size=128']});
  let timedOut = false;
  const deadline=setTimeout(()=>{timedOut=true;void browser.close();},60000);
  const logs=[]; const errors=[];
  try {
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
    // Generated code gets a clean browser context: no secrets, workspace login,
    // host volumes, external requests or access to the backend network.
    await context.route('**/*', route=>route.abort());
    const page=await context.newPage(); page.setDefaultTimeout(2500);
    page.on('pageerror',e=>errors.push(e.message.slice(0,1500)));
    page.on('console',m=>{if(logs.length<60) logs.push(m.type()+': '+m.text().slice(0,1000));});
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
    await page.evaluate(()=>{
      const storage=new Map(); Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.get(String(k))??null,setItem:(k,v)=>storage.set(String(k),String(v)),removeItem:k=>storage.delete(String(k)),clear:()=>storage.clear()}});
      // Backend behavior is tested separately; this fixture only allows UI tests.
      const rows=new Map(); let me=null;
      window.__AF_TEST__=async (action,data)=>{
        if(action==='me') return {user:me};
        if(action==='register'||action==='login'){me={id:'test-user',email:data.email};return {user:me};}
        if(action==='logout'){me=null;return {success:true};}
        if(action==='ai') return {content:'测试环境 AI 响应'};
        const list=rows.get(data.collection)||[];
        if(action==='list') return {items:list};
        if(action==='create'){const row={id:crypto.randomUUID(),data:data.data};rows.set(data.collection,[...list,row]);return {item:row};}
        if(action==='update'){const item={id:data.id,data:data.data};rows.set(data.collection,list.map(r=>r.id===data.id?item:r));return {item};}
        if(action==='remove'){rows.set(data.collection,list.filter(r=>r.id!==data.id));return {success:true};}
      };
    });
    if(artifact.css)await page.addStyleTag({content:artifact.css});
    await page.addScriptTag({content:artifact.js});
    await page.waitForFunction(()=>document.getElementById('root')?.childElementCount > 0,{},{timeout:5000});
    for (const [index, step] of steps.entries()) {
      if (typeof step.selector!=='string' || step.selector.length>300) throw Error('测试需要有效的 CSS selector');
      const target=page.locator(step.selector).first();
      try {
      if(step.action==='click') await target.click();
      else if(step.action==='fill') await target.fill(String(step.value||''));
      else if(step.action==='text') {await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.textContent?.includes(value),{selector:step.selector,value:String(step.value)},{timeout:2500});}
      else if(step.action==='visible') await target.waitFor({state:'visible'});
      else throw Error('未知测试操作');
      } catch (error) {
        const actual = await target.textContent({timeout:300}).catch(()=>null);
        const detail = '第 '+(index+1)+' 步 '+step.action+' '+step.selector+
          (step.action==='text'?'，期望包含 '+JSON.stringify(String(step.value)):'')+
          '，实际文本 '+JSON.stringify(actual === null ? '元素不存在' : actual.slice(0,300))+
          '。请核对选择器、测试预期和真实交互；日期相关测试不能把周一或第一个日期当作今天。';
        logs.push('FAIL '+detail);
        throw Error(detail+' '+String(error.message).slice(0,700));
      }
      logs.push('PASS '+step.action+' '+step.selector);
    }
    await page.waitForTimeout(300);
    if(errors.length) throw Error(errors.join('\n'));
    logs.push('PASS 页面挂载与运行错误检查；云端接口使用测试替身');
    const audit=await page.evaluate(()=>({title:document.title,h1:[...document.querySelectorAll('h1')].map(x=>x.textContent?.slice(0,200)),images:document.images.length,missingAlt:[...document.images].filter(x=>!x.hasAttribute('alt')).length,emptyLinks:[...document.querySelectorAll('a')].filter(x=>!x.textContent?.trim()&&!x.getAttribute('aria-label')).length,description:document.querySelector('meta[name="description"]')?.getAttribute('content')||''}));
    return {ok:true,logs,audit};
  } catch(e) {return {ok:false,logs,error:timedOut?'交互测试超过 60 秒，请检查等待中的操作或精简重复测试。':String(e.message).slice(0,5000)};}
  finally {clearTimeout(deadline);await browser.close();}
}

let active=false;
const server=http.createServer(async(req,res)=>{
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.url==='/health') return reply(200,{status:'healthy',packages:PACKAGES});
  if(req.url!=='/build' || req.method!=='POST') return reply(404,{error:'Not found'});
  if(active) return reply(429,{error:'构建服务忙，请稍后重试'});
  active=true;
  let raw='';
  try {
    for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2000000) return reply(413,{error:'项目过大'});}
    const input=JSON.parse(raw);
    const files=input.edit?visualEdit(input.files,input.edit):input.files;
    const artifact=await compile(files);
    const result=input.check===false ? {ok:true,logs:['构建通过；未执行浏览器检查']} : await check(artifact,input.tests||[]);
    reply(200,{...result,artifact:result.ok?artifact:null,...(input.edit?{files}: {})});
  } catch(e){reply(200,{ok:false,error:String(e.message).slice(0,5000),logs:[]});}
  finally {active=false;}
});
if(process.argv[1]===fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT||8001),'0.0.0.0');
