"""Shared account normalization, upgrade and avatar validation."""
import base64
import binascii
import re
import unicodedata
import warnings
from io import BytesIO

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError


def normalize_username(value):
    return unicodedata.normalize('NFKC', value or '').strip()


def username_key(value):
    return normalize_username(value).casefold()


def valid_username(value):
    return 2 <= len(value) <= 40 and re.fullmatch(r'[A-Za-z0-9\u4e00-\u9fff_.-]+', value) is not None


def validate_username(value):
    value = normalize_username(value)
    if not valid_username(value):
        raise HTTPException(400, '用户名需为 2–40 位中文、英文字母、数字、下划线、点或短横线')
    return value


def prepare_avatar(value):
    if value == '':
        return None
    try:
        header, encoded = value.split(',', 1)
        if header not in {'data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'}:
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 1024 * 1024:
            raise HTTPException(413, '头像图片不能超过 1 MB')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {'PNG', 'JPEG', 'WEBP'} or max(source.size) > 4096:
                    raise ValueError()
                source.load()
                cropped = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGBA'), (256, 256), method=Image.Resampling.LANCZOS)
                # New image discards all metadata and embedded payloads.
                clean = Image.new('RGBA', cropped.size)
                clean.paste(cropped)
                output = BytesIO()
                clean.save(output, format='PNG')
        return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode('ascii')
    except (ValueError, TypeError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, '请上传有效的 PNG、JPG 或 WebP 图片，宽高不超过 4096 像素')


def upgrade_accounts(connection):
    """Add fields and deterministic unique names; preserve account IDs and ownership."""
    from sqlalchemy import inspect, text
    if 'af_users' not in inspect(connection).get_table_names():
        return
    columns = {c['name'] for c in inspect(connection).get_columns('af_users')}
    if 'session_version' not in columns:
        connection.execute(text('ALTER TABLE af_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'))
    for column in ('username', 'username_key', 'avatar_data'):
        if column not in columns:
            connection.execute(text(f'ALTER TABLE af_users ADD COLUMN {column} TEXT'))
    rows = connection.execute(text('SELECT id, display_name, username, username_key, email FROM af_users ORDER BY id')).mappings().all()
    used = {r['username_key'] for r in rows if r['username_key']}
    for row in rows:
        if row['username_key']:
            continue
        candidate = normalize_username(row['username'] or row['display_name'])
        if not valid_username(candidate):
            candidate = f'user_{row["id"]}'
        base = candidate
        suffix = 0
        while username_key(candidate) in used:
            suffix += 1
            candidate = f'{base[:25]}_{row["id"]}' + (f'_{suffix}' if suffix > 1 else '')
        used.add(username_key(candidate))
        connection.execute(text('UPDATE af_users SET username=:name, username_key=:key WHERE id=:id'), {'name': candidate, 'key': username_key(candidate), 'id': row['id']})
    connection.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS uq_af_users_username_key ON af_users(username_key)'))
    connection.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS uq_af_users_email_normalized ON af_users(lower(email))'))
