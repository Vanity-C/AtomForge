"""Provider-owned model IDs, display names and availability."""
import asyncio
import time
from fastapi import HTTPException
from services.aihub import AIHubService
from services import codex_provider

DEEPSEEK = [
    {'id': 'deepseek-flash', 'label': 'DeepSeek V4.1 Flash', 'provider': 'deepseek',
     'traits': ['快速', '默认'], 'note': 'DeepSeek-V4.1-Flash · 使用已配置的 DeepSeek API Key'},
    {'id': 'deepseek-v4-pro', 'label': 'DeepSeek V4 Pro · 0813', 'provider': 'deepseek',
     'traits': ['复杂需求'], 'note': 'DeepSeek-V4-Pro-0813 · 使用已配置的 DeepSeek API Key'},
]
_cached = None
_expires = 0
_lock = asyncio.Lock()


def provider_for(model):
    return 'codex' if model.startswith('gpt-') else 'deepseek'


async def catalogue():
    global _cached, _expires
    async with _lock:
        if _cached is not None and time.monotonic() < _expires:
            return _cached

        async def deepseek():
            service = AIHubService()
            try:
                async with asyncio.timeout(5):
                    result = await service._require_ai_client().models.list()
                known = {m['id']: m for m in DEEPSEEK}
                items = [dict(known.get(m.id, {'id': m.id, 'label': m.id, 'provider': 'deepseek',
                         'traits': [], 'note': 'DeepSeek API 返回的可用模型'}), available=True)
                         for m in result.data if m.id.startswith('deepseek-')]
                return items, None
            except Exception:
                return [dict(m, available=False) for m in DEEPSEEK], 'DeepSeek 模型列表暂不可用，请检查服务端密钥或连接'
            finally:
                if service.client:
                    await service.client.close()

        async def codex():
            try:
                models = await asyncio.to_thread(codex_provider.inspect_account)
                return [{'id': m['model'], 'label': m.get('displayName') or m['model'], 'provider': 'codex',
                         'available': True, 'traits': ['Codex 账号额度'],
                         'note': m.get('description') or '使用本机已登录的 ChatGPT / Codex 账号额度'} for m in models], None
            except HTTPException as exc:
                return [], str(exc.detail)

        ds, cx = await asyncio.gather(deepseek(), codex())
        _cached = {'items': ds[0] + cx[0], 'providers': [
            {'id': 'deepseek', 'label': 'DeepSeek', 'error': ds[1]},
            {'id': 'codex', 'label': 'GPT · Codex 账号', 'error': cx[1]}]}
        _expires = time.monotonic() + 60
        return _cached


async def validate_model(model, provider=None):
    expected = provider_for(model)
    if provider is not None and provider != expected:
        raise HTTPException(400, '模型与供应商不匹配')
    # Keep existing DeepSeek runs usable during discovery outages.
    if model in {m['id'] for m in DEEPSEEK}:
        return
    if not any(m['id'] == model and m['available'] for m in (await catalogue())['items']):
        raise HTTPException(400, '模型当前不可用，请刷新生成设置中的模型列表')
