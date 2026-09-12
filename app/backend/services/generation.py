"""Bounded, owner-scoped generation jobs for one Demo server process.

Short polling keeps incremental output working through tunnels without SSE.
Completed projects remain in SQLite; transient jobs expire after ten minutes.
"""
import asyncio
import os
import time
import uuid
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException
from openai import APIStatusError
from schemas.aihub import GenTxtRequest
from services.aihub import AIHubService

MODELS = {"deepseek-flash", "deepseek-v4-pro"}


def active_run_limit():
    try:
        return max(1, min(3, int(os.getenv("AI_MAX_ACTIVE_RUNS", "3"))))
    except ValueError:
        return 3


@dataclass
class Job:
    owner: int
    content: str = ""
    status: str = "running"
    error: str = ""
    touched: float = field(default_factory=time.monotonic)
    task: asyncio.Task | None = None
    started: bool = False


class GenerationJobs:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.requests: deque[tuple[float, int]] = deque()

    def start(self, owner: int, request: GenTxtRequest) -> str:
        if request.model not in MODELS:
            raise HTTPException(400, "请选择当前可用的 DeepSeek 模型")
        now = time.monotonic()
        self.jobs = {k: j for k, j in self.jobs.items() if j.status == "running" or now - j.touched < 600}
        while self.requests and now - self.requests[0][0] >= 3600:
            self.requests.popleft()
        active = [j for j in self.jobs.values() if j.status == "running"]
        if any(j.owner == owner for j in active):
            raise HTTPException(429, "你已有一个生成任务，请等待完成或先取消")
        if len(active) >= active_run_limit() or len(self.jobs) >= 50:
            raise HTTPException(429, "服务繁忙，请稍后重试")
        if sum(uid == owner and now - ts < 60 for ts, uid in self.requests) >= 6:
            raise HTTPException(429, "请求过于频繁，请一分钟后重试")
        if len(self.requests) >= int(os.getenv("AI_HOURLY_LIMIT", "30")):
            raise HTTPException(429, "体验服务本小时生成次数已用完，请稍后再试")
        service = AIHubService()
        service._require_ai_client()
        job_id = uuid.uuid4().hex
        job = Job(owner=owner)
        self.jobs[job_id] = job
        self.requests.append((now, owner))
        job.task = asyncio.create_task(self._run(job, request, service))
        def cleanup_unstarted(task):
            if task.cancelled() and not job.started and service.client:
                asyncio.create_task(service.client.close())
        job.task.add_done_callback(cleanup_unstarted)
        return job_id

    async def _run(self, job: Job, request: GenTxtRequest, service: AIHubService):
        job.started = True
        try:
            async with asyncio.timeout(300):
                async for chunk in service.gentxt_stream(request):
                    job.content += chunk
                    if len(job.content) > 200_000:
                        raise ValueError("生成内容超过限制，请缩小应用范围")
            if not job.content.strip():
                raise ValueError("模型没有返回代码，请重试")
            job.status = "done"
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.error = "已取消生成，上一版本保持不变"
        except TimeoutError:
            job.status = "error"
            job.error = "生成超过五分钟，请缩小需求后重试"
        except APIStatusError as exc:
            job.status = "error"
            job.error = {
                401: "模型服务认证失败，请检查后端密钥",
                402: "DeepSeek 余额不足，请充值后重试",
                429: "DeepSeek 请求繁忙，请稍后重试",
            }.get(exc.status_code, "模型服务暂时不可用，请稍后重试")
        except ValueError as exc:
            job.status = "error"
            job.error = str(exc)
        except Exception:
            job.status = "error"
            job.error = "连接模型服务失败，请稍后重试"
        finally:
            job.touched = time.monotonic()
            if service.client:
                await service.client.close()

    def get(self, owner: int, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if not job or job.owner != owner:
            raise HTTPException(404, "生成任务不存在或已过期，请重试")
        return job

    def cancel(self, owner: int, job_id: str):
        job = self.get(owner, job_id)
        if job.status == "running" and job.task:
            job.status = "cancelled"
            job.error = "已取消生成，上一版本保持不变"
            job.task.cancel()
        return job


generation_jobs = GenerationJobs()
