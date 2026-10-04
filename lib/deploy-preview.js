'use strict';

// No database imports or connections, including when DATABASE_URL is inherited.
function handleApi(req, res, pathname) {
  const statusRequest = req.method === 'GET' && pathname === '/api/deployment-status';
  res.writeHead(statusRequest ? 200 : 503, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  res.end(JSON.stringify(statusRequest ? {
    mode: 'deploy-only', database: 'disconnected', plaza: 'inactive',
  } : {
    code: 'deployment_preview',
    error: '배포 확인용 미리보기입니다. 온라인 연결 전에는 로그인과 수업·저장을 사용할 수 없습니다.',
  }));
}

module.exports = { handleApi };
