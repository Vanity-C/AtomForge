"""Bounded cancellation: a slow cleanup must never hold the scheduler hostage."""
import asyncio
from weakref import WeakSet

stopped = WeakSet()
cleanup_tasks = set()


def check():
    if asyncio.current_task() in stopped:
        raise asyncio.CancelledError()


def consume(task):
    cleanup_tasks.discard(task)
    if not task.cancelled():
        task.exception()


def stop(task):
    if task is None or task.done():
        return
    stopped.add(task)
    task.cancel()
    cleanup_tasks.add(task)
    task.add_done_callback(consume)


async def bounded(operation, timeout):
    """Unlike wait_for, the deadline does not await cancellation acknowledgement."""
    task = asyncio.ensure_future(operation)
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if not done:
            raise TimeoutError('Task operation timed out')
        check()
        return task.result()
    except BaseException:
        stop(task)
        raise
