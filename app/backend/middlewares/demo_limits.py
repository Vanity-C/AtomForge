"""Small single-process request guards for the public Demo."""
import time
from collections import deque
from starlette.responses import JSONResponse


class DemoLimits:
    def __init__(self, app):
        self.app = app
        self.auth_requests = deque()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        if scope['method'] in {'POST', 'PUT', 'PATCH'}:
            headers = dict(scope.get('headers', []))
            try:
                length = int(headers.get(b'content-length', b'0'))
            except ValueError:
                return await JSONResponse({'detail':'请求长度无效'},400)(scope,receive,send)
            if length > 2_000_000:
                return await JSONResponse({'detail':'请求内容过大'},413)(scope,receive,send)
        if scope['method'] == 'POST' and scope['path'] in {'/api/v1/af-auth/login','/api/v1/af-auth/register'}:
            now = time.monotonic()
            while self.auth_requests and now - self.auth_requests[0][0] >= 60:
                self.auth_requests.popleft()
            address = (scope.get('client') or ('unknown',))[0]
            if len(self.auth_requests) >= 60 or sum(ip == address for _,ip in self.auth_requests) >= 15:
                return await JSONResponse({'detail':'登录或注册过于频繁，请一分钟后重试'},429)(scope,receive,send)
            self.auth_requests.append((now,address))
        await self.app(scope,receive,send)
