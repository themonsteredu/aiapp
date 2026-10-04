'use strict';
const crypto=require('node:crypto');
const {digest}=require('./career-log');
const {fail,attempt}=require('./plaza-program');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTICE='stage4-test-1';
// There is deliberately no production override. These are unresolved stage-0 decisions.
const GATE=Object.freeze({real_collection_allowed:false,status:'synthetic-test-only',
  pending:['학교별 처리 근거·책임 주체·안내 확정','자료별 운영 보관 기간 승인','기존 진로기록 원본의 파기 절차',
    '백업·내보내기 보관과 파기 증빙','실제 기기·운영 저장소 검증','사용자의 운영 배포 승인']});

function createStage4({transaction,roomFor,own,event,revoke,storage}) {
  async function admin(tx,ctx) {
    if(!['admin','superadmin'].includes(ctx.user.role))fail(403,'관리자만 파기를 관리할 수 있습니다.');
    if(!await tx.one('SELECT 1 FROM sessions WHERE token=$1 AND user_id=$2 AND expires_at>now()',[ctx.token,ctx.user.id]))fail(401,'접속이 만료되었습니다.');
  }
  async function maintenanceRoom(tx,id,ctx) {
    await admin(tx,ctx);
    if(!UUID.test(id||''))fail(404,'광장을 찾을 수 없습니다.');
    // Expiry/closed/deck locks cannot make deletion impossible. This path returns no activity text.
    const room=await tx.one('SELECT * FROM plaza_rooms WHERE id=$1 FOR UPDATE',[id]);
    if(!room?.is_test)fail(404,'시험 광장을 찾을 수 없습니다.');
    const cs=await tx.one('SELECT expires_at,title FROM class_sessions WHERE id=$1',[room.class_session_id]);
    return {...room,cs};
  }
  const policy=(tx,id)=>tx.one('SELECT * FROM plaza_retention_policies WHERE room_id=$1',[id]);
  async function notice(tx,id) {const p=await policy(tx,id);return {version:NOTICE,policy:p?{photo_hours:p.photo_hours,activity_hours:p.activity_hours,audit_hours:p.audit_hours,status:p.status}:null,gate:GATE};}
  async function entryChoice(tx,room,body) {
    if(!await policy(tx,room.id))fail(409,'관리자가 시험 보관 기간을 먼저 등록해야 합니다.','retention_required');
    if(!['record','no-record'].includes(body.record_choice)||typeof body.photo_allowed!=='boolean'||body.notice_version!==NOTICE)
      fail(400,'기록과 사진 선택, 시험 안내를 각각 확인해 주세요.','privacy_required');
    return {record_choice:body.record_choice,photo_allowed:body.photo_allowed};
  }
  async function photoAllowed(tx,id,pid) {
    if(await storage.marker('photo-choice',pid))return false;
    return !!(await tx.one('SELECT 1 FROM plaza_participants WHERE id=$1 AND room_id=$2 AND photo_allowed',[pid,id]));
  }
  async function requirePhoto(tx,id,pid) {if(!await photoAllowed(tx,id,pid))fail(409,'이 학생은 사진 없이 참여합니다.','photo_declined');}
  async function privacy(tx,room,grant) {
    const p=await tx.one('SELECT record_choice,photo_allowed,privacy_version,activity_completed_at FROM plaza_participants WHERE id=$1',[grant.participant_id]);
    const latest=await tx.one('SELECT id,status FROM plaza_purge_jobs WHERE participant_id=$1 ORDER BY created_at DESC LIMIT 1',[grant.participant_id]);
    return {...p,photo_allowed:await photoAllowed(tx,room.id,grant.participant_id),photo_purge:latest,notice:await notice(tx,room.id)};
  }
  async function keysFor(tx,id,pid=null) {
    return (await tx.q(`SELECT o.object_key FROM plaza_photo_objects o JOIN plaza_photos f ON f.id=o.photo_id
      WHERE f.room_id=$1 ${pid?'AND f.participant_id=$2':''} ORDER BY o.object_key`,pid?[id,pid]:[id])).map(r=>r.object_key);
  }
  async function jobView(tx,jobId) {
    const j=await tx.one('SELECT id,room_id,scopes,status,created_at,verified_at,whole_system_complete FROM plaza_purge_jobs WHERE id=$1',[jobId]);
    const items=await tx.q('SELECT object_key,status,attempts,failure_code FROM plaza_purge_items WHERE job_id=$1 ORDER BY object_key',[jobId]);
    return {...j,items,remaining_systems:['career_log 원본·연결','기존 게스트 계정·공통 접속 이력','백업·내보내기 복사본','최소 파기 증빙 원장'],gate:GATE};
  }
  async function createJob(tx,{roomId=null,pid=null,scopes,keys,ctx,body,hash}) {
    const id=crypto.randomUUID();
    const manifest=digest(JSON.stringify({roomId,pid,scopes,keys}));
    await tx.q(`INSERT INTO plaza_purge_jobs(id,room_id,participant_id,scopes,attempt_id,actor_user_id,request_digest,manifest_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,roomId,pid,JSON.stringify(scopes),attempt(body),ctx.user.id,hash,manifest]);
    for(const key of keys)await tx.q('INSERT INTO plaza_purge_items(job_id,object_key) VALUES($1,$2)',[id,key]);
    return id;
  }
  async function previous(tx,ctx,body,roomId,pid=null) {
    const j=await tx.one('SELECT * FROM plaza_purge_jobs WHERE attempt_id=$1',[attempt(body)]);
    if(j&&(j.actor_user_id!==ctx.user.id||j.room_id!==roomId||j.participant_id!==pid||j.request_digest!==digest(JSON.stringify(body))))
      fail(409,'같은 처리 번호의 대상 또는 내용이 다릅니다.','attempt_conflict');
    return j;
  }
  async function hidePhotos(tx,id,pid=null) {
    await tx.q(`UPDATE plaza_participants SET current_photo_id=NULL,target_version=target_version+1 WHERE room_id=$1 ${pid?'AND id=$2':''}`,pid?[id,pid]:[id]);
    await tx.q(`UPDATE plaza_photos SET invalidated_at=COALESCE(invalidated_at,now()) WHERE room_id=$1 ${pid?'AND participant_id=$2':''}`,pid?[id,pid]:[id]);
  }
  async function runJob(tx,jobId) {
    const j=await tx.one('SELECT * FROM plaza_purge_jobs WHERE id=$1 FOR UPDATE',[jobId]);
    const items=await tx.q('SELECT * FROM plaza_purge_items WHERE job_id=$1 ORDER BY object_key',[jobId]);
    if(j.room_id&&j.scopes.includes('photos')) {
      const reviewed=new Set(items.map(i=>i.object_key));
      if((await keysFor(tx,j.room_id,j.participant_id)).some(k=>!reviewed.has(k)))
        fail(409,'복원 또는 새 파일로 파기 범위가 달라졌습니다. 새 목록을 확인해 주세요.','purge_preview_changed');
    }
    let all=true;
    for(const item of items) {
      try {
        await storage.mark('object',item.object_key);
        const result=await storage.removeVerified(item.object_key);
        if(!result?.verified||!await storage.absent(item.object_key))throw new Error('absence_not_verified');
        await tx.q("UPDATE plaza_purge_items SET status='verified',attempts=attempts+1,failure_code=NULL,verified_at=now() WHERE job_id=$1 AND object_key=$2",[jobId,item.object_key]);
      }catch {
        all=false;
        await tx.q("UPDATE plaza_purge_items SET status='retry',attempts=attempts+1,failure_code='delete_or_verify_failed',verified_at=NULL WHERE job_id=$1 AND object_key=$2",[jobId,item.object_key]);
      }
    }
    if(j.room_id&&j.scopes.includes('photos')&&all) {
      await hidePhotos(tx,j.room_id,j.participant_id);
      // Only files included in this manifest may lose their database rows.
      await tx.q('DELETE FROM plaza_photo_objects WHERE object_key IN (SELECT object_key FROM plaza_purge_items WHERE job_id=$1)',[jobId]);
      await tx.q(`DELETE FROM plaza_photos f WHERE room_id=$1 ${j.participant_id?'AND participant_id=$2':''}
        AND NOT EXISTS(SELECT 1 FROM plaza_photo_objects o WHERE o.photo_id=f.id)`,j.participant_id?[j.room_id,j.participant_id]:[j.room_id]);
      if(!j.participant_id)await tx.q('UPDATE plaza_rooms SET photos_purged_at=now() WHERE id=$1',[j.room_id]);
    }
    if(j.scopes.includes('activities')) {
      for(const table of ['plaza_record_receipts','plaza_write_receipts','plaza_ai_runs','plaza_activities','plaza_drafts'])
        await tx.q(`DELETE FROM ${table} WHERE participant_id IN (SELECT id FROM plaza_participants WHERE room_id=$1)`,[j.room_id]);
      await tx.q('DELETE FROM plaza_visits WHERE room_id=$1',[j.room_id]);
      await tx.q('UPDATE plaza_participants SET activity_completed_at=NULL WHERE room_id=$1',[j.room_id]);
      await tx.q('UPDATE plaza_rooms SET activities_purged_at=now() WHERE id=$1',[j.room_id]);
      await tx.q('UPDATE plaza_purge_jobs SET activities_done_at=now() WHERE id=$1',[jobId]);
    }
    if(j.scopes.includes('audit')&&all) {
      const r=await tx.one('SELECT photos_purged_at,activities_purged_at FROM plaza_rooms WHERE id=$1',[j.room_id]);
      if(!r.photos_purged_at||!r.activities_purged_at)all=false;
      else {
        for(const table of ['plaza_operations','plaza_reissues','plaza_device_grants','plaza_claim_limits','plaza_events'])await tx.q(`DELETE FROM ${table} WHERE room_id=$1`,[j.room_id]);
        await tx.q('DELETE FROM plaza_participants WHERE room_id=$1',[j.room_id]);
        await tx.q('UPDATE plaza_purge_jobs SET participant_id=NULL WHERE room_id=$1',[j.room_id]);
        await tx.q('UPDATE plaza_rooms SET audit_purged_at=now() WHERE id=$1',[j.room_id]);
        await tx.q('UPDATE plaza_purge_jobs SET audit_done_at=now() WHERE id=$1',[jobId]);
      }
    }
    await tx.q('UPDATE plaza_purge_jobs SET status=$1,verified_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$3',[all?'verified':'retry',all,jobId]);
    return jobView(tx,jobId);
  }
  async function stopRoom(tx,room,ctx) {
    const grants=await tx.q('SELECT g.*,p.student_uuid FROM plaza_device_grants g JOIN plaza_participants p ON p.id=g.participant_id WHERE g.room_id=$1 AND g.revoked_at IS NULL',[room.id]);
    for(const g of grants)await revoke(tx,g,ctx);
    await tx.q("UPDATE plaza_rooms SET state='closed',closed_at=COALESCE(closed_at,now()),version=version+1 WHERE id=$1",[room.id]);
    await tx.q("UPDATE plaza_participants SET status='closed' WHERE room_id=$1 AND status='active'",[room.id]);
    await tx.q('UPDATE plaza_reissues SET revoked_at=COALESCE(revoked_at,now()) WHERE room_id=$1',[room.id]);
  }
  async function preview(tx,room,restore=false) {
    const p=await policy(tx,room.id),ledger=await storage.marker('room',room.id);
    const ended=[room.closed_at,room.cs.expires_at].filter(Boolean).map(d=>new Date(d).getTime()).filter(t=>t<=Date.now());
    const end=ended.length?Math.min(...ended):null;
    const scopes=[],due_at={};
    for(const [s,column,done] of [['photos','photo_hours','photos_purged_at'],['activities','activity_hours','activities_purged_at'],['audit','audit_hours','audit_purged_at']]) {
      due_at[s]=p&&end!==null?new Date(end+p[column]*3600000).toISOString():null;
      if((restore&&ledger?.scopes.includes(s))||(due_at[s]&&new Date(due_at[s])<=new Date()&&!room[done]))scopes.push(s);
    }
    const keys=scopes.includes('photos')?[...new Set([...(await keysFor(tx,room.id)),...(ledger?.keys||[])])].sort():[];
    const counts=await tx.one(`SELECT count(*)::int AS participants FROM plaza_participants WHERE room_id=$1`,[room.id]);
    const details={room_id:room.id,room_version:room.version,policy_version:p?.version||null,scopes,keys,counts,restore};
    return {...details,digest:digest(JSON.stringify(details)),due_at,gate:GATE,whole_system_complete:false};
  }
  return {
    notice,entryChoice,privacy,photoAllowed,requirePhoto,
    async roomBlocked(id){return !!await storage.marker('room',id);},
    async identityBlocked(ctx) {
      if(ctx.user.role!=='student'||!ctx.user.guest_session_id)return false;
      return transaction(async tx=>!!await tx.one(`SELECT 1 FROM plaza_rooms r WHERE r.class_session_id=$1 AND NOT EXISTS (
        SELECT 1 FROM plaza_device_grants g JOIN plaza_participants p ON p.id=g.participant_id
        WHERE g.login_user_id=$2 AND g.room_id=r.id AND g.revoked_at IS NULL AND g.expires_at>now() AND p.record_choice='record')`,[ctx.user.guest_session_id,ctx.user.id]));
    },
    async withdrawPhoto(id,req,ctx,body) {
      return transaction(async tx=>{
        const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id;
        const old=await previous(tx,ctx,body,id,pid);if(old)return {photo_allowed:false,purge:await runJob(tx,old.id)};
        if(body.photo_allowed!==false||body.version!==g.privacy_version)fail(409,'현재 사진 선택을 다시 확인해 주세요.');
        const keys=[...new Set([...(await keysFor(tx,id,pid)),...((await storage.marker('photo-choice',pid))?.keys||[])])].sort();
        await storage.mark('photo-choice',pid,{room_id:id,keys});
        // Durable refusal precedes the SQL update and physical deletion.
        await hidePhotos(tx,id,pid);
        await tx.q('UPDATE plaza_participants SET photo_allowed=false,privacy_version=privacy_version+1 WHERE id=$1',[pid]);
        await tx.q('UPDATE plaza_rooms SET version=version+1 WHERE id=$1',[id]);
        await event(tx,room,ctx.user,'photo_withdrawn',pid);
        const jobId=await createJob(tx,{roomId:id,pid,scopes:['photos'],keys,ctx,body,hash:digest(JSON.stringify(body))});
        return {photo_allowed:false,purge:await runJob(tx,jobId)};
      });
    },
    async list(ctx){return transaction(async tx=>{await admin(tx,ctx);return {gate:GATE,rooms:await tx.q(`SELECT r.id,r.state,cs.title FROM plaza_rooms r JOIN class_sessions cs ON cs.id=r.class_session_id ORDER BY r.created_at DESC`)};});},
    async status(id,ctx){return transaction(async tx=>{const room=await maintenanceRoom(tx,id,ctx);return {policy:await policy(tx,id),preview:await preview(tx,room),gate:GATE,
      restore_blocked:!!await storage.marker('room',id),jobs:await tx.q('SELECT id,status,scopes,created_at,whole_system_complete FROM plaza_purge_jobs WHERE room_id=$1 ORDER BY created_at DESC',[id])};});},
    async setPolicy(id,ctx,body) {
      return transaction(async tx=>{
        const room=await maintenanceRoom(tx,id,ctx);
        for(const key of ['photo_hours','activity_hours','audit_hours'])if(!Number.isSafeInteger(body?.[key])||body[key]<0||body[key]>87600)fail(400,'시험 보관 시간을 0~87600시간으로 입력해 주세요.');
        if(body.audit_hours<Math.max(body.photo_hours,body.activity_hours)||body.confirm_test_only!==true)fail(400,'운영 이력은 사진·활동 파기 이후까지 보관하고 시험임을 확인해 주세요.');
        const old=await policy(tx,id);
        if(old) {
          if(['photo_hours','activity_hours','audit_hours'].some(k=>old[k]!==body[k]))fail(409,'확정한 시험 정책은 바꾸지 않습니다.');
          return {policy:old,duplicate:true,gate:GATE};
        }
        if(room.state!=='planning'||await tx.one('SELECT 1 FROM plaza_participants WHERE room_id=$1',[id]))fail(409,'참여자 입장 전에 정책을 등록해야 합니다.');
        await tx.q('INSERT INTO plaza_retention_policies(room_id,photo_hours,activity_hours,audit_hours,created_by) VALUES($1,$2,$3,$4,$5)',[id,body.photo_hours,body.activity_hours,body.audit_hours,ctx.user.id]);
        return {policy:await policy(tx,id),gate:GATE};
      });
    },
    async preview(id,ctx,restore=false){return transaction(async tx=>preview(tx,await maintenanceRoom(tx,id,ctx),restore));},
    async purge(id,ctx,body) {
      return transaction(async tx=>{
        const room=await maintenanceRoom(tx,id,ctx),old=await previous(tx,ctx,body,id);
        if(old)return runJob(tx,old.id);
        const plan=await preview(tx,room,body.restore===true);
        if(body.confirm!==true||body.digest!==plan.digest||!plan.scopes.length)fail(409,'현재 파기 목록과 기한을 다시 확인해 주세요.','purge_preview_changed');
        await storage.mark('room',id,{scopes:plan.scopes,keys:plan.keys});
        await stopRoom(tx,room,ctx);
        if(plan.scopes.includes('photos'))await hidePhotos(tx,id);
        const jobId=await createJob(tx,{roomId:id,scopes:plan.scopes,keys:plan.keys,ctx,body,hash:digest(JSON.stringify(body))});
        return runJob(tx,jobId);
      });
    },
    async retry(id,jobId,ctx) {
      return transaction(async tx=>{
        await maintenanceRoom(tx,id,ctx);
        const j=await tx.one('SELECT * FROM plaza_purge_jobs WHERE id=$1 AND room_id=$2',[jobId,id]);
        if(!j)fail(404,'파기 작업을 찾을 수 없습니다.');
        return runJob(tx,j.id);
      });
    },
    async orphans(ctx,body) {
      return transaction(async tx=>{
        await admin(tx,ctx);
        // Reservations and uploads lock rooms too. Prevent a reservation from racing inventory.
        await tx.q('SELECT id FROM plaza_rooms ORDER BY id FOR UPDATE');
        const inventory=await storage.inventory();
        const registered=new Set((await tx.q('SELECT object_key FROM plaza_photo_objects')).map(r=>r.object_key));
        const keys=inventory.keys.filter(k=>!registered.has(k));
        const hash=digest(JSON.stringify(keys));
        if(!body)return {keys,digest:hash,unrecognized_count:inventory.unrecognized_count,gate:GATE};
        const old=await previous(tx,ctx,body,null);if(old)return runJob(tx,old.id);
        if(body.confirm!==true||hash!==body.digest||!keys.length)fail(409,'고아 파일 목록을 다시 확인해 주세요.');
        const id=await createJob(tx,{scopes:['orphans'],keys,ctx,body,hash:digest(JSON.stringify(body))});
        return runJob(tx,id);
      });
    },
  };
}
module.exports={createStage4,GATE,NOTICE};
