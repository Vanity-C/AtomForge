// Application login only. No workspace token or model key is exported.
const slug = import.meta.env.VITE_ATOMFORGE_APP_SLUG || '';
const key = 'atomforge.cloud.session.' + slug;
async function call(action, data = {}) {
  if (!slug) throw new Error('请配置 VITE_ATOMFORGE_APP_SLUG 并启用应用云服务');
  if (action === 'logout') { localStorage.removeItem(key); return {success:true}; }
  const root = '/api/v1/cloud/' + encodeURIComponent(slug);
  const collection = encodeURIComponent(data.collection || '');
  const id = encodeURIComponent(data.id || '');
  const routes = {
    register:['POST',root+'/register',{email:data.email,password:data.password}],login:['POST',root+'/login',{email:data.email,password:data.password}],
    me:['GET',root+'/me'],list:['GET',root+'/data/'+collection],create:['POST',root+'/data/'+collection,{data:data.data}],
    update:['PUT',root+'/data/'+collection+'/'+id,{data:data.data}],remove:['DELETE',root+'/data/'+collection+'/'+id],
    ai:['POST',root+'/ai/chat',{prompt:data.prompt}],checkout:['POST','/api/v1/connections/cloud/'+encodeURIComponent(slug)+'/checkout'],payments:['GET','/api/v1/connections/cloud/'+encodeURIComponent(slug)+'/payments'],
  };
  const [method,url,body] = routes[action];
  const response = await fetch(url,{method,headers:{'Content-Type':'application/json','X-App-Token':localStorage.getItem(key)||''},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail==='string'?result.detail:'应用服务请求失败');
  if (action==='register'||action==='login') {localStorage.setItem(key,result.access_token);return {user:result.user};}
  // Exported applications have no host toolbar; show the same explicit link.
  if(action==='checkout'&&new URL(result.url).origin==='https://checkout.stripe.com'){
    document.getElementById('atomforge-checkout-link')?.remove();
    const link=document.createElement('a');link.id='atomforge-checkout-link';link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='继续付款 · Stripe';
    Object.assign(link.style,{position:'fixed',bottom:'20px',right:'20px',padding:'14px 20px',background:'#6d28d9',color:'white',borderRadius:'8px',zIndex:'9999'});document.body.appendChild(link);
  }
  return result;
}
globalThis.AtomForge = {
  auth:{register:(email,password)=>call('register',{email,password}),login:(email,password)=>call('login',{email,password}),me:()=>call('me'),logout:()=>call('logout')},
  db:{list:collection=>call('list',{collection}),create:(collection,data)=>call('create',{collection,data}),update:(collection,id,data)=>call('update',{collection,id,data}),remove:(collection,id)=>call('remove',{collection,id})},
  ai:{chat:prompt=>call('ai',{prompt})},payments:{checkout:()=>call('checkout'),status:()=>call('payments')}
};
