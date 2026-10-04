'use strict';
const { plazaConfig } = require('./plaza-config');
const { createPlaza, cookieName } = require('./plaza');
const { localTestStorage } = require('./plaza-storage');
const { sameOrigin, digest } = require('./career-log');
function registerPlazaRoutes(deps) {
  const config = plazaConfig();
  if (!config) return { enabled: false, stage4:false,stage5:false,forDeck: async () => null, blocksRecord: async () => false,identityBlocked:async()=>false };
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
  if(plaza.stage5){
    register('GET','/api/plaza/programs','instructor',(_req,_res,ctx)=>plaza.stage5.list(ctx));
    register('POST','/api/plaza/programs','instructor',(_req,_res,ctx)=>plaza.stage5.register(ctx,ctx.body));
    register('POST','/api/plaza/rooms','instructor',(_req,_res,ctx)=>plaza.stage5.prepare(ctx,ctx.body));
  }
  register('GET', `${roomPattern}/entry`, 'student', (req,_res,ctx) => plaza.entry(ctx.params[0],req,ctx));
  function connected(result,res,ctx) {
    const { grantKey, careerKey, expires } = result.credentials;
    delete result.credentials;
    const maxAge = Math.max(0, Math.floor((new Date(expires) - Date.now()) / 1000));
    const flags = `; HttpOnly; SameSite=Strict; Path=/${cookieSecure}`;
    res.setHeader('Set-Cookie', [
      `${cookieName(ctx.params[0])}=${grantKey}; Max-Age=${maxAge}${flags}`,
      careerKey?`job_career_access=${careerKey}.${digest(ctx.token)}${flags}`:`job_career_access=; Max-Age=0${flags}`,
      careerKey?`job_career_resume=${careerKey}; Max-Age=${maxAge}${flags}`:`job_career_resume=; Max-Age=0${flags}`,
    ]);
    return result;
  }
  register('POST', `${roomPattern}/enter`, 'student', async (req,res,ctx) => connected(await plaza.enter(ctx.params[0],req,ctx,ctx.body),res,ctx));
  if(plaza.stage3) {
    register('GET', `${roomPattern}/paper`, 'instructor', (_req,_res,ctx)=>plaza.stage3.paper(ctx.params[0],ctx));
    register('POST', `${roomPattern}/reissue`, 'instructor', (_req,_res,ctx)=>plaza.stage3.reissue(ctx.params[0],ctx,ctx.body));
    register('POST', `${roomPattern}/claim`, 'student', async(req,res,ctx)=>connected(await plaza.stage3.claim(ctx.params[0],req,ctx,ctx.body),res,ctx));
    register('POST', `${roomPattern}/attendance`, 'instructor', (_req,_res,ctx)=>plaza.stage3.attendance(ctx.params[0],ctx,ctx.body));
    register('POST', `${roomPattern}/photo-move`, 'instructor', (_req,_res,ctx)=>plaza.stage3.movePhoto(ctx.params[0],ctx,ctx.body));
  }
  register('GET', `${roomPattern}/mine`, 'student', (req,_res,ctx) => plaza.mine(ctx.params[0],req,ctx));
  if(plaza.stage4) {
    const maintenance=`${roomPattern}/retention`;
    register('POST',`${roomPattern}/photo-choice`,'student',(req,_res,ctx)=>plaza.stage4.withdrawPhoto(ctx.params[0],req,ctx,ctx.body));
    register('POST',`${roomPattern}/finish`,'student',(req,_res,ctx)=>plaza.stage2.finish(ctx.params[0],req,ctx,ctx.body));
    register('GET','/api/plaza/retention','admin',(_req,_res,ctx)=>plaza.stage4.list(ctx));
    register('GET','/api/plaza/retention/orphans','admin',(_req,_res,ctx)=>plaza.stage4.orphans(ctx));
    register('POST','/api/plaza/retention/orphans','admin',(_req,_res,ctx)=>plaza.stage4.orphans(ctx,ctx.body));
    register('GET',maintenance,'admin',(_req,_res,ctx)=>plaza.stage4.status(ctx.params[0],ctx));
    register('POST',`${maintenance}/policy`,'admin',(_req,_res,ctx)=>plaza.stage4.setPolicy(ctx.params[0],ctx,ctx.body));
    register('GET',`${maintenance}/preview`,'admin',(req,_res,ctx)=>plaza.stage4.preview(ctx.params[0],ctx,new URL(req.url,'http://localhost').searchParams.get('restore')==='1'));
    register('POST',`${maintenance}/purge`,'admin',(_req,_res,ctx)=>plaza.stage4.purge(ctx.params[0],ctx,ctx.body));
    register('POST',`${maintenance}/jobs/([0-9a-f-]{36})/retry`,'admin',(_req,_res,ctx)=>plaza.stage4.retry(ctx.params[0],ctx.params[1],ctx));
  }
  if (plaza.stage2) {
    register('POST', `${roomPattern}/ai`, 'student', (req,_res,ctx) => plaza.stage2.ai(ctx.params[0],req,ctx,ctx.body));
    register('PUT', `${roomPattern}/activity`, 'student', (req,_res,ctx) => plaza.stage2.saveActivity(ctx.params[0],req,ctx,ctx.body));
    register('POST', `${roomPattern}/message`, 'student', (req,_res,ctx) => plaza.stage2.message(ctx.params[0],req,ctx,ctx.body));
    register('GET', `${roomPattern}/board`, 'student', (req,_res,ctx) => plaza.stage2.board(ctx.params[0],req,ctx,new URL(req.url,'http://localhost').searchParams.get('since')));
    register('POST', `${roomPattern}/record-preview`, 'student', (req,_res,ctx) => plaza.stage2.prepareRecord(ctx.params[0],req,ctx));
    register('POST', `${roomPattern}/record`, 'student', (req,_res,ctx) => plaza.stage2.finalize(ctx.params[0],req,ctx,ctx.body));
    register('GET', `${roomPattern}/slides`, 'instructor', (_req,_res,ctx) => plaza.stage2.slides(ctx.params[0],ctx));
    register('PUT', `${roomPattern}/slides`, 'instructor', (_req,_res,ctx) => plaza.stage2.slides(ctx.params[0],ctx,ctx.body));
  }
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
    enabled: true, stage4:!!plaza.stage4,stage5:!!plaza.stage5,forDeck: plaza.forDeck,identityBlocked:ctx=>plaza.stage4?plaza.stage4.identityBlocked(ctx):false,
    blocksRecord: async deckId => !!(await deps.one('SELECT 1 FROM plaza_program_versions WHERE deck_id=$1', [deckId])),
  };
}
module.exports = { registerPlazaRoutes };
