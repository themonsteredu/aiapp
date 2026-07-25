'use strict';

const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {
  GWANGJU_RESOURCES,
  cloneDefaultConfig,
  normalizeConfig,
  recommend,
  detectPersonalInfo,
} = require('./gwangju-pick');

const SESSION_TITLES = [
  'AI가 놓친 광주를 발견하다',
  '진짜 이유와 사용자의 문제를 찾다',
  '같은 문제를 다른 직무의 눈으로 보다',
  '나에게 맞는 역할로 웹앱을 기획하다',
  '모아랩에서 AI 웹앱을 제작하고 테스트하다',
  '광주 AI 웹앱 박람회',
];

const SESSION_STATUSES = new Set(['미시작', '작성 중', '확정']);

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function publicProject(row) {
  return {
    id: row.id,
    title: row.title,
    schoolLabel: row.school_label,
    classLabel: row.class_label,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    mission: row.mission,
    templateKey: row.template_key,
    currentSession: row.current_session,
    sessionVisibility: row.session_visibility,
    status: row.status,
    retentionUntil: row.retention_until,
    deleteScheduledAt: row.delete_scheduled_at,
    classSessionId: row.class_session_id,
    classCode: row.class_code,
    teamCount: Number(row.team_count || 0),
    publishedCount: Number(row.published_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canManageProject(user, project, roleLevel) {
  return roleLevel(user.role) >= roleLevel('admin') || project.created_by === user.id;
}

function makeCode(digits) {
  const start = 10 ** (digits - 1);
  return String(crypto.randomInt(start, start * 10));
}

function makeSlug(teamId) {
  return `gwangju-pick-${teamId}-${crypto.randomBytes(3).toString('hex')}`;
}

function sessionIsOpen(project, sessionNo) {
  const visibility = Array.isArray(project.session_visibility) ? project.session_visibility : [];
  return Number(project.current_session || 1) >= sessionNo && visibility[sessionNo - 1] !== false;
}

function publicAppUrl(req, slug) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}/#/p/${encodeURIComponent(slug)}`;
}

function resourceRowsToObjects(rows) {
  return rows.map((row) => ({
    ...(row.data || {}),
    id: row.resource_key,
    name: row.official_name,
    sourceUrl: row.source_url,
    checkedAt: row.checked_at,
    verificationStatus: row.verification_status,
    operatorMemo: row.operator_memo,
  }));
}

async function projectResources(q, projectId) {
  const rows = await q(
    `SELECT ri.* FROM resource_items ri
     JOIN projects p ON p.dataset_id = ri.dataset_id
     WHERE p.id = $1 ORDER BY ri.id`,
    [projectId]
  );
  return resourceRowsToObjects(rows);
}

async function currentContext(one, q, ctx) {
  if (!ctx.user?.guest_session_id || !ctx.user?.project_team_id) return null;
  const project = await one(
    `SELECT p.*, cs.code AS class_code
     FROM projects p
     JOIN project_teams pt ON pt.project_id = p.id
     LEFT JOIN class_sessions cs ON cs.id = p.class_session_id
     WHERE pt.id = $1`,
    [ctx.user.project_team_id]
  );
  if (!project) return null;
  const team = await one('SELECT * FROM project_teams WHERE id = $1 AND project_id = $2', [ctx.user.project_team_id, project.id]);
  if (!team) return null;
  await q(
    `INSERT INTO project_members (team_id, anonymous_no)
     VALUES ($1, $2)
     ON CONFLICT (team_id, anonymous_no) DO UPDATE SET last_seen_at = now()`,
    [team.id, ctx.user.anonymous_no || '익명']
  );
  return { project, team };
}

function configFromSessionFour(payload) {
  const base = cloneDefaultConfig();
  const planning = payload?.appPlan || payload?.servicePlan || payload || {};
  const picked = Array.isArray(planning.selectedResources)
    ? planning.selectedResources
    : Array.isArray(planning.resourceIds) ? planning.resourceIds : [];
  return normalizeConfig({
    ...base,
    serviceName: clean(planning.serviceName, 40) || base.serviceName,
    tagline: clean(planning.tagline, 120) || base.tagline,
    slogan: clean(planning.slogan, 80) || base.slogan,
    primaryColor: planning.primaryColor || base.primaryColor,
    options: planning.options || base.options,
    weights: planning.weights || base.weights,
    resourceIds: picked.length ? picked : undefined,
  });
}

function registerProjectRoutes(deps) {
  const {
    route, q, one, withTransaction, log, json, badRequest, forbidden, notFound, roleLevel, TS,
  } = deps;

  route('GET', /^\/api\/join-info\/(\d{6})$/, null, async (req, res, ctx) => {
    const row = await one(
      `SELECT cs.title, cs.active, cs.expires_at, cs.project_id, p.school_label, p.class_label
       FROM class_sessions cs
       LEFT JOIN projects p ON p.id = cs.project_id
       WHERE cs.code = $1`,
      [ctx.params[0]]
    );
    if (!row || !row.active || new Date(row.expires_at) <= new Date()) return notFound(res);
    json(res, 200, {
      valid: true,
      title: row.title,
      isProject: !!row.project_id,
      schoolLabel: row.project_id ? row.school_label : '',
      classLabel: row.project_id ? row.class_label : '',
    });
  });

  route('GET', /^\/api\/resource-datasets\/gwangju$/, 'instructor', async (req, res) => {
    const rows = await q(
      `SELECT ri.* FROM resource_items ri
       JOIN resource_datasets rd ON rd.id = ri.dataset_id
       WHERE rd.slug = 'gwangju-verified-v1' ORDER BY ri.id`
    );
    json(res, 200, { resources: resourceRowsToObjects(rows) });
  });

  route('GET', /^\/api\/projects$/, 'instructor', async (req, res, ctx) => {
    const where = roleLevel(ctx.user.role) >= roleLevel('admin') ? '' : 'WHERE p.created_by = $1';
    const rows = await q(
      `SELECT p.*, cs.code AS class_code, ${TS('p.created_at')} AS created_at, ${TS('p.updated_at')} AS updated_at,
         (SELECT count(*)::int FROM project_teams pt WHERE pt.project_id = p.id) AS team_count,
         (SELECT count(*)::int FROM published_apps pa JOIN project_teams pt ON pt.id = pa.team_id
          WHERE pt.project_id = p.id AND pa.active = true) AS published_count
       FROM projects p LEFT JOIN class_sessions cs ON cs.id = p.class_session_id
       ${where} ORDER BY p.id DESC`,
      where ? [ctx.user.id] : []
    );
    json(res, 200, { projects: rows.map(publicProject) });
  });

  route('POST', /^\/api\/projects$/, 'instructor', async (req, res, ctx) => {
    const body = ctx.body || {};
    const title = clean(body.title, 100);
    if (!title) return badRequest(res, '프로젝트명을 입력하세요.');
    const teamCount = Math.max(1, Math.min(20, Number(body.teamCount) || 6));
    const currentSession = Math.max(1, Math.min(6, Number(body.currentSession) || 1));
    const startsOn = /^\d{4}-\d{2}-\d{2}$/.test(body.startsOn || '') ? body.startsOn : null;
    const endsOn = /^\d{4}-\d{2}-\d{2}$/.test(body.endsOn || '') ? body.endsOn : null;
    const created = await withTransaction(async ({ q: txQ, one: txOne }) => {
      const dataset = await txOne("SELECT id FROM resource_datasets WHERE slug = 'gwangju-verified-v1' AND active = true");
      if (!dataset) throw new Error('광주 자원 데이터셋을 찾을 수 없습니다.');

      let classCode = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = makeCode(6);
        if (!(await txOne('SELECT id FROM class_sessions WHERE code = $1', [candidate]))) {
          classCode = candidate;
          break;
        }
      }
      if (!classCode) throw new Error('입장 코드 생성에 실패했습니다.');

      const project = await txOne(
        `INSERT INTO projects
         (title, school_label, class_label, starts_on, ends_on, mission, template_key, dataset_id,
          current_session, session_visibility, retention_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'gwangju-pick', $7, $8, $9::jsonb,
          COALESCE($5::date + interval '30 days', current_date + interval '60 days'), $10)
         RETURNING *`,
        [
          title,
          clean(body.schoolLabel, 80),
          clean(body.classLabel, 80),
          startsOn,
          endsOn,
          clean(body.mission, 1000) || '광주 지역자원을 검증하고, 우리 팀의 추천형 AI 웹앱을 완성한다.',
          dataset.id,
          currentSession,
          JSON.stringify(Array.from({ length: 6 }, (_, index) => index < currentSession)),
          ctx.user.id,
        ]
      );
      const expires = endsOn ? `${endsOn} 23:59:59+09` : null;
      const classSession = await txOne(
        `INSERT INTO class_sessions
         (code, title, created_by, instructor_id, expires_at, project_id)
         VALUES ($1, $2, $3, $3, COALESCE($4::timestamptz, now() + interval '60 days'), $5)
         RETURNING *`,
        [classCode, title, ctx.user.id, expires, project.id]
      );
      await txQ('UPDATE projects SET class_session_id = $1 WHERE id = $2', [classSession.id, project.id]);

      const teams = [];
      const used = new Set();
      for (let i = 0; i < teamCount; i++) {
        let teamCode = '';
        while (!teamCode || used.has(teamCode)) teamCode = makeCode(4);
        used.add(teamCode);
        const team = await txOne(
          `INSERT INTO project_teams (project_id, team_name, team_code)
           VALUES ($1, $2, $3) RETURNING *`,
          [project.id, `익명 ${String.fromCharCode(65 + i)}팀`, teamCode]
        );
        teams.push(team);
        for (let sessionNo = 1; sessionNo <= 6; sessionNo++) {
          await txQ(
            'INSERT INTO session_progress (team_id, session_no) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [team.id, sessionNo]
          );
        }
        await txQ(
          `INSERT INTO app_configs (team_id, config, updated_by)
           VALUES ($1, $2::jsonb, $3) ON CONFLICT (team_id) DO NOTHING`,
          [team.id, JSON.stringify(normalizeConfig({})), ctx.user.id]
        );
      }
      return { project, classCode, teams };
    });
    await log(ctx.user, 'project_created', `프로젝트=${title} 입장코드=${created.classCode} 팀=${teamCount}`, req);
    json(res, 200, {
      ok: true,
      projectId: created.project.id,
      classCode: created.classCode,
      teams: created.teams.map((t) => ({ id: t.id, name: t.team_name, code: t.team_code })),
    });
  });

  route('GET', /^\/api\/projects\/(\d+)$/, 'instructor', async (req, res, ctx) => {
    const project = await one(
      `SELECT p.*, cs.code AS class_code, ${TS('p.created_at')} AS created_at, ${TS('p.updated_at')} AS updated_at
       FROM projects p LEFT JOIN class_sessions cs ON cs.id = p.class_session_id WHERE p.id = $1`,
      [Number(ctx.params[0])]
    );
    if (!project) return notFound(res);
    if (!canManageProject(ctx.user, project, roleLevel)) return forbidden(res);
    const teams = await q(
      `SELECT pt.*,
         COALESCE((SELECT max(sp.session_no) FILTER (WHERE sp.status <> '미시작')
                   FROM session_progress sp WHERE sp.team_id = pt.id), 0)::int AS progress_session,
         COALESCE((SELECT max(sp.last_saved_at) FROM session_progress sp WHERE sp.team_id = pt.id), pt.created_at) AS last_saved_at,
         pa.slug, pa.published_at,
         (SELECT count(*)::int FROM project_members pm WHERE pm.team_id = pt.id) AS member_count
       FROM project_teams pt
       LEFT JOIN published_apps pa ON pa.team_id = pt.id AND pa.active = true
       WHERE pt.project_id = $1 ORDER BY pt.id`,
      [project.id]
    );
    const progress = await q(
      `SELECT sp.team_id, sp.session_no, sp.status, sp.last_saved_at, sp.confirmed_at
       FROM session_progress sp JOIN project_teams pt ON pt.id = sp.team_id
       WHERE pt.project_id = $1 ORDER BY sp.team_id, sp.session_no`,
      [project.id]
    );
    json(res, 200, {
      project: publicProject(project),
      teams: teams.map((team) => ({
        id: team.id,
        name: team.team_name,
        code: team.team_code,
        status: team.slug ? '배포 완료' : (team.progress_session >= 5 ? '제작 중' : team.progress_session ? '작성 중' : '미시작'),
        progressSession: team.progress_session,
        lastSavedAt: team.last_saved_at,
        memberCount: team.member_count,
        publishedSlug: team.slug || '',
        publishedAt: team.published_at,
      })),
      progress,
    });
  });

  route('GET', /^\/api\/projects\/(\d+)\/teams\/(\d+)$/, 'instructor', async (req, res, ctx) => {
    const project = await one(
      `SELECT p.*, cs.code AS class_code
       FROM projects p LEFT JOIN class_sessions cs ON cs.id = p.class_session_id
       WHERE p.id = $1`,
      [Number(ctx.params[0])]
    );
    if (!project) return notFound(res);
    if (!canManageProject(ctx.user, project, roleLevel)) return forbidden(res);
    const team = await one(
      `SELECT pt.*, pa.slug, pa.published_at
       FROM project_teams pt
       LEFT JOIN published_apps pa ON pa.team_id = pt.id AND pa.active = true
       WHERE pt.id = $1 AND pt.project_id = $2`,
      [Number(ctx.params[1]), project.id]
    );
    if (!team) return notFound(res);
    const [progress, members, feedback, reflections, assessments, configRow, versions] = await Promise.all([
      q(
        `SELECT session_no, status, draft_data, confirmed_data, last_saved_at, confirmed_at
         FROM session_progress WHERE team_id = $1 ORDER BY session_no`,
        [team.id]
      ),
      q(
        `SELECT anonymous_no, team_role, last_seen_at
         FROM project_members WHERE team_id = $1 ORDER BY anonymous_no`,
        [team.id]
      ),
      q(
        `SELECT tester_code, liked, confusing, suggestion, created_at
         FROM user_test_feedback WHERE team_id = $1 ORDER BY id DESC`,
        [team.id]
      ),
      q(
        `SELECT anonymous_no, reflection, updated_at
         FROM career_reflections WHERE team_id = $1 ORDER BY anonymous_no`,
        [team.id]
      ),
      q(
        `SELECT anonymous_no, phase, answers, score, updated_at
         FROM assessment_results WHERE team_id = $1 ORDER BY phase, anonymous_no`,
        [team.id]
      ),
      one('SELECT config, updated_at FROM app_configs WHERE team_id = $1', [team.id]),
      q(
        `SELECT version_no, status, notes, created_at
         FROM app_versions WHERE team_id = $1 ORDER BY version_no DESC`,
        [team.id]
      ),
    ]);
    json(res, 200, {
      project: publicProject(project),
      team: {
        id: team.id,
        name: team.team_name,
        code: team.team_code,
        status: team.status,
        publishedSlug: team.slug || '',
        publishedAt: team.published_at,
      },
      progress,
      members,
      feedback,
      reflections,
      assessments,
      config: normalizeConfig(configRow?.config || {}),
      configUpdatedAt: configRow?.updated_at,
      versions,
    });
  });

  route('PATCH', /^\/api\/projects\/(\d+)$/, 'instructor', async (req, res, ctx) => {
    const project = await one('SELECT * FROM projects WHERE id = $1', [Number(ctx.params[0])]);
    if (!project) return notFound(res);
    if (!canManageProject(ctx.user, project, roleLevel)) return forbidden(res);
    const body = ctx.body || {};
    const currentSession = Math.max(1, Math.min(6, Number(body.currentSession || project.current_session)));
    const visibility = Array.isArray(body.sessionVisibility)
      ? body.sessionVisibility.slice(0, 6).map(Boolean)
      : Array.from({ length: 6 }, (_, i) => i < currentSession);
    await q(
      `UPDATE projects SET current_session = $1, session_visibility = $2::jsonb,
       status = COALESCE($3, status), updated_at = now() WHERE id = $4`,
      [currentSession, JSON.stringify(visibility), body.status ? clean(body.status, 30) : null, project.id]
    );
    await log(ctx.user, 'project_updated', `프로젝트=${project.title} 현재차시=${currentSession}`, req);
    json(res, 200, { ok: true });
  });

  route('DELETE', /^\/api\/projects\/(\d+)$/, 'instructor', async (req, res, ctx) => {
    const project = await one('SELECT * FROM projects WHERE id = $1', [Number(ctx.params[0])]);
    if (!project) return notFound(res);
    if (!canManageProject(ctx.user, project, roleLevel)) return forbidden(res);
    await q('UPDATE class_sessions SET active = false WHERE id = $1', [project.class_session_id]);
    await q('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE guest_session_id = $1)', [project.class_session_id]);
    await q(
      `UPDATE projects SET status = 'archived',
       delete_scheduled_at = COALESCE(delete_scheduled_at, now() + interval '30 days'),
       updated_at = now() WHERE id = $1`,
      [project.id]
    );
    await log(ctx.user, 'project_archived', `프로젝트=${project.title}`, req);
    json(res, 200, { ok: true, archived: true });
  });

  route('GET', /^\/api\/project\/current$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    const progress = await q(
      `SELECT session_no, status, draft_data, confirmed_data, last_saved_at, confirmed_at
       FROM session_progress WHERE team_id = $1 ORDER BY session_no`,
      [current.team.id]
    );
    const configRow = await one('SELECT config, updated_at FROM app_configs WHERE team_id = $1', [current.team.id]);
    const published = await one('SELECT slug, published_at FROM published_apps WHERE team_id = $1 AND active = true', [current.team.id]);
    json(res, 200, {
      project: publicProject(current.project),
      team: { id: current.team.id, name: current.team.team_name, code: current.team.team_code },
      anonymousNo: ctx.user.anonymous_no,
      sessionTitles: SESSION_TITLES,
      progress,
      config: normalizeConfig(configRow?.config || {}),
      configUpdatedAt: configRow?.updated_at,
      resources: await projectResources(q, current.project.id),
      published: published ? { slug: published.slug, publishedAt: published.published_at } : null,
    });
  });

  route('PATCH', /^\/api\/project\/current\/sessions\/([1-6])$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    const sessionNo = Number(ctx.params[0]);
    const visibility = Array.isArray(current.project.session_visibility) ? current.project.session_visibility : [];
    if (sessionNo > current.project.current_session || visibility[sessionNo - 1] === false) {
      return forbidden(res, '교사가 아직 공개하지 않은 차시입니다.');
    }
    const action = clean(ctx.body?.action, 20) || 'draft';
    const data = ctx.body?.data && typeof ctx.body.data === 'object' ? ctx.body.data : {};
    const findings = detectPersonalInfo(data);
    if (findings.length) {
      return badRequest(res, `개인정보로 보이는 내용(${findings.join(', ')})을 지운 뒤 저장하세요.`);
    }
    const status = action === 'confirm' ? '확정' : '작성 중';
    if (!SESSION_STATUSES.has(status)) return badRequest(res, '저장 상태가 올바르지 않습니다.');
    await q(
      `INSERT INTO session_progress
       (team_id, session_no, status, draft_data, confirmed_data, last_saved_at, confirmed_at)
       VALUES ($1, $2, $3, $4::jsonb, CASE WHEN $3 = '확정' THEN $4::jsonb ELSE NULL END,
               now(), CASE WHEN $3 = '확정' THEN now() ELSE NULL END)
       ON CONFLICT (team_id, session_no) DO UPDATE SET
         status = EXCLUDED.status,
         draft_data = EXCLUDED.draft_data,
         confirmed_data = CASE WHEN EXCLUDED.status = '확정' THEN EXCLUDED.draft_data ELSE session_progress.confirmed_data END,
         last_saved_at = now(),
         confirmed_at = CASE WHEN EXCLUDED.status = '확정' THEN now() ELSE session_progress.confirmed_at END`,
      [current.team.id, sessionNo, status, JSON.stringify(data)]
    );
    if (sessionNo === 4 && action === 'confirm') {
      const config = configFromSessionFour(data);
      await q(
        `INSERT INTO app_configs (team_id, config, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (team_id) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [current.team.id, JSON.stringify(config), ctx.user.id]
      );
    }
    await q('UPDATE project_teams SET status = $1, updated_at = now() WHERE id = $2', [status, current.team.id]);
    await log(ctx.user, action === 'confirm' ? 'project_session_confirmed' : 'project_session_saved',
      `project=${current.project.id} team=${current.team.id} session=${sessionNo}`, req);
    json(res, 200, { ok: true, status, savedAt: new Date().toISOString() });
  });

  route('PATCH', /^\/api\/project\/current\/app-config$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    if (!sessionIsOpen(current.project, 5)) return forbidden(res, '5차시가 공개된 뒤 제작할 수 있습니다.');
    const existing = await one('SELECT config FROM app_configs WHERE team_id = $1', [current.team.id]);
    const merged = normalizeConfig({ ...(existing?.config || {}), ...(ctx.body?.config || {}) });
    const findings = detectPersonalInfo(merged);
    if (findings.length) return badRequest(res, `개인정보로 보이는 내용(${findings.join(', ')})을 지운 뒤 저장하세요.`);
    await q(
      `INSERT INTO app_configs (team_id, config, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (team_id) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [current.team.id, JSON.stringify(merged), ctx.user.id]
    );
    await q(
      `UPDATE session_progress SET status = '작성 중', last_saved_at = now()
       WHERE team_id = $1 AND session_no = 5 AND status = '미시작'`,
      [current.team.id]
    );
    json(res, 200, { ok: true, config: merged });
  });

  route('POST', /^\/api\/project\/current\/recommend$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    const configRow = await one('SELECT config FROM app_configs WHERE team_id = $1', [current.team.id]);
    const resources = await projectResources(q, current.project.id);
    const results = recommend({ input: ctx.body?.input || {}, config: configRow?.config || {}, resources, limit: 3 });
    json(res, 200, { results, explanationMode: 'verified-rule-fallback' });
  });

  route('POST', /^\/api\/project\/current\/feedback$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    if (!sessionIsOpen(current.project, 5)) return forbidden(res, '5차시가 공개된 뒤 사용자 테스트를 저장할 수 있습니다.');
    const feedback = {
      liked: clean(ctx.body?.liked, 1000),
      confusing: clean(ctx.body?.confusing, 1000),
      suggestion: clean(ctx.body?.suggestion, 1000),
    };
    const findings = detectPersonalInfo(feedback);
    if (findings.length) return badRequest(res, `개인정보로 보이는 내용(${findings.join(', ')})을 지워 주세요.`);
    await q(
      `INSERT INTO user_test_feedback (team_id, tester_code, liked, confusing, suggestion)
       VALUES ($1, $2, $3, $4, $5)`,
      [current.team.id, ctx.user.anonymous_no || '', feedback.liked, feedback.confusing, feedback.suggestion]
    );
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/project\/current\/reflection$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    if (!sessionIsOpen(current.project, 6)) return forbidden(res, '6차시가 공개된 뒤 진로성찰을 저장할 수 있습니다.');
    const reflection = ctx.body?.reflection || {};
    const findings = detectPersonalInfo(reflection);
    if (findings.length) return badRequest(res, `개인정보로 보이는 내용(${findings.join(', ')})을 지워 주세요.`);
    await q(
      `INSERT INTO career_reflections (team_id, anonymous_no, reflection)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (team_id, anonymous_no) DO UPDATE SET reflection = EXCLUDED.reflection, updated_at = now()`,
      [current.team.id, ctx.user.anonymous_no || '익명', JSON.stringify(reflection)]
    );
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/project\/current\/assessment\/(pre|post|peer)$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    const phase = ctx.params[0];
    const requiredSession = phase === 'pre' ? 1 : 6;
    if (!sessionIsOpen(current.project, requiredSession)) {
      return forbidden(res, `${requiredSession}차시가 공개된 뒤 저장할 수 있습니다.`);
    }
    const answers = ctx.body?.answers || {};
    const score = ctx.body?.score || {};
    const findings = detectPersonalInfo({ answers, score });
    if (findings.length) return badRequest(res, `개인정보로 보이는 내용(${findings.join(', ')})을 지워 주세요.`);
    await q(
      `INSERT INTO assessment_results (team_id, anonymous_no, phase, answers, score)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (team_id, anonymous_no, phase) DO UPDATE SET
         answers = EXCLUDED.answers, score = EXCLUDED.score, updated_at = now()`,
      [current.team.id, ctx.user.anonymous_no || '익명', phase, JSON.stringify(answers), JSON.stringify(score)]
    );
    json(res, 200, { ok: true });
  });

  route('POST', /^\/api\/project\/current\/version$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    if (!sessionIsOpen(current.project, 5)) return forbidden(res, '5차시가 공개된 뒤 버전을 저장할 수 있습니다.');
    const configRow = await one('SELECT config FROM app_configs WHERE team_id = $1', [current.team.id]);
    const next = (await one('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM app_versions WHERE team_id = $1', [current.team.id])).n;
    const version = await one(
      `INSERT INTO app_versions (team_id, version_no, config, status, notes, created_by)
       VALUES ($1, $2, $3::jsonb, 'draft', $4, $5) RETURNING *`,
      [current.team.id, next, JSON.stringify(normalizeConfig(configRow?.config || {})), clean(ctx.body?.notes, 1000), ctx.user.id]
    );
    json(res, 200, { ok: true, versionNo: version.version_no });
  });

  route('POST', /^\/api\/project\/current\/publish$/, 'student', async (req, res, ctx) => {
    const current = await currentContext(one, q, ctx);
    if (!current) return notFound(res);
    if (!sessionIsOpen(current.project, 6)) return forbidden(res, '6차시가 공개된 뒤 최종 배포할 수 있습니다.');
    const configRow = await one('SELECT config FROM app_configs WHERE team_id = $1', [current.team.id]);
    const next = (await one('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM app_versions WHERE team_id = $1', [current.team.id])).n;
    const version = await one(
      `INSERT INTO app_versions (team_id, version_no, config, status, notes, created_by)
       VALUES ($1, $2, $3::jsonb, 'published', $4, $5) RETURNING *`,
      [current.team.id, next, JSON.stringify(normalizeConfig(configRow?.config || {})), clean(ctx.body?.notes, 1000), ctx.user.id]
    );
    const existing = await one('SELECT * FROM published_apps WHERE team_id = $1', [current.team.id]);
    const slug = existing?.slug || makeSlug(current.team.id);
    await q(
      `INSERT INTO published_apps (team_id, version_id, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id) DO UPDATE SET version_id = EXCLUDED.version_id, active = true,
         published_at = now(), updated_at = now()`,
      [current.team.id, version.id, slug]
    );
    await q("UPDATE project_teams SET status = '배포 완료', updated_at = now() WHERE id = $1", [current.team.id]);
    await q(
      `UPDATE session_progress SET status = '확정', confirmed_at = COALESCE(confirmed_at, now()), last_saved_at = now()
       WHERE team_id = $1 AND session_no = 6`,
      [current.team.id]
    );
    await log(ctx.user, 'project_app_published', `project=${current.project.id} team=${current.team.id} slug=${slug}`, req);
    json(res, 200, {
      ok: true,
      slug,
      url: `/#/p/${encodeURIComponent(slug)}`,
      qrUrl: `/api/public/apps/${encodeURIComponent(slug)}/qr`,
      versionNo: version.version_no,
    });
  });

  route('GET', /^\/api\/public\/apps\/([a-z0-9-]+)$/, null, async (req, res, ctx) => {
    const row = await one(
      `SELECT pa.slug, pa.published_at, pt.team_name, p.id AS project_id, p.title AS project_title,
         av.config
       FROM published_apps pa
       JOIN project_teams pt ON pt.id = pa.team_id
       JOIN projects p ON p.id = pt.project_id
       JOIN app_versions av ON av.id = pa.version_id
       WHERE pa.slug = $1 AND pa.active = true`,
      [ctx.params[0]]
    );
    if (!row) return notFound(res);
    json(res, 200, {
      app: {
        slug: row.slug,
        teamName: row.team_name,
        projectTitle: row.project_title,
        publishedAt: row.published_at,
        config: normalizeConfig(row.config || {}),
      },
      resources: await projectResources(q, row.project_id),
    });
  });

  route('POST', /^\/api\/public\/apps\/([a-z0-9-]+)\/recommend$/, null, async (req, res, ctx) => {
    const row = await one(
      `SELECT p.id AS project_id, av.config
       FROM published_apps pa
       JOIN project_teams pt ON pt.id = pa.team_id
       JOIN projects p ON p.id = pt.project_id
       JOIN app_versions av ON av.id = pa.version_id
       WHERE pa.slug = $1 AND pa.active = true`,
      [ctx.params[0]]
    );
    if (!row) return notFound(res);
    const resources = await projectResources(q, row.project_id);
    const results = recommend({ input: ctx.body?.input || {}, config: row.config || {}, resources, limit: 3 });
    json(res, 200, { results, explanationMode: 'verified-rule-fallback' });
  });

  route('GET', /^\/api\/public\/apps\/([a-z0-9-]+)\/qr$/, null, async (req, res, ctx) => {
    const row = await one(
      `SELECT pa.slug FROM published_apps pa
       WHERE pa.slug = $1 AND pa.active = true`,
      [ctx.params[0]]
    );
    if (!row) return notFound(res);
    const svg = await QRCode.toString(publicAppUrl(req, row.slug), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#17324d', light: '#ffffff' },
    });
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(svg);
  });
}

module.exports = { registerProjectRoutes, SESSION_TITLES, configFromSessionFour };
