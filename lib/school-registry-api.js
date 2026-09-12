'use strict';

// 모아랩 학교·기관 학생 계정 발급 API. 로직은 lib/school-registry.js, 화면은 public/school-accounts-ui.js.
// 강사 이상만 부르고, 변경 요청은 같은 출처에서만 받는다. 응답은 캐시하지 않는다.
const { sameOrigin } = require('./career-log');

const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const path = suffix => new RegExp(`^/api/school-accounts/schools/${ID}${suffix}$`, 'i');

function registerSchoolRegistryRoutes({ route, one, json, log, registry }) {
  function send(res, status, data) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    return json(res, status, data);
  }
  const guard = handler => async (req, res, ctx) => {
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: '같은 사이트에서 다시 시도해 주세요.' });
    try { return await handler(req, res, ctx); }
    catch (e) {
      if (!e.status) throw e;
      return send(res, e.status, { error: e.message });
    }
  };

  route('GET', /^\/api\/school-accounts\/schools$/, 'instructor', guard(async (req, res, ctx) =>
    send(res, 200, { schools: await registry.schools(ctx.user) })));

  route('POST', /^\/api\/school-accounts\/schools$/, 'admin', guard(async (req, res, ctx) => {
    const school = await registry.createSchool(ctx.user, ctx.body?.name);
    await log(ctx.user, 'school_created', `${school.name} (${school.id})`, req);
    return send(res, 201, school);
  }));

  route('PATCH', path('/access'), 'admin', guard(async (req, res, ctx) => {
    const issuer = String(ctx.body?.issuer || '');
    const enabled = ctx.body?.enabled === true;
    await registry.setAccess(ctx.user, ctx.params[0], issuer, enabled);
    await log(ctx.user, enabled ? 'school_opened' : 'school_closed', `${issuer} school=${ctx.params[0]}`, req);
    return send(res, 200, { ok: true });
  }));

  route('POST', path('/managers'), 'admin', guard(async (req, res, ctx) => {
    const id = Number(ctx.body?.instructorId);
    if (!Number.isSafeInteger(id) || id < 1) return send(res, 400, { error: '담당 강사를 선택하세요.' });
    const target = await one('SELECT id, role, active, school_account_id FROM users WHERE id = $1', [id]);
    if (!target || !target.active || target.school_account_id || !['instructor', 'admin', 'superadmin'].includes(target.role)) {
      return send(res, 400, { error: '활성 강사 계정을 확인하세요.' });
    }
    await registry.grantManager(ctx.user, ctx.params[0], String(target.id));
    await log(ctx.user, 'school_manager_granted', `instructor=${target.id} school=${ctx.params[0]}`, req);
    return send(res, 200, { ok: true });
  }));

  route('GET', path('/students'), 'instructor', guard(async (req, res, ctx) =>
    send(res, 200, { students: await registry.list(ctx.user, ctx.params[0]) })));

  route('POST', path('/students'), 'instructor', guard(async (req, res, ctx) => {
    const students = await registry.provision(ctx.user, ctx.params[0], ctx.body?.students);
    await log(ctx.user, 'school_accounts_issued', `${students.length}명 school=${ctx.params[0]}`, req);
    return send(res, 201, { students });
  }));

  route('PATCH', path(`/students/${ID}`), 'instructor', guard(async (req, res, ctx) => {
    await registry.updateMember(ctx.user, ctx.params[0], ctx.params[1], ctx.body || {});
    return send(res, 200, { ok: true });
  }));

  route('POST', path(`/students/${ID}/reset`), 'instructor', guard(async (req, res, ctx) => {
    const result = await registry.reset(ctx.user, ctx.params[0], ctx.params[1]);
    await log(ctx.user, 'school_account_password_reset', `account=${ctx.params[1]} school=${ctx.params[0]}`, req);
    return send(res, 200, result);
  }));
}

module.exports = { registerSchoolRegistryRoutes };
