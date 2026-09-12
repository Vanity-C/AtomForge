"""Local Codex integration. Credentials stay in Codex; never proxy OAuth tokens."""
import asyncio
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
from urllib.request import getproxies

from fastapi import HTTPException


def command():
    configured = os.getenv('ATOMFORGE_CODEX_BIN')
    executable = configured or shutil.which('codex.exe') or shutil.which('codex')
    # npm's Windows shim is a batch script. Run the installed binary without a shell.
    if not executable or Path(executable).suffix.lower() in {'.cmd', '.ps1'}:
        npm = Path(os.getenv('APPDATA', '')) / 'npm/node_modules/@openai/codex/node_modules/@openai'
        executable = next((str(p) for p in npm.glob('codex-*/vendor/*/bin/codex.exe')), None)
    if not executable:
        raise HTTPException(503, '未找到 Codex CLI，请在后端所在电脑安装并用 ChatGPT 账号登录 Codex')
    return executable


def launch(args, cwd=None):
    env = {k: v for k, v in os.environ.items() if k not in {'OPENAI_API_KEY', 'CODEX_API_KEY', 'APP_AI_KEY'}}
    # Rust CLI does not automatically inherit the Windows Internet Settings proxy.
    for scheme, proxy in getproxies().items():
        if scheme in {'http', 'https', 'all', 'no'}:
            env.setdefault(f'{scheme.upper()}_PROXY', proxy)
    try:
        return subprocess.Popen([command(), *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, encoding='utf-8', env=env, cwd=cwd,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except OSError as exc:
        raise HTTPException(503, '无法启动 Codex CLI，请检查 ATOMFORGE_CODEX_BIN 与安装路径') from exc


def stop(process):
    if process.poll() is None:
        process.kill()
    process.wait(timeout=5)
    for pipe in (process.stdin, process.stdout):
        if pipe:
            pipe.close()


def inspect_account():
    """Read-only JSON-RPC discovery, including every page of picker-visible models."""
    process = launch(['app-server', '--listen', 'stdio://'])
    inbox = queue.Queue()

    def read():
        try:
            for line in process.stdout:
                try:
                    inbox.put(json.loads(line))
                except ValueError:
                    pass
        finally:
            inbox.put(None)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    sequence = 0
    deadline = time.monotonic() + 20

    def rpc(method, params):
        nonlocal sequence
        sequence += 1
        process.stdin.write(json.dumps({'id': sequence, 'method': method, 'params': params}) + '\n')
        process.stdin.flush()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Codex discovery timed out')
            message = inbox.get(timeout=min(12, remaining))
            if message is None:
                raise RuntimeError('Codex exited')
            if message.get('id') == sequence:
                if 'error' in message:
                    raise RuntimeError('Codex RPC failed')
                return message['result']

    try:
        rpc('initialize', {'clientInfo': {'name': 'atomforge', 'version': '2.0.0'}})
        process.stdin.write('{"method":"initialized","params":{}}\n')
        process.stdin.flush()
        account = rpc('account/read', {'refreshToken': False}).get('account')
        if not account or account.get('type') != 'chatgpt':
            raise HTTPException(503, '请在后端所在电脑使用 codex login 登录 ChatGPT 账号；此接入只使用 Codex 账号额度')
        models, cursor = [], None
        while True:
            page = rpc('model/list', {'limit': 100, 'includeHidden': False, 'cursor': cursor})
            models.extend(m for m in page['data'] if not m.get('hidden') and m['model'].startswith('gpt-'))
            cursor = page.get('nextCursor')
            if not cursor:
                break
        return models
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, 'Codex 连接失败，请检查本机 CLI 版本与登录状态') from exc
    finally:
        if process.poll() is None:
            process.kill()
        reader.join(timeout=5)
        stop(process)


async def complete(model, messages):
    # Verify subscription authentication on each call; never fall back to API billing.
    models = await asyncio.to_thread(inspect_account)
    if model not in {m['model'] for m in models}:
        raise HTTPException(400, '当前 Codex 账号没有此模型，请刷新模型列表')
    with tempfile.TemporaryDirectory(prefix='atomforge-codex-') as directory:
        args = ['exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral',
                '--json', '--sandbox', 'read-only', '--model', model,
                '-c', 'forced_login_method="chatgpt"', '-c', 'web_search="disabled"']
        for feature in ('shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent',
                        'browser_use', 'computer_use', 'image_generation', 'code_mode'):
            args.extend(['--disable', feature])
        args.append('-')
        process = launch(args, directory)
        prompt = ('你是 AtomForge 的模型后端。只根据以下对话生成回复；不要使用工具或访问文件。'
                  '返回单个 JSON 对象，不要 Markdown 围栏。\n' + json.dumps(messages, ensure_ascii=False))
        worker = asyncio.create_task(asyncio.to_thread(process.communicate, prompt, timeout=170))
        try:
            try:
                output, _ = await asyncio.shield(worker)
            except subprocess.TimeoutExpired as exc:
                raise TimeoutError('Codex generation timed out') from exc
            text, usage, failure = '', None, False
            for line in output.splitlines():
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if item.get('type') == 'item.completed' and item.get('item', {}).get('type') == 'agent_message':
                    text = item['item']['text']
                if item.get('type') == 'turn.completed':
                    usage = item.get('usage')
                if item.get('type') == 'turn.failed':
                    failure = True
            if process.returncode or failure or not text:
                raise HTTPException(502, 'Codex 生成失败，请检查账号额度与登录状态后重试')
            return SimpleNamespace(
                usage=SimpleNamespace(prompt_tokens=usage.get('input_tokens', 0), completion_tokens=usage.get('output_tokens', 0)) if usage else None,
                choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content=text))])
        finally:
            if process.poll() is None:
                process.kill()
            try:
                await asyncio.shield(worker)
            except (subprocess.TimeoutExpired, asyncio.CancelledError):
                pass
            stop(process)
