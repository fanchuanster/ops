"""Phase 1 parity: the service is up and can reach its database."""

import pytest


@pytest.mark.django_db
def test_healthz_reports_ok(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


@pytest.mark.django_db
def test_admin_redirects_anonymous_to_login(client):
    response = client.get("/admin/")
    assert response.status_code == 302
    assert "/admin/login/" in response["Location"]
