import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_existing_database_adds_conversations_without_changing_old_rows(tmp_path):
    root=Path(__file__).resolve().parents[3]
    database=tmp_path/'existing.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE sentinel (value TEXT)')
        db.execute("INSERT INTO sentinel VALUES ('keep user data')")
    code='''
import asyncio,sys
sys.path.insert(0,sys.argv[1]+'/app/backend')
sys.path.insert(0,sys.argv[1]+'/scripts')
from core.config import settings
settings.__dict__['database_url']='sqlite+aiosqlite:///'+sys.argv[2]
from bootstrap_db import initialize_database
asyncio.run(initialize_database())
'''
    result=subprocess.run([sys.executable,'-c',code,str(root),str(database)],capture_output=True,text=True,env=os.environ.copy(),timeout=40)
    assert result.returncode==0,result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT value FROM sentinel').fetchone()[0]=='keep user data'
        assert db.execute("SELECT name FROM sqlite_master WHERE name='studio_conversations'").fetchone()
    assert len(list(tmp_path.glob('existing.db.backup-*')))==1


def test_old_duplicate_nicknames_get_unique_usernames_and_upgrade_is_idempotent(tmp_path):
    root = Path(__file__).resolve().parents[3]
    database = tmp_path / 'accounts.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE af_users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, display_name TEXT)')
        db.executemany('INSERT INTO af_users VALUES (?, ?, ?, ?)', [(1, 'one@example.test', 'hash-one', 'Alice'), (2, 'two@example.test', 'hash-two', 'ALICE'), (3, 'three@example.test', 'hash-three', 'old name@'), (4, 'four@example.test', 'hash-four', 'user_3')])
    code = '''
import asyncio,sys
sys.path.insert(0,sys.argv[1]+'/app/backend')
sys.path.insert(0,sys.argv[1]+'/scripts')
from core.config import settings
settings.__dict__['database_url']='sqlite+aiosqlite:///'+sys.argv[2]
from bootstrap_db import initialize_database
asyncio.run(initialize_database())
'''
    for _ in range(2):
        result = subprocess.run([sys.executable, '-c', code, str(root), str(database)], capture_output=True, text=True, env=os.environ.copy(), timeout=40)
        assert result.returncode == 0, result.stderr
    with sqlite3.connect(database) as db:
        rows = db.execute('SELECT id,email,password_hash,display_name,username,username_key FROM af_users ORDER BY id').fetchall()
        assert db.execute('SELECT session_version FROM af_users').fetchall() == [(0,)] * 4
        assert rows[0] == (1, 'one@example.test', 'hash-one', 'Alice', 'Alice', 'alice')
        assert rows[1][4] == 'ALICE_2'
        assert len({r[5] for r in rows}) == 4
        assert rows[2][3] == 'old name@'
        import pytest
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE af_users SET username_key='alice' WHERE id=2")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE af_users SET email='ONE@example.test' WHERE id=2")
    assert len(list(tmp_path.glob('accounts.db.backup-*'))) == 1


def test_project_mode_upgrade_and_sequence_keep_historic_ids(tmp_path):
    root = Path(__file__).resolve().parents[3]
    database = tmp_path / 'projects.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)')
        db.execute("INSERT INTO projects VALUES (4,'existing app')")
        db.execute('CREATE TABLE studio_runs (id TEXT PRIMARY KEY, project_id INTEGER, created TEXT, payload TEXT)')
        db.executemany('INSERT INTO studio_runs VALUES (?,?,?,?)', [('old',4,'2026-09-01','{"mode":"build"}'), ('recent',4,'2026-09-02','{"mode":"team"}'), ('orphan',20,'2026-09-01','{"mode":"build"}')])
    code = '''
import asyncio,sys
sys.path.insert(0,sys.argv[1]+'/app/backend')
sys.path.insert(0,sys.argv[1]+'/scripts')
from core.config import settings
settings.__dict__['database_url']='sqlite+aiosqlite:///'+sys.argv[2]
from bootstrap_db import initialize_database
asyncio.run(initialize_database())
'''
    for _ in range(2):
        result = subprocess.run([sys.executable, '-c', code, str(root), str(database)], capture_output=True, text=True, env=os.environ.copy(), timeout=40)
        assert result.returncode == 0, result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT name,agent_mode FROM projects WHERE id=4').fetchone() == ('existing app','team')
        assert db.execute("SELECT value FROM studio_sequences WHERE key='project_id'").fetchone()[0] == 20
        assert db.execute('SELECT count(*) FROM studio_runs').fetchone()[0] == 3
    assert len(list(tmp_path.glob('projects.db.backup-*'))) == 1
