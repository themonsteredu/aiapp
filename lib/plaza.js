'use strict';
const crypto = require('node:crypto');
const { digest } = require('./career-log');
const { jpegInput } = require('./plaza-storage');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secret = () => crypto.randomBytes(32).toString('hex');
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(s => { const at = s.indexOf('='); return [s.slice(0, at).trim(), s.slice(at + 1).trim()]; }));
}
const cookieName = roomId => `plaza_grant_${roomId.replaceAll('-', '')}`;
function draftInput(body, card) {
  if (!UUID.test(body?.attempt_id || '') || !Number.isSafeInteger(body.version) || body.version < 0) fail(400, '저장 번호를 확인해 주세요.');
  const content = {};
  for (const [key, max] of [['customer_id', 60], ['plan', 500], ['artwork_name', 40], ['store_name', 40]]) {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, '손님, 구상, 작품 이름과 가게 이름을 모두 적어 주세요.');
    content[key] = value.trim();
  }
  if (!card.customers.some(c => c.id === content.customer_id)) fail(400, '손님 카드를 확인해 주세요.');
  return { content, digest: digest(JSON.stringify(content)), attempt: body.attempt_id, version: body.version };
}

function createPlaza({ withTransaction, config, storage, guestDeckAccess, canManageSession, aiProvider }) {
  async function transaction(work) {
    return withTransaction(async tx => {
      await tx.q("SET LOCAL lock_timeout = '5s'");
      const marker = await tx.one('SELECT * FROM plaza_environment WHERE singleton AND database_name = current_database()');
      if (!marker || marker.test_id !== config.testId || marker.purpose !== 'stage1-local-test') fail(503, '광장 시험 환경을 확인해 주세요.');
      return work(tx);
    });
  }
  async function roomFor(tx, id, ctx, staff = false, allowClosed = false) {
    if (!UUID.test(id || '')) fail(404, '광장을 찾을 수 없습니다.');
    // All writes and access revocations serialize through the room lock.
    const room = await tx.one('SELECT * FROM plaza_rooms WHERE id = $1 FOR UPDATE', [id]);
    if (!room) fail(404, '광장을 찾을 수 없습니다.');
    const cs = await tx.one('SELECT * FROM class_sessions WHERE id = $1 FOR SHARE', [room.class_session_id]);
    if (staff) {
      if (!['instructor','admin','superadmin'].includes(ctx.user.role) || !canManageSession(ctx.user, cs)) fail(403, '담당 수업의 강사만 이용할 수 있습니다.');
    } else if (ctx.user.role !== 'student' || !ctx.guestSession || ctx.user.guest_session_id !== cs.id) {
      fail(403, '이번 수업의 입장 코드로 접속해 주세요.');
    }
    // Recheck the login inside the transaction, not only in the API dispatcher.
    if (!(await tx.one('SELECT 1 FROM sessions WHERE token = $1 AND user_id = $2 AND expires_at > now()', [ctx.token, ctx.user.id]))) fail(401, '접속이 만료되었습니다.');
    if (!cs.active || new Date(cs.expires_at) <= new Date()) fail(403, '수업 이용 시간이 끝났습니다.', 'class_expired');
    if (!allowClosed && room.state === 'closed') fail(403, '종료된 광장입니다.', 'plaza_closed');
    const deck = await tx.one('SELECT * FROM decks WHERE id = $1', [room.deck_id]);
    if (!deck || !(await guestDeckAccess(cs, deck.id, tx)).allowed) fail(403, '현재 배정·공개된 자료만 이용할 수 있습니다.', 'deck_blocked');
    const program = await tx.one('SELECT card FROM plaza_program_versions WHERE id = $1 AND deck_id = $2', [room.program_version_id, room.deck_id]);
    return { ...room, cs, title: deck.title, card: program.card };
  }
  const event = (tx, room, user, kind, participant = null, details = {}) => tx.q(
    'INSERT INTO plaza_events (room_id, participant_id, actor_user_id, kind, details) VALUES ($1,$2,$3,$4,$5)',
    [room.id, participant, user.id, kind, details]);
  async function grantFor(tx, room, req, ctx, allowRebind = false) {
    const key = cookies(req)[cookieName(room.id)];
    if (!/^[0-9a-f]{64}$/.test(key || '')) return null;
    return tx.one(`SELECT g.*, p.seat_order, p.store_public_id, p.student_uuid, p.target_version, p.current_photo_id
      FROM plaza_device_grants g JOIN plaza_participants p ON p.id = g.participant_id AND p.room_id = g.room_id
      WHERE g.room_id = $1 AND g.secret_hash = $2 AND g.revoked_at IS NULL AND g.expires_at > now()
        AND p.status = 'active' ${config.stage3 ? "AND p.attendance='present'" : ''} ${allowRebind ? '' : 'AND g.session_hash = $3 AND g.login_user_id = $4'}`,
    allowRebind ? [room.id, digest(key)] : [room.id, digest(key), digest(ctx.token), ctx.user.id]);
  }
  async function own(tx, room, req, ctx) {
    const grant = await grantFor(tx, room, req, ctx);
    if (!grant) fail(403, '내 자리로 다시 입장해 주세요.', 'grant_required');
    return grant;
  }
  async function revoke(tx, grant, ctx, leave = false) {
    await tx.q('UPDATE plaza_device_grants SET revoked_at = now(), version = version + 1 WHERE id = $1', [grant.id]);
    // Retire the guest resume credential as well as the plaza grant. Records stay immutable.
    await tx.q('UPDATE career_log.job_identities SET guest_key_hash = $1 WHERE student_id = $2 AND guest_key_hash IS NOT NULL', [digest(secret()), grant.student_uuid]);
    await tx.q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [grant.login_user_id, ctx.token]);
    if (leave) await tx.q("UPDATE plaza_participants SET status = 'left' WHERE id = $1", [grant.participant_id]);
  }
  const publicRoom = room => ({ id: room.id, title: room.title, state: room.state, version: room.version, seat_count: room.seat_count, customers: room.card.customers, stage2: !!config.stage2, stage3: !!config.stage3 });
  const stage3 = config.stage3 ? require('./plaza-stage3').createStage3({transaction,roomFor,event,revoke,participantResult,storage,uploadPhoto:(...args)=>service.uploadPhoto(...args)}) : null;
  const stage2 = config.stage2 ? require('./plaza-stage2').createStage2({transaction,roomFor,own,event,publicRoom,aiProvider,stage3}) : null;
  async function participantResult(tx, room, grant) {
    const draft = await tx.one('SELECT version, content, saved_at FROM plaza_drafts WHERE participant_id = $1', [grant.participant_id]);
    return { room: publicRoom(room), participant: { seat_order: grant.seat_order, store_public_id: grant.store_public_id }, draft,
      photo_url: grant.current_photo_id ? `/api/plaza/rooms/${room.id}/photos/${grant.current_photo_id}` : null,
      ...(stage2 ? await stage2.extras(tx,room,grant) : {}) };
  }
  const service = {
    stage2, stage3,
    async forDeck(deckId, ctx) {
      return transaction(async tx => {
        if (ctx.user.role === 'student' && ctx.guestSession) {
          const row = await tx.one('SELECT id FROM plaza_rooms WHERE deck_id = $1 AND class_session_id = $2', [deckId, ctx.guestSession.id]);
          if (!row) return null;
          await roomFor(tx, row.id, ctx, false, true);
          return { id: row.id, teacher: false };
        }
        // Staff choose the class explicitly; never guess between two classes using the same deck.
        return null;
      });
    },
    async list(ctx) {
      return transaction(async tx => {
        const rows = await tx.q(`SELECT r.id, r.state, cs.title, cs.code, r.class_session_id FROM plaza_rooms r
          JOIN class_sessions cs ON cs.id = r.class_session_id
          WHERE cs.active AND cs.expires_at > now() ORDER BY r.created_at DESC`);
        const result = [];
        for (const row of rows) {
          const cs = await tx.one('SELECT * FROM class_sessions WHERE id = $1', [row.class_session_id]);
          if (canManageSession(ctx.user, cs)) result.push(row);
        }
        return { rooms: result };
      });
    },
    async entry(id, req, ctx) {
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx);
        return { room: publicRoom(room), can_resume: !!(await grantFor(tx, room, req, ctx, true)) };
      });
    },
    async enter(id, req, ctx, body) {
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx);
        if (!['new','resume'].includes(body?.mode)) fail(400, '새로 입장할지 이어갈지 선택해 주세요.');
        if(stage3&&body.mode==='new'){const retried=await stage3.retryEntry(tx,room,ctx,body);if(retried)return retried;}
        let grant = await grantFor(tx, room, req, ctx, true);
        let grantKey = cookies(req)[cookieName(id)];
        let careerKey;
        if (body.mode === 'resume') {
          if (!grant) fail(409, '이어갈 접속이 없습니다. 강사에게 확인해 주세요.');
          // Only the bearer of the current opaque grant may explicitly rebind after code re-entry.
          if (grant.session_hash !== digest(ctx.token) || grant.login_user_id !== ctx.user.id) {
            await tx.q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [grant.login_user_id, ctx.token]);
            await tx.q('UPDATE plaza_device_grants SET login_user_id = $1, session_hash = $2, version = version + 1 WHERE id = $3', [ctx.user.id, digest(ctx.token), grant.id]);
            await event(tx, room, ctx.user, 'resumed', grant.participant_id);
          }
          careerKey = secret();
          await tx.q('UPDATE career_log.job_identities SET guest_key_hash = $1 WHERE student_id = $2 AND guest_key_hash IS NOT NULL', [digest(careerKey), grant.student_uuid]);
        } else {
          if (room.state !== 'planning') fail(409, '제작 중에는 새 자리를 만들 수 없습니다. 강사에게 확인해 주세요.');
          const seat = body.seat_order;
          if (!Number.isSafeInteger(seat) || seat < 1 || seat > room.seat_count) fail(400, '자리 번호를 확인해 주세요.');
          if (grant && body.replace_current !== true) fail(409, '새 학생 입장은 이전 접속을 끝냅니다. 확인 후 다시 눌러 주세요.', 'replace_required');
          // A response-lost new entry can be recovered with the received HttpOnly grant, never by seat/name.
          if (grant) await revoke(tx, grant, ctx, true);
          const active = await tx.q(`SELECT g.*, p.student_uuid FROM plaza_device_grants g JOIN plaza_participants p ON p.id=g.participant_id
            WHERE g.login_user_id=$1 AND g.revoked_at IS NULL`, [ctx.user.id]);
          for (const old of active) await revoke(tx, old, ctx, true);
          if (await tx.one("SELECT 1 FROM plaza_participants WHERE room_id=$1 AND seat_order=$2 AND status='active'", [id, seat])) fail(409, '이미 사용 중인 자리입니다. 강사에게 확인해 주세요.', 'seat_taken');
          const studentId = crypto.randomUUID(), participantId = crypto.randomUUID(), storeId = crypto.randomUUID();
          careerKey = secret(); grantKey = secret();
          await tx.q('INSERT INTO career_log.students (id) VALUES ($1)', [studentId]);
          await tx.q('INSERT INTO career_log.job_identities (student_id, guest_key_hash) VALUES ($1,$2)', [studentId, digest(careerKey)]);
          await tx.q('INSERT INTO plaza_participants (id,room_id,student_uuid,seat_order,store_public_id) VALUES ($1,$2,$3,$4,$5)', [participantId,id,studentId,seat,storeId]);
          await tx.q('INSERT INTO plaza_drafts (participant_id) VALUES ($1)', [participantId]);
          await tx.q(`INSERT INTO plaza_device_grants (id,room_id,participant_id,login_user_id,secret_hash,session_hash,expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(),id,participantId,ctx.user.id,digest(grantKey),digest(ctx.token),room.cs.expires_at]);
          grant = { participant_id: participantId, seat_order: seat, store_public_id: storeId };
          await event(tx, room, ctx.user, 'entered', participantId);
          if(stage3)await stage3.remember(tx,room,ctx,'entry',body,{participant_id:participantId});
          if (stage2) { await tx.q('UPDATE plaza_rooms SET version=version+1 WHERE id=$1',[id]);room.version++; }
        }
        return { ...(await participantResult(tx, room, grant)), credentials: { grantKey, careerKey, expires: room.cs.expires_at } };
      });
    },
    async mine(id, req, ctx) {
      return transaction(async tx => { const room = await roomFor(tx, id, ctx); return participantResult(tx, room, await own(tx, room, req, ctx)); });
    },
    async save(id, req, ctx, body) {
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx), grant = await own(tx, room, req, ctx);
        if (stage2) return stage2.savePlan(tx,room,grant,ctx,body);
        const input = draftInput(body, room.card);
        const old = await tx.one('SELECT * FROM plaza_drafts WHERE participant_id=$1 FOR UPDATE', [grant.participant_id]);
        if (old.last_attempt_id === input.attempt) {
          if (old.last_digest !== input.digest) fail(409, '같은 저장 번호의 내용이 달라졌습니다.', 'attempt_conflict');
          return { saved: true, duplicate: true, version: old.version, saved_at: old.saved_at };
        }
        if (room.state !== 'planning') fail(409, '제작 중에는 구상을 바꿀 수 없습니다.', 'plaza_paused');
        if (old.version !== input.version) fail(409, '다른 화면에서 구상이 바뀌었습니다. 쓴 글을 확인한 뒤 다시 불러와 주세요.', 'version_conflict');
        const row = await tx.one(`UPDATE plaza_drafts SET version=version+1, content=$1, last_attempt_id=$2, last_digest=$3, saved_at=now()
          WHERE participant_id=$4 RETURNING version, saved_at`, [input.content,input.attempt,input.digest,grant.participant_id]);
        await event(tx, room, ctx.user, 'draft_saved', grant.participant_id, { version: row.version });
        return { saved: true, duplicate: false, ...row };
      });
    },
    async teacher(id, ctx) {
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx, true, true);
        const participants = await tx.q(`SELECT p.id,p.seat_order,p.store_public_id,p.target_version,p.current_photo_id,
          ${stage3?'p.attendance,p.attendance_version,p.connection_version,':''}
          d.saved_at, d.content->>'store_name' AS store_name, d.content->>'artwork_name' AS artwork_name
          FROM plaza_participants p JOIN plaza_drafts d ON d.participant_id=p.id
          WHERE p.room_id=$1 AND p.status <> 'left' ORDER BY p.seat_order`, [id]);
        const photos = await tx.q(`SELECT id,participant_id,status,target_version ${stage3?',invalidated_at':''} FROM plaza_photos WHERE room_id=$1 ORDER BY capture_order`, [id]);
        return { room: publicRoom(room), participants, photos, incomplete: participants.filter(p => !p.saved_at).length,
          ...(stage2 ? await stage2.counts(tx,room) : {}) };
      });
    },
    async state(id, ctx, body) {
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx, true, true);
        if (!(stage2 ? ['planning','paused','returning','exchange','reflection','closed'] : ['planning','paused','closed']).includes(body?.state) || !Number.isSafeInteger(body.version)) fail(400, '수업 단계를 확인해 주세요.');
        if (room.state === body.state) return { room: publicRoom(room), duplicate: true };
        if (room.state === 'closed') fail(409, '종료된 광장은 다시 열 수 없습니다.');
        if (room.version !== body.version) fail(409, '수업 단계가 바뀌었습니다. 새로 확인해 주세요.', 'version_conflict');
        if (stage2) await stage2.transition(tx,room,ctx,body);
        const count = await tx.one(`SELECT count(*)::int AS n FROM plaza_participants p JOIN plaza_drafts d ON d.participant_id=p.id
          WHERE p.room_id=$1 AND p.status='active' AND d.saved_at IS NULL`, [id]);
        await tx.q("UPDATE plaza_rooms SET state=$1,version=version+1,closed_at=CASE WHEN $1='closed' THEN now() ELSE NULL END WHERE id=$2", [body.state,id]);
        if (body.state === 'closed') {
          const grants = await tx.q(`SELECT g.*,p.student_uuid FROM plaza_device_grants g JOIN plaza_participants p ON p.id=g.participant_id
            WHERE g.room_id=$1 AND g.revoked_at IS NULL`, [id]);
          for (const grant of grants) await revoke(tx, grant, ctx);
          if(stage3)await tx.q('UPDATE plaza_reissues SET revoked_at=now() WHERE room_id=$1 AND revoked_at IS NULL',[id]);
          await tx.q("UPDATE plaza_participants SET status='closed' WHERE room_id=$1 AND status='active'", [id]);
        }
        await event(tx, room, ctx.user, 'state_changed', null, { from: room.state, to: body.state, incomplete: count.n });
        return { state: body.state, version: room.version + 1, incomplete: count.n };
      });
    },
    async preparePhoto(id, ctx, body) {
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx, true);
        if (!UUID.test(body?.capture_id || '') || !UUID.test(body.participant_id || '') || !Number.isSafeInteger(body.target_version)) fail(400, '촬영할 가게를 확인해 주세요.');
        const p = await tx.one("SELECT * FROM plaza_participants WHERE id=$1 AND room_id=$2 AND status='active'", [body.participant_id,id]);
        if (!p || p.target_version !== body.target_version) fail(409, '사진을 연결할 가게가 바뀌었습니다.');
        const old = await tx.one('SELECT * FROM plaza_photos WHERE id=$1', [body.capture_id]);
        if (old) {
          if(old.invalidated_at)fail(409,'옮기기 전 촬영입니다. 새 대상을 확인해 주세요.','capture_invalidated');
          if (old.room_id !== id || old.participant_id !== p.id || old.target_version !== body.target_version) fail(409, '촬영 번호의 대상이 다릅니다.', 'capture_conflict');
          return { id: old.id, status: old.status, duplicate: true };
        }
        await tx.q('INSERT INTO plaza_photos (id,room_id,participant_id,target_version,created_by) VALUES ($1,$2,$3,$4,$5)', [body.capture_id,id,p.id,p.target_version,ctx.user.id]);
        const objectId = crypto.randomUUID();
        await tx.q('INSERT INTO plaza_photo_objects (id,photo_id,object_key) VALUES ($1,$2,$3)', [objectId,body.capture_id,`${objectId}.jpg`]);
        await event(tx, room, ctx.user, 'photo_captured', p.id, { capture_id: body.capture_id });
        return { id: body.capture_id, status: 'pending', duplicate: false };
      });
    },
    async uploadPhoto(id, captureId, ctx, body) {
      const image = jpegInput(body?.data_url);
      const reserved = await transaction(async tx => {
        await roomFor(tx, id, ctx, true);
        const p = await tx.one(`SELECT o.*,f.participant_id,f.target_version ${stage3?',f.invalidated_at':''} FROM plaza_photo_objects o JOIN plaza_photos f ON f.id=o.photo_id WHERE f.id=$1 AND f.room_id=$2`, [captureId,id]);
        if (!p) fail(404, '촬영 대상을 먼저 확인해 주세요.');
        if(stage3&&(p.invalidated_at||body.target_version!==p.target_version||!await tx.one("SELECT 1 FROM plaza_participants WHERE id=$1 AND target_version=$2 AND status='active'",[p.participant_id,p.target_version])))fail(409,'사진 대상이 바뀌었습니다. 새 촬영 번호를 확인해 주세요.','capture_invalidated');
        if (p.digest && p.digest !== image.digest) fail(409, '같은 촬영 번호에 다른 사진을 보낼 수 없습니다.', 'capture_conflict');
        await tx.q('UPDATE plaza_photo_objects SET digest=$1,bytes=$2,width=$3,height=$4 WHERE id=$5', [image.digest,image.bytes,image.width,image.height,p.id]);
        return p;
      });
      const key=reserved.object_key;
      try { await storage.put(key, image); }
      catch (error) {
        await transaction(tx => tx.q("UPDATE plaza_photos SET status='failed' WHERE id=$1 AND room_id=$2 AND status <> 'stored'", [captureId,id]));
        throw Object.assign(new Error('사진 저장을 확인하지 못했습니다. 같은 촬영으로 다시 보내 주세요.'), { status: error.status || 503 });
      }
      return transaction(async tx => {
        const room = await roomFor(tx, id, ctx, true);
        const photo = await tx.one('SELECT * FROM plaza_photos WHERE id=$1 AND room_id=$2 FOR UPDATE', [captureId,id]);
        const p = await tx.one("SELECT * FROM plaza_participants WHERE id=$1 AND room_id=$2 AND status='active'", [photo.participant_id,id]);
        if (!p || photo.invalidated_at || p.target_version !== photo.target_version || photo.participant_id!==reserved.participant_id || photo.target_version!==reserved.target_version) fail(409, '사진 대상이 바뀌어 전시하지 않았습니다.','capture_invalidated');
        const readback = await storage.read(key);
        if (digest(readback) !== image.digest) fail(503, '사진 파일 확인이 필요합니다.');
        const duplicate = photo.status === 'stored';
        await tx.q("UPDATE plaza_photo_objects SET status='stored' WHERE photo_id=$1", [captureId]);
        await tx.q("UPDATE plaza_photos SET status='stored',saved_at=COALESCE(saved_at,now()) WHERE id=$1", [captureId]);
        // A slower earlier capture must not replace a newer completed photograph.
        await tx.q(`UPDATE plaza_participants SET current_photo_id=$1 WHERE id=$2 AND (current_photo_id IS NULL OR
          (SELECT capture_order FROM plaza_photos WHERE id=current_photo_id) <= $3)`, [captureId,p.id,photo.capture_order]);
        if (!duplicate) await event(tx, room, ctx.user, 'photo_stored', p.id, { capture_id: captureId });
        if (stage2 && !duplicate) await tx.q('UPDATE plaza_rooms SET version=version+1 WHERE id=$1',[id]);
        return { saved: true, id: captureId, duplicate };
      });
    },
    async photo(id, photoId, req, ctx) {
      return transaction(async tx => {
        const staff = ['instructor','admin','superadmin'].includes(ctx.user.role);
        const room = await roomFor(tx, id, ctx, staff);
        const grant = staff ? null : await own(tx, room, req, ctx);
        const photo = await tx.one(`SELECT f.participant_id,o.object_key FROM plaza_photos f JOIN plaza_photo_objects o ON o.photo_id=f.id
          JOIN plaza_participants p ON p.current_photo_id=f.id AND p.id=f.participant_id
          WHERE f.id=$1 AND f.room_id=$2 AND f.status='stored' AND o.status='stored' AND p.status='active'`, [photoId,id]);
        const exhibited = stage2 && ['exchange','reflection'].includes(room.state) && photo && await tx.one('SELECT 1 FROM plaza_drafts WHERE participant_id=$1 AND saved_at IS NOT NULL',[photo.participant_id]);
        if (!photo || (!staff && photo.participant_id !== grant.participant_id && !exhibited)) fail(404, '사진을 찾을 수 없습니다.');
        return storage.read(photo.object_key);
      });
    },
  };
  return service;
}
module.exports = { createPlaza, cookieName, draftInput };
