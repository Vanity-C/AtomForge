"""Use provider capacity, not a per-agent output quota; bound stalled I/O only."""
import time
from types import SimpleNamespace

import httpx

from services import task_control

# DeepSeek Chat Completions API, verified 2026-09-15:
# https://api-docs.deepseek.com/api/create-chat-completion/
# Omitting max_tokens would select the much smaller non-thinking default (8K).
# This is the provider's request ceiling, not an application spending budget.
DEEPSEEK_MAX_OUTPUT_TOKENS = 393216
IDLE_TIMEOUT_SECONDS = 180


def output_options(model: str) -> dict:
    if model in {'deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'}:
        return {'max_tokens': DEEPSEEK_MAX_OUTPUT_TOKENS}
    # Do not invent capacities for models newly discovered at a compatible API.
    return {}


async def complete(client, model: str, messages: list, *, temperature: float, progress=None):
    """Read a complete response while useful output continues, with cancellation.

    Heartbeats do not extend the no-output deadline. A missing terminal marker is
    a transport failure: even valid-looking partial JSON must never be applied.
    """
    stream = await task_control.bounded(client.chat.completions.create(
        model=model, messages=messages, temperature=temperature,
        extra_body={'thinking': {'type': 'disabled'}},
        response_format={'type': 'json_object'}, stream=True,
        stream_options={'include_usage': True},
        timeout=httpx.Timeout(connect=20, read=IDLE_TIMEOUT_SECONDS, write=30, pool=20),
        **output_options(model)), IDLE_TIMEOUT_SECONDS)
    content = []
    usage = None
    finish_reason = None
    characters = 0
    last_output = last_notice = time.monotonic()
    try:
        iterator = stream.__aiter__()
        while True:
            task_control.check()
            timeout = IDLE_TIMEOUT_SECONDS - (time.monotonic() - last_output)
            if timeout <= 0:
                raise TimeoutError('模型输出停滞，正在恢复连接')
            try:
                chunk = await task_control.bounded(iterator.__anext__(), timeout)
            except StopAsyncIteration:
                break
            if chunk.usage is not None:
                usage = chunk.usage
            for choice in chunk.choices:
                if choice.index != 0:
                    continue
                delta = choice.delta
                if delta.content:
                    content.append(delta.content)
                    characters += len(delta.content)
                    last_output = time.monotonic()
                if getattr(delta, 'reasoning_content', None):
                    last_output = time.monotonic()
                if choice.finish_reason:
                    finish_reason = choice.finish_reason
                    last_output = time.monotonic()
            if progress and time.monotonic() - last_notice >= 15:
                await progress(characters)
                last_notice = time.monotonic()
        if finish_reason is None:
            raise httpx.ReadError('模型连接结束但没有完整结束标记，未应用本次输出')
        return SimpleNamespace(usage=usage, choices=[SimpleNamespace(
            finish_reason=finish_reason, message=SimpleNamespace(content=''.join(content)))])
    finally:
        try:
            await task_control.bounded(stream.close(), 3)
        except Exception:
            pass  # Never let failed cleanup hide the response/transport failure.
