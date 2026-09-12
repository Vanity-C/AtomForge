"""Initialize an empty SQLite database; never rebuild existing user data."""
import importlib
import pkgutil


async def initialize_database():
    # Import after the caller has configured its environment and Python path.
    from core.database import Base, db_manager
    import models
    from sqlalchemy import inspect, text

    for module in pkgutil.iter_modules(models.__path__):
        importlib.import_module(f"models.{module.name}")
    engine = await db_manager.get_engine()
    try:
        if engine.dialect.name != "sqlite":
            raise RuntimeError("Bootstrap supports SQLite only; migrate external databases separately.")
        async with engine.begin() as conn:
            tables = await conn.run_sync(lambda sync: inspect(sync).get_table_names())
            if not tables:
                await conn.run_sync(Base.metadata.create_all)
                print("Created database using the current ORM schema.")
            else:
                print("Checking additive schema upgrades; existing user data is preserved.")
                additions = [table for table in Base.metadata.sorted_tables if table.name.startswith('studio_') or table.name in {'af_external_identities','af_oauth_flows','af_deliveries'}]
                missing = [t for t in additions if t.name not in tables]
                account_upgrade = False
                project_upgrade = False
                if 'projects' in tables:
                    project_columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('projects')})
                    project_upgrade = 'agent_mode' not in project_columns
                if 'af_users' in tables:
                    columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('af_users')})
                    indexes = set((await conn.execute(text("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='af_users'"))).scalars())
                    account_upgrade = not {'username', 'username_key', 'avatar_data'}.issubset(columns) or not {'uq_af_users_email_normalized', 'uq_af_users_username_key'}.issubset(indexes)
                if missing or account_upgrade or project_upgrade:
                    import sqlite3
                    from pathlib import Path
                    from datetime import datetime, timezone
                    database = Path(engine.url.database).resolve()
                    if database.is_file():
                        backup = database.with_name(database.name + '.backup-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S'))
                        with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
                            source.backup(target)
                        print('Backed up database before additive schema migration.')
                    await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=missing))
                    print('Added studio tables; existing data and schemas preserved.')
                    if account_upgrade:
                        from services.account_profile import upgrade_accounts
                        await conn.run_sync(upgrade_accounts)
                        print('Added unique account names and avatar storage; account IDs preserved.')
                    if project_upgrade:
                        import json
                        await conn.execute(text("ALTER TABLE projects ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'build'"))
                        projects = (await conn.execute(text('SELECT id FROM projects'))).scalars().all()
                        for project_id in projects:
                            payload = await conn.scalar(text('SELECT payload FROM studio_runs WHERE project_id=:id ORDER BY created DESC LIMIT 1'), {'id': project_id})
                            try:
                                mode = 'team' if payload and json.loads(payload).get('mode') == 'team' else 'build'
                            except (ValueError, TypeError):
                                mode = 'build'
                            await conn.execute(text('UPDATE projects SET agent_mode=:mode WHERE id=:id'), {'mode': mode, 'id': project_id})
                        print('Locked existing project modes using their latest task mode.')
                    # Preserve a high-water mark before any old project can be deleted.
                    present = await conn.run_sync(lambda sync: set(inspect(sync).get_table_names()))
                    if 'projects' in present:
                        high = await conn.scalar(text('SELECT coalesce(max(id),0) FROM projects'))
                        for table in Base.metadata.sorted_tables:
                            if table.name in present and 'project_id' in table.c:
                                high = max(high, await conn.scalar(text(f'SELECT coalesce(max(project_id),0) FROM "{table.name}"')))
                        await conn.execute(text("INSERT INTO studio_sequences (key,value) VALUES ('project_id',:high) ON CONFLICT(key) DO UPDATE SET value=max(value,:high)"), {'high': high})
    finally:
        await db_manager.close_db()
