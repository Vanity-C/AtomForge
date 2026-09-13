import pytest
from test_demo import client


@pytest.mark.parametrize('path',['/dashboard','/agents','/settings','/account','/auth/callback'])
def test_workspace_deep_links_serve_spa_after_refresh(client,tmp_path,monkeypatch,path):
    import main
    (tmp_path/'index.html').write_text('<html>workspace-entry</html>')
    monkeypatch.setattr(main,'FRONTEND_DIST',tmp_path)
    response=client.get(path)
    assert response.status_code==200
    assert response.text=='<html>workspace-entry</html>'
    for missing in ['/.env.docker','/api/not-a-real-route','/missing-file.js']:
        assert client.get(missing).status_code==404
