'use strict';

const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f]{64}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const at = part.indexOf('=');
    return at < 0 ? ['', ''] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
  }));
}
function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    return origin.host === req.headers.host && ['https:', 'http:'].includes(origin.protocol)
      && req.headers['sec-fetch-site'] !== 'cross-site';
  } catch { return false; }
}
function submission(body) {
  if (!body || !Number.isSafeInteger(body.deck_id) || body.deck_id < 1 || !UUID.test(body.attempt_id || '')) return null;
  const fields = {};
  for (const [key, max, required] of [['process', 1500, true], ['artifact', 1500, false], ['reflection', 1000, true]]) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return null;
    fields[key] = value.trim();
  }
  return { ...fields, deck_id: body.deck_id, attempt_id: body.attempt_id.toLowerCase() };
}

function registerCareerLogRoutes({ route, q, one, withTransaction, json, roleLevel, guestDeckAccess, deckVisibleToStudent, checkAccess, todayInTimezone, cookieSecure, schoolStudentId }) {
  function send(res, status, data) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    return json(res, status, data);
  }
  function fail(res, status, error) { return send(res, status, { error }); }
  async function identity(req, ctx) {
    if (ctx.user.role !== 'student') return null;
    if (ctx.user.school_account_id) {
      // 모아허브 학교 계정: 계정에 붙은 학생 번호를 그대로 쓴다. 학교 수업 기록과 같은 번호다.
      const studentId = await schoolStudentId(ctx.user);
      return studentId ? { student_id: studentId } : null;
    }
    if (!ctx.user.guest_session_id) return one('SELECT student_id FROM career_log.job_identities WHERE account_user_id = $1', [ctx.user.id]);
    const [key, sessionHash, extra] = String(cookies(req).job_career_access || '').split('.');
    if (extra || !KEY.test(key || '') || sessionHash !== digest(ctx.token)) return null;
    return one('SELECT student_id FROM career_log.job_identities WHERE guest_key_hash = $1', [digest(key)]);
  }
  async function resumeIdentity(req) {
    const key = cookies(req).job_career_resume || '';
    if (!KEY.test(key)) return null;
    return one('SELECT student_id FROM career_log.job_identities WHERE guest_key_hash = $1', [digest(key)]);
  }
  const sourceScope = `r.source = 'job'`;
  function staffScope(ctx, params) {
    if (roleLevel(ctx.user.role) >= roleLevel('admin')) return sourceScope;
    params.push(JSON.stringify([ctx.user.id]));
    return `${sourceScope} AND r.raw_data->'job'->'teacher_ids' @> $${params.length}::jsonb`;
  }

  route('GET', /^\/api\/career-log\/profile$/, 'student', async (req, res, ctx) => {
    if (ctx.user.role !== 'student') return send(res, 200, { staff: true });
    const active = await identity(req, ctx);
    return send(res, 200, { active: !!active, guest: !!ctx.user.guest_session_id, school: !!ctx.user.school_account_id, canResume: !active && !!ctx.user.guest_session_id && !!(await resumeIdentity(req)) });
  });

  route('POST', /^\/api\/career-log\/start$/, 'student', async (req, res, ctx) => {
    if (!sameOrigin(req)) return fail(res, 403, '같은 사이트에서 다시 시도해 주세요.');
    if (ctx.user.role !== 'student') return fail(res, 403, '학생만 자신의 기록을 시작할 수 있습니다.');
    if (await identity(req, ctx)) return send(res, 200, { active: true });
    if (ctx.user.school_account_id) return fail(res, 403, '학교 학생 계정이 비활성 상태입니다. 학교 담당 선생님에게 문의하세요.');
    if (ctx.user.guest_session_id && !['new', 'resume'].includes(ctx.body?.mode)) return fail(res, 400, '기록을 이어갈지 새로 시작할지 선택해 주세요.');
    let key = '';
    if (ctx.user.guest_session_id && ctx.body.mode === 'resume') {
      if (!(await resumeIdentity(req))) return fail(res, 409, '이 기기에 연결된 기록이 없습니다. 새로 시작해 주세요.');
      key = cookies(req).job_career_resume;
    } else {
      key = ctx.user.guest_session_id ? crypto.randomBytes(32).toString('hex') : '';
      await withTransaction(async tx => {
        // Account identity is created once even when two tabs start together.
        if (!key) {
          await tx.q("SELECT pg_advisory_xact_lock(hashtext('job-career-account'), $1::integer)", [ctx.user.id]);
          if (await tx.one('SELECT student_id FROM career_log.job_identities WHERE account_user_id = $1', [ctx.user.id])) return;
        }
        const studentId = crypto.randomUUID();
        await tx.q('INSERT INTO career_log.students (id) VALUES ($1)', [studentId]);
        await tx.q('INSERT INTO career_log.job_identities (student_id, account_user_id, guest_key_hash) VALUES ($1, $2, $3)', [studentId, key ? null : ctx.user.id, key ? digest(key) : null]);
      });
    }
    if (key) {
      const flags = `; HttpOnly; SameSite=Strict; Path=/${cookieSecure}`;
      res.setHeader('Set-Cookie', [
        `job_career_resume=${key}; Max-Age=7776000${flags}`,
        `job_career_access=${key}.${digest(ctx.token)}${flags}`,
      ]);
    }
    return send(res, 200, { active: true });
  });

  route('GET', /^\/api\/career-log\/classes$/, 'instructor', async (req, res, ctx) => {
    const params = [];
    const scope = staffScope(ctx, params);
    const classes = await q(`SELECT r.session_ref, max(r.raw_data->'job'->>'session_title') AS title, count(*)::integer AS count
      FROM career_log.records r WHERE ${scope} GROUP BY r.session_ref ORDER BY max(r.occurred_at) DESC LIMIT 200`, params);
    return send(res, 200, { classes });
  });

  route('GET', /^\/api\/career-log\/records$/, 'student', async (req, res, ctx) => {
    const params = [];
    let scope;
    if (ctx.user.role === 'student') {
      const who = await identity(req, ctx);
      if (!who) return send(res, 200, { records: [], needsStart: true, hasMore: false });
      params.push(who.student_id);
      // 학생 본인 조회는 출처를 가리지 않는다. 학교 계정이면 모아허브 학교 수업 기록도 같은 번호로 함께 나온다.
      // 담당자가 정정한 기록은 최신 버전만 보여준다 (원본은 supersedes_id 로 이어진 이력).
      scope = 'r.student_id = $1 AND NOT EXISTS (SELECT 1 FROM career_log.records n WHERE n.student_id = r.student_id AND n.supersedes_id = r.id)';
    } else scope = staffScope(ctx, params);
    const url = new URL(req.url, 'https://job.moakit.ai');
    const sessionRef = url.searchParams.get('class') || '';
    if (sessionRef) { params.push(sessionRef.slice(0, 120)); scope += ` AND r.session_ref = $${params.length}`; }
    const rawPage = url.searchParams.get('page') || '0';
    if (!/^\d{1,5}$/.test(rawPage)) return fail(res, 400, '페이지 값이 올바르지 않습니다.');
    params.push(Number(rawPage) * 25);
    const rows = await q(`SELECT r.id, r.occurred_at, r.process, r.artifact, r.reflection, r.verification_status, r.source, r.program_ref, r.supersedes_id,
        COALESCE(r.raw_data->'job'->>'title', r.raw_data->'job'->>'deck_title') AS title, r.raw_data->'job'->>'session_title' AS session_title,
        r.raw_data->'job'->>'entry_kind' AS entry_kind, r.raw_data->'job'->>'original_source' AS original_source,
        r.raw_data->'job'->>'student_name' AS student_name
      FROM career_log.records r WHERE ${scope} ORDER BY r.occurred_at DESC, r.id DESC LIMIT 26 OFFSET $${params.length}`, params);
    return send(res, 200, { records: rows.slice(0, 25), hasMore: rows.length > 25 });
  });

  route('POST', /^\/api\/career-log\/records$/, 'student', async (req, res, ctx) => {
    if (!sameOrigin(req)) return fail(res, 403, '같은 사이트에서 다시 시도해 주세요.');
    if (ctx.user.role !== 'student') return fail(res, 403, '학생이 직접 기록을 남겨 주세요.');
    const input = submission(ctx.body);
    if (!input) return fail(res, 400, '수업과 활동 과정·돌아보기를 확인해 주세요.');
    const who = await identity(req, ctx);
    if (!who) return fail(res, 409, '먼저 내 진로기록을 시작해 주세요.');
    const deck = await one('SELECT * FROM decks WHERE id = $1', [input.deck_id]);
    if (!deck) return fail(res, 404, '수업 자료를 찾을 수 없습니다.');
    if (ctx.guestSession) {
      if (!(await guestDeckAccess(ctx.guestSession, deck.id)).allowed) return fail(res, 403, '현재 배정·공개된 수업에만 기록을 남길 수 있습니다.');
    } else {
      if (!deckVisibleToStudent(deck, ctx.user, todayInTimezone()) || !(await checkAccess(deck.id)).allowed) return fail(res, 403, '현재 이용할 수 있는 수업에만 기록을 남길 수 있습니다.');
    }
    const eventId = `job:${who.student_id}:${input.attempt_id}`;
    const cs = ctx.guestSession;
    const job = {
      deck_id: deck.id, deck_title: deck.title,
      session_title: cs?.title || deck.title,
      teacher_ids: [...new Set([cs?.created_by, cs?.instructor_id, ...(cs ? [] : [deck.created_by])].filter(Number.isSafeInteger))],
      student_name: ctx.user.name,
      entry_kind: 'student_reflection',
      identity: ctx.user.school_account_id ? 'school-account' : (cs ? 'class-code' : 'job-account'),
    };
    const result = await withTransaction(async tx => {
      await tx.q("SET LOCAL lock_timeout = '5s'");
      await tx.q("SET LOCAL statement_timeout = '8s'");
      await tx.q("SELECT pg_advisory_xact_lock(hashtext('job-career-record'), hashtext($1))", [eventId]);
      const existing = await tx.one("SELECT id, process, artifact, reflection, program_ref FROM career_log.records WHERE source = 'job' AND source_event_id = $1 AND student_id = $2", [eventId, who.student_id]);
      if (existing) {
        const same = existing.process === input.process && (existing.artifact || '') === input.artifact && (existing.reflection || '') === input.reflection && existing.program_ref === `job-deck:${deck.id}`;
        return same ? { id: existing.id, duplicate: true } : { conflict: true };
      }
      const saved = await tx.one(`INSERT INTO career_log.records
        (student_id, session_ref, program_ref, occurred_at, process, artifact, reflection, source,
         verification_status, verified_by, verified_at, raw_data, source_event_id, supersedes_id)
        VALUES ($1, $2, $3, now(), $4, $5, $6, 'job', NULL, NULL, NULL, $7::jsonb, $8, NULL) RETURNING id`,
      [who.student_id, cs ? `job-class:${cs.id}` : `job-account-deck:${deck.id}`, `job-deck:${deck.id}`,
        input.process, input.artifact || null, input.reflection, JSON.stringify({ job }), eventId]);
      return { id: saved.id, duplicate: false };
    });
    if (result.conflict) return fail(res, 409, '이미 저장된 요청의 내용이 달라졌습니다. 새 기록으로 작성해 주세요.');
    return send(res, result.duplicate ? 200 : 201, { ...result, saved: true });
  });
}

module.exports = { registerCareerLogRoutes, submission, sameOrigin, digest };
