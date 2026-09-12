from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from dependencies.af_auth import get_af_user
from models.af_users import Af_users
from schemas.aihub import ChatMessage, GenTxtRequest
from services.generation import generation_jobs

router = APIRouter(prefix="/api/v1/af-generation", tags=["generation"])


class GenerationRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=16)
    model: str = Field(default="deepseek-flash", max_length=80)
    temperature: float = Field(default=0.35, ge=0, le=2)
    max_tokens: int = Field(default=12000, ge=64, le=16000)

    @model_validator(mode="after")
    def validate_messages(self):
        if any(m.role not in {"system", "user", "assistant"} or not isinstance(m.content, str) for m in self.messages):
            raise ValueError("只支持文本对话")
        if sum(len(m.content) for m in self.messages) > 120_000:
            raise ValueError("项目上下文过长，请缩小生成范围")
        return self


@router.post("/jobs", status_code=202)
async def start_job(data: GenerationRequest, user: Af_users = Depends(get_af_user)):
    raise HTTPException(410,'旧生成入口已停用，请使用项目内持久化智能体任务 /api/v1/studio/projects/{id}/runs')


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, offset: int = Query(default=0, ge=0), user: Af_users = Depends(get_af_user)):
    job = generation_jobs.get(user.id, job_id)
    return {"status": job.status, "delta": job.content[offset:], "offset": len(job.content), "error": job.error}


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, user: Af_users = Depends(get_af_user)):
    generation_jobs.cancel(user.id, job_id)
    return {"success": True}
