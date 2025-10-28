from fastapi.testclient import TestClient
from backend.main import app
client = TestClient(app)
resp = client.get('/health')
print(resp.status_code, resp.json())
