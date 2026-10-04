'use strict';
const { plazaConfig } = require('./plaza-config');
const { createPlaza, cookieName } = require('./plaza');
const { localTestStorage } = require('./plaza-storage');
const { sameOrigin, digest } = require('./career-log');
function registerPlazaRoutes(deps) {
  const config = plazaConfig();
  if (!config) return { enabled: false, forDeck: async () => null, blocksRecord: async () => false };
  const plaza = createPlaza({ ...deps, config, storage: localTestStorage(config) });
  const { route, json, cookieSecure = '' } = deps;
  const roomPattern = '/api/plaza/rooms/([0-9a-f-]{36})';
  function register(method, pattern, role, work) {
    route(method, new RegExp(`^${pattern}$`, 'i'), role, async (req, res, ctx) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Cookie');
      if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: '같은 사이트에서 다시 시도해 주세요.' });
      try {
        const result = await work(req, res, ctx);
        if (!res.headersSent) return json(res, 200, result);
      } catch (error) {
        return json(res, error.status || 503, { error: error.status ? error.message : '광장 연결을 확인하지 못했습니다. 다시 확인해 주세요.', code: error.code });
      }
    });
  }
  register('GET', '/api/plaza/rooms', 'instructor', (_req,_res,ctx) => plaza.list(ctx));
  register('GET', `${roomPattern}/entry`, 'student', (req,_res,ctx) => plaza.entry(ctx.params[0],req,ctx));
  register('POST', `${roomPattern}/enter`, 'student', async (req,res,ctx) => {
    const result = await plaza.enter(ctx.params[0],req,ctx,ctx.body);
    const { grantKey, careerKey, expires } = result.credentials;
    delete result.credentials;
    const maxAge = Math.max(0, Math.floor((new Date(expires) - Date.now()) / 1000));
    const flags = `; HttpOnly; SameSite=Strict; Path=/${cookieSecure}`;
    res.setHeader('Set-Cookie', [
      `${cookieName(ctx.params[0])}=${grantKey}; Max-Age=${maxAge}${flags}`,
      `job_career_access=${careerKey}.${digest(ctx.token)}${flags}`,
      `job_career_resume=${careerKey}; Max-Age=${maxAge}${flags}`,
    ]);
    return result;
  });
  register('GET', `${roomPattern}/mine`, 'student', (req,_res,ctx) => plaza.mine(ctx.params[0],req,ctx));
  register('PUT', `${roomPattern}/draft`, 'student', (req,_res,ctx) => plaza.save(ctx.params[0],req,ctx,ctx.body));
  register('GET', `${roomPattern}/teacher`, 'instructor', (_req,_res,ctx) => plaza.teacher(ctx.params[0],ctx));
  register('POST', `${roomPattern}/state`, 'instructor', (_req,_res,ctx) => plaza.state(ctx.params[0],ctx,ctx.body));
  register('POST', `${roomPattern}/photos`, 'instructor', (_req,_res,ctx) => plaza.preparePhoto(ctx.params[0],ctx,ctx.body));
  register('PUT', `${roomPattern}/photos/([0-9a-f-]{36})`, 'instructor', (_req,_res,ctx) => plaza.uploadPhoto(ctx.params[0],ctx.params[1],ctx,ctx.body));
  register('GET', `${roomPattern}/photos/([0-9a-f-]{36})`, 'student', async (req,res,ctx) => {
    const photo = await plaza.photo(ctx.params[0],ctx.params[1],req,ctx);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': photo.length, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.end(photo);
  });
  return {
    enabled: true, forDeck: plaza.forDeck,
    blocksRecord: async deckId => !!(await deps.one('SELECT 1 FROM plaza_program_versions WHERE deck_id=$1', [deckId])),
  };
}
module.exports = { registerPlazaRoutes };
