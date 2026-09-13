"""Private, versioned covers captured from the actual compiled application.

New builds include a cover. Older artifacts are captured lazily; projects with
only source files are built once on demand. No model calls are involved. The
image lives in the artifact JSON so replacing/deleting an artifact invalidates
its cover, with no second persistence store.
"""
import asyncio
from collections import OrderedDict
import json
import os
import time

import httpx
from sqlalchemy import update

from core.database import db_manager
from models.studio import StudioArtifact
from services.af_projects import AfProjectService

_jobs: dict[tuple[int, int], asyncio.Task] = {}
_failures: OrderedDict[tuple[int, int], float] = OrderedDict()


async def render_cover(key, artifact, files):
    """Deduplicate legacy backfill; successful results are persisted by callers."""
    if key in _failures and time.monotonic() - _failures[key] < 60:
        return None

    async def render():
        result = artifact
        if result is None:
            from services.studio import runner_build
            try:
                built = await runner_build(files)
                result = built.get('artifact') if built.get('ok') else None
            except Exception:
                result = None
        if isinstance(result, dict):
            thumbnail = result.get('thumbnail')
            if not valid_thumbnail(thumbnail):
                thumbnail = await capture_artifact(result)
            if thumbnail:
                return {**result, 'thumbnail': thumbnail}
        _failures[key] = time.monotonic()
        while len(_failures) > 256:
            _failures.popitem(last=False)
        return None

    task = _jobs.get(key)
    if task is None:
        task = asyncio.create_task(render())
        _jobs[key] = task
        def cleanup(completed):
            if _jobs.get(key) is completed:
                _jobs.pop(key, None)
        task.add_done_callback(cleanup)
    try:
        return await asyncio.shield(task)
    finally:
        if task.done() and _jobs.get(key) is task:
            _jobs.pop(key, None)


def valid_thumbnail(value):
    return isinstance(value, str) and value.startswith('data:image/jpeg;base64,') and len(value) <= 1_500_000


async def capture_artifact(artifact):
    from services.studio import build_lock
    # Share the existing runner admission lock; at most one browser job per app.
    async with build_lock, httpx.AsyncClient(timeout=70, trust_env=False) as client:
        try:
            response = await client.post(
                os.getenv('RUNNER_URL', 'http://127.0.0.1:8001') + '/thumbnail',
                json={'artifact': {'js': artifact.get('js', ''), 'css': artifact.get('css', '')}},
            )
            response.raise_for_status()
            result = response.json()
            if result.get('ok') and valid_thumbnail(result.get('thumbnail')):
                return result['thumbnail']
        except (httpx.HTTPError, ValueError):
            pass
    return None


async def project_thumbnail(project_id: int, actor_id: str):
    async with db_manager.session() as db:
        project = await AfProjectService(db, actor_id).get_project(project_id)
        version = project['current_version']
        if not version:
            return {'status': 'empty', 'version': version}
        row = await db.get(StudioArtifact, project_id)
        original = row.content if row else None
        try:
            artifact = json.loads(original) if row and row.version == version else None
        except (ValueError, TypeError):
            artifact = None
        if artifact is not None and not isinstance(artifact, dict):
            artifact = None
        if artifact and valid_thumbnail(artifact.get('thumbnail')):
            return {'status': 'ready', 'version': version, 'src': artifact['thumbnail']}
        files = await AfProjectService(db, actor_id).list_files(project_id) if artifact is None else None
        if artifact is None and not files:
            return {'status': 'unbuilt', 'version': version}

    rendered = await render_cover((project_id, version), artifact, files)
    if not rendered:
        return {'status': 'unavailable', 'version': version}
    async with db_manager.session() as db:
        # Recheck access after waiting for the runner. A revoked collaborator must
        # never receive the image, and a newer version must not show an old cover.
        current = await AfProjectService(db, actor_id).get_project(project_id)
        if current['current_version'] != version:
            return {'status': 'changed', 'version': current['current_version']}
        serialized = json.dumps(rendered, ensure_ascii=False)
        if original is None:
            # Concurrent normal builds or another backfill remain authoritative.
            from sqlalchemy.dialects.sqlite import insert
            await db.execute(insert(StudioArtifact).values(
                project_id=project_id, version=version, content=serialized,
            ).on_conflict_do_nothing(index_elements=['project_id']))
        else:
            await db.execute(update(StudioArtifact).where(
                StudioArtifact.project_id == project_id,
                StudioArtifact.content == original,
            ).values(version=version, content=serialized))
        await db.commit()
    return {'status': 'ready', 'version': version, 'src': rendered['thumbnail']}
