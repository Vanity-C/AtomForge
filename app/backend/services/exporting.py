import json
from pathlib import Path


def entries(files,slug=''):
    paths={f['path'] for f in files}
    entry=next((p for p in ['App.tsx','App.jsx','App.ts','App.js'] if p in paths),None)
    if not entry:raise ValueError('缺少应用入口')
    result=[{'path':'src/'+f['path'],'content':f['content']} for f in files]
    main="import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport './cloud-client.js';\n"+'\n'.join("import './src/"+f['path']+"';" for f in files if f['path'].endswith('.css'))+"\nObject.assign(globalThis,React,{React});\nconst {default:App}=await import('./src/"+entry+"');\ncreateRoot(document.getElementById('root')).render(React.createElement(App));\n"
    deps={'react':'18.3.1','react-dom':'18.3.1','react-router-dom':'6.30.6','lucide-react':'0.462.0','recharts':'2.15.4','date-fns':'3.6.0','clsx':'2.1.1'}
    extra={
        'package.json':json.dumps({'name':'atomforge-app','private':True,'version':'1.0.0','type':'module','scripts':{'dev':'vite --host 127.0.0.1','build':'vite build','preview':'vite preview --host 127.0.0.1'},'dependencies':deps,'devDependencies':{'vite':'6.4.3'}},indent=2),
        'main.jsx':main,
        'cloud-client.js':Path(__file__).with_name('cloud-client.js').read_text(encoding='utf-8'),
        'index.html':'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AtomForge App</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>',
        'vite.config.js':"import {defineConfig,loadEnv} from 'vite';\nexport default defineConfig(({mode})=>{const env=loadEnv(mode,process.cwd(),'');const proxy={'/api/v1/cloud':{target:env.ATOMFORGE_API_ORIGIN||'http://127.0.0.1:8080',changeOrigin:true},'/api/v1/connections/cloud':{target:env.ATOMFORGE_API_ORIGIN||'http://127.0.0.1:8080',changeOrigin:true}};return {build:{target:'esnext'},server:{proxy},preview:{proxy}};});\n",
        '.env.example':'VITE_ATOMFORGE_APP_SLUG='+slug+'\nATOMFORGE_API_ORIGIN=http://127.0.0.1:8080\n',
        '.gitignore':'node_modules/\ndist/\n.env\n.env.local\n',
        'README.md':'# AtomForge 生成应用\n\n需要 Node.js 20+。复制 `.env.example` 为 `.env`，然后执行 `npm install`、`npm run dev`。生产构建：`npm run build`。\n\n支持 JSX / TSX 和预置 npm 依赖。未启用云服务的应用使用浏览器 localStorage。启用云服务的应用依赖仍在运行的 AtomForge 后端，账号和数据库留在该后端，导出不包含业务数据或服务端密钥。\n\n本地开发及预览由 Vite 代理 API。独立生产部署需要将 `/api/v1/cloud/` 与 `/api/v1/connections/cloud/` 反向代理到原 AtomForge 服务，并在构建时配置 VITE_ATOMFORGE_APP_SLUG。支付返回地址由项目支付配置决定。\n',
    }
    return result+[{'path':p,'content':c} for p,c in extra.items()]
