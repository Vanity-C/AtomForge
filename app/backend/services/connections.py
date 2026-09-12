import base64
import hashlib
import json
from cryptography.fernet import Fernet
from models.studio import StudioConnection
from services.af_auth import _signing_secret


def cipher():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(('studio-connections:'+_signing_secret()).encode()).digest()))


async def read_connection(db,project_id):
    row=await db.get(StudioConnection,project_id)
    return json.loads(cipher().decrypt(row.encrypted.encode())) if row and row.encrypted else {}


async def save_connection(db,project_id,values):
    row=await db.get(StudioConnection,project_id)
    current=await read_connection(db,project_id)
    current.update({k:v for k,v in values.items() if v is not None})
    if not row:row=StudioConnection(project_id=project_id);db.add(row)
    row.encrypted=cipher().encrypt(json.dumps(current).encode()).decode();await db.commit()
