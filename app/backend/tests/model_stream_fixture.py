"""Wire-shaped streaming responses for provider tests (including usage tail)."""
from types import SimpleNamespace


def chunk(content=None, finish=None, usage=None):
    return SimpleNamespace(usage=usage, choices=[SimpleNamespace(index=0,
        delta=SimpleNamespace(content=content), finish_reason=finish)] if content is not None or finish else [])


class Stream:
    def __init__(self, items):
        self.items = iter(items)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.items)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


def stream_response(response):
    choice=response.choices[0]
    return Stream([chunk(choice.message.content), chunk(finish=choice.finish_reason),
                   chunk(usage=response.usage)])
