'use strict';
const crypto=require('node:crypto');
const {digest}=require('./career-log');
const {UUID,fail,text,attempt,cycle,studentCard}=require('./plaza-program');
const secret=()=>crypto.randomBytes(32).toString('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const hash=value=>digest(JSON.stringify(canonical(value)));

function createStage3({transaction,roomFor,event,revoke,participantResult,storage,uploadPhoto}) {
  const touch=async(tx,room,ctx,kind,pid,details={})=>{
    await tx.q('UPDATE plaza_rooms SET version=version+1 WHERE id=$1',[room.id]);room.version++;
    await event(tx,room,ctx.user,kind,pid,details);
  };
  async function operation(tx,room,ctx,kind,body) {
    attempt(body);
    const old=await tx.one('SELECT * FROM plaza_operations WHERE room_id=$1 AND attempt_id=$2',[room.id,body.attempt_id]);
    if(old&&(old.actor_user_id!==ctx.user.id||old.kind!==kind||old.digest!==hash(body)))fail(409,'같은 요청 번호의 내용이 다릅니다.','attempt_conflict');
    return old?.result;
  }
  const remember=(tx,room,ctx,kind,body,result)=>tx.q('INSERT INTO plaza_operations(room_id,attempt_id,actor_user_id,kind,digest,result) VALUES($1,$2,$3,$4,$5,$6)',[room.id,body.attempt_id,ctx.user.id,kind,hash(body),result]);
  async function replayWrite(tx,pid,kind,body) {
    attempt(body);const old=await tx.one('SELECT * FROM plaza_write_receipts WHERE participant_id=$1 AND attempt_id=$2',[pid,body.attempt_id]);
    if(old&&(old.kind!==kind||old.digest!==hash(body)))fail(409,'같은 저장 번호의 내용이 다릅니다.','attempt_conflict');
    return old?{...old.result,duplicate:true}:null;
  }
  const rememberWrite=(tx,pid,kind,body,result)=>tx.q('INSERT INTO plaza_write_receipts(participant_id,attempt_id,kind,digest,result) VALUES($1,$2,$3,$4,$5)',[pid,body.attempt_id,kind,hash(body),result]);
  async function participant(tx,room,id) {
    if(!UUID.test(id||''))fail(400,'참여자를 확인해 주세요.');
    const p=await tx.one("SELECT * FROM plaza_participants WHERE room_id=$1 AND id=$2 AND status='active'",[room.id,id]);
    if(!p)fail(404,'현재 수업의 참여자를 찾지 못했습니다.');return p;
  }
  async function revokeParticipant(tx,room,ctx,p) {
    const grants=await tx.q('SELECT * FROM plaza_device_grants WHERE participant_id=$1 AND revoked_at IS NULL',[p.id]);
    for(const g of grants)await revoke(tx,{...g,student_uuid:p.student_uuid},ctx);
    await tx.q('UPDATE plaza_reissues SET revoked_at=now() WHERE participant_id=$1 AND revoked_at IS NULL',[p.id]);
  }
  async function credentials(tx,room,ctx,p,grantId) {
    const grantKey=secret(),careerKey=secret();
    await tx.q(`UPDATE plaza_device_grants SET secret_hash=$1,session_hash=$2,login_user_id=$3,version=version+1 WHERE id=$4`,[digest(grantKey),digest(ctx.token),ctx.user.id,grantId]);
    await tx.q('UPDATE career_log.job_identities SET guest_key_hash=$1 WHERE student_id=$2 AND guest_key_hash IS NOT NULL',[digest(careerKey),p.student_uuid]);
    return {...await participantResult(tx,room,{...p,participant_id:p.id}),credentials:{grantKey,careerKey,expires:room.cs.expires_at}};
  }
  async function retryEntry(tx,room,ctx,body) {
    const old=await operation(tx,room,ctx,'entry',body);if(!old)return null;
    const p=await participant(tx,room,old.participant_id);
    const g=await tx.one('SELECT id FROM plaza_device_grants WHERE participant_id=$1 AND login_user_id=$2 AND session_hash=$3 AND revoked_at IS NULL AND expires_at>now()',[p.id,ctx.user.id,digest(ctx.token)]);
    if(!g||p.attendance!=='present')fail(409,'현재 접속은 강사에게 다시 확인해 주세요.');
    return {...await credentials(tx,room,ctx,p,g.id),duplicate:true};
  }
  async function reissue(id,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx,true),old=await operation(tx,room,ctx,'reissue',body);
      if(old)return {...old,duplicate:true,code:null};
      const p=await participant(tx,room,body.participant_id);
      if(body.confirm!==true||p.attendance!=='present'||body.connection_version!==p.connection_version)fail(409,'출석과 현재 접속을 확인한 뒤 재발급해 주세요.','version_conflict');
      await revokeParticipant(tx,room,ctx,p);
      const code=crypto.randomBytes(12).toString('hex').toUpperCase(),rid=crypto.randomUUID();
      const row=await tx.one("INSERT INTO plaza_reissues(id,room_id,participant_id,code_hash,expires_at) VALUES($1,$2,$3,$4,LEAST(now()+interval '5 minutes',$5::timestamptz)) RETURNING expires_at",[rid,id,p.id,digest(code),room.cs.expires_at]);
      await tx.q('UPDATE plaza_participants SET connection_version=connection_version+1 WHERE id=$1',[p.id]);
      const result={issued:true,expires_at:row.expires_at,connection_version:p.connection_version+1};
      await remember(tx,room,ctx,'reissue',body,result);await touch(tx,room,ctx,'device_reissued',p.id,{reissue_id:rid});
      return {...result,code:code.match(/.{6}/g).join('-')};
    });
  }
  async function claim(id,req,ctx,body) {
    const result=await transaction(async tx=>{
      const room=await roomFor(tx,id,ctx);attempt(body);
      const subjects=[{key:`user:${ctx.user.id}`,max:5},{key:'room',max:50}];
      for(const s of subjects){
        await tx.q("INSERT INTO plaza_claim_limits(room_id,subject) VALUES($1,$2) ON CONFLICT(room_id,subject) DO UPDATE SET failures=CASE WHEN plaza_claim_limits.window_start<now()-interval '5 minutes' THEN 0 ELSE plaza_claim_limits.failures END,window_start=CASE WHEN plaza_claim_limits.window_start<now()-interval '5 minutes' THEN now() ELSE plaza_claim_limits.window_start END",[id,s.key]);
        const limit=await tx.one('SELECT failures FROM plaza_claim_limits WHERE room_id=$1 AND subject=$2',[id,s.key]);
        if(limit.failures>=s.max)return {error:true,status:429,message:'연결값 확인을 잠시 멈췄습니다. 5분 뒤 강사와 함께 다시 확인해 주세요.'};
      }
      const code=typeof body.code==='string'?body.code.replaceAll('-','').replaceAll(' ','').toUpperCase():'';
      const re=await tx.one('SELECT * FROM plaza_reissues WHERE room_id=$1 AND code_hash=$2 AND revoked_at IS NULL AND expires_at>now()',[id,digest(code)]);
      const retry=re?.claimed_at&&re.claimed_user_id===ctx.user.id&&re.claim_session_hash===digest(ctx.token)&&re.claim_attempt_id===body.attempt_id;
      if(!/^[0-9A-F]{24}$/.test(code)||!re||(re.claimed_at&&!retry)){
        for(const s of subjects)await tx.q('UPDATE plaza_claim_limits SET failures=failures+1 WHERE room_id=$1 AND subject=$2',[id,s.key]);
        await event(tx,room,ctx.user,'device_claim_rejected');
        return {error:true,status:400,message:'연결값을 확인하지 못했습니다. 강사에게 다시 확인해 주세요.'};
      }
      const p=await participant(tx,room,re.participant_id);
      if(p.attendance!=='present')fail(409,'강사에게 출석을 확인해 주세요.');
      const other=await tx.one('SELECT 1 FROM plaza_device_grants WHERE login_user_id=$1 AND revoked_at IS NULL AND participant_id<>$2',[ctx.user.id,p.id]);
      if(other)fail(409,'이미 다른 참여자로 접속한 화면입니다. 수업 코드로 새로 접속해 주세요.');
      let grantId=re.grant_id;
      if(retry){
        if(!await tx.one('SELECT 1 FROM plaza_device_grants WHERE id=$1 AND login_user_id=$2 AND session_hash=$3 AND revoked_at IS NULL AND expires_at>now()',[grantId,ctx.user.id,digest(ctx.token)]))fail(409,'이 연결은 더 이상 사용할 수 없습니다.');
      }else{
        grantId=crypto.randomUUID();
        await tx.q('INSERT INTO plaza_device_grants(id,room_id,participant_id,login_user_id,secret_hash,session_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[grantId,id,p.id,ctx.user.id,digest(secret()),digest(ctx.token),room.cs.expires_at]);
        await tx.q('UPDATE plaza_reissues SET claimed_at=now(),claimed_user_id=$1,claim_attempt_id=$2,claim_session_hash=$3,grant_id=$4 WHERE id=$5',[ctx.user.id,body.attempt_id,digest(ctx.token),grantId,re.id]);
        await touch(tx,room,ctx,'device_claimed',p.id,{reissue_id:re.id});
      }
      return {...await credentials(tx,room,ctx,p,grantId),duplicate:!!retry};
    });
    if(result.error)fail(result.status,result.message,'claim_rejected');return result;
  }
  async function exchanges(tx,room,pid) {
    const rows=await tx.q(`SELECT v.*,h.store_public_id AS host_store,s.store_public_id AS visitor_store FROM plaza_visits v
      LEFT JOIN plaza_participants h ON h.id=v.host_id LEFT JOIN plaza_participants s ON s.id=v.visitor_id
      WHERE v.room_id=$1 AND v.retired_at IS NULL AND (v.visitor_id=$2 OR v.host_id=$2)`,[room.id,pid]);
    const out=rows.find(v=>v.visitor_id===pid),inc=rows.find(v=>v.host_id===pid);
    const view=(v,incoming)=>v?{id:v.id,store_public_id:incoming?v.visitor_store:v.host_store,substitute:v.substitute||!!v.fallback_reply,reason:v.reason||v.fallback_reply?.reason||null,
      request:v.request,reply:incoming?v.reply:v.fallback_reply||v.reply,reaction:v.reaction}:null;
    return {outgoing:view(out,false),incoming:view(inc,true)};
  }
  async function addVisit(tx,room,visitor,host,reason) {
    const substitute=!visitor||!host;
    await tx.q(`INSERT INTO plaza_visits(id,room_id,visitor_id,host_id,substitute,reason,request) VALUES($1,$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),room.id,visitor,host,substitute,reason,
      !visitor?{request_id:room.card.requests[0].id,source:'example',reason}:null]);
  }
  async function fillVisits(tx,room,reason) {
    const present=await tx.q("SELECT id FROM plaza_participants WHERE room_id=$1 AND status='active' AND attendance='present' ORDER BY seat_order",[room.id]);
    const visits=await tx.q('SELECT visitor_id,host_id FROM plaza_visits WHERE room_id=$1 AND retired_at IS NULL',[room.id]);
    const visitors=present.map(p=>p.id).filter(id=>!visits.some(v=>v.visitor_id===id)),hosts=present.map(p=>p.id).filter(id=>!visits.some(v=>v.host_id===id));
    // Match only empty slots. Augmenting paths avoid needless example substitutions in odd groups.
    const matched=new Map();
    function match(visitor,seen){for(const host of hosts){if(host===visitor||seen.has(host))continue;seen.add(host);if(!matched.has(host)||match(matched.get(host),seen)){matched.set(host,visitor);return true;}}return false;}
    for(const visitor of visitors)match(visitor,new Set());
    for(const [host,visitor] of matched)await addVisit(tx,room,visitor,host,reason);
    for(const visitor of visitors.filter(v=>![...matched.values()].includes(v)))await addVisit(tx,room,visitor,null,reason);
    for(const host of hosts.filter(h=>!matched.has(h)))await addVisit(tx,room,null,host,reason);
  }
  async function openVisits(tx,room,ids) {
    if(ids.length===1){await addVisit(tx,room,ids[0],null,'1인 참여');await addVisit(tx,room,null,ids[0],'1인 참여');return;}
    for(const v of cycle(ids))await addVisit(tx,room,v.visitor_id,v.host_id,null);
  }
  async function attendance(id,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx,true),old=await operation(tx,room,ctx,'attendance',body);if(old)return {...old,duplicate:true};
      const p=await participant(tx,room,body.participant_id),reason=text(body.reason,160);
      if(!['present','absent'].includes(body.attendance)||body.version!==p.attendance_version)fail(409,'현재 출석 상태를 다시 확인해 주세요.','version_conflict');
      if(p.attendance===body.attendance)fail(409,'이미 같은 출석 상태입니다.');
      await tx.q('UPDATE plaza_participants SET attendance=$1,attendance_version=attendance_version+1 WHERE id=$2',[body.attendance,p.id]);
      if(body.attendance==='absent')await revokeParticipant(tx,room,ctx,p);
      const retired=[];
      // Staff's free-text reason stays in the private audit. Peers only receive a generic cause.
      const exchangeReason=body.attendance==='absent'?'결석·중도 이탈로 교류 조정':'늦은 복귀로 교류 조정';
      if(['exchange','reflection'].includes(room.state)){
        if(body.attendance==='absent'){
          const empty=await tx.q(`SELECT v.id FROM plaza_visits v WHERE room_id=$1 AND retired_at IS NULL AND (visitor_id=$2 OR host_id=$2)
            AND request IS NULL AND reply IS NULL AND reaction IS NULL AND fallback_reply IS NULL
            AND NOT EXISTS(SELECT 1 FROM plaza_record_receipts r WHERE r.participant_id IN (v.visitor_id,v.host_id))
            AND NOT EXISTS(SELECT 1 FROM plaza_ai_runs a WHERE a.participant_id=v.host_id AND a.kind='reply')`,[id,p.id]);
          for(const v of empty){await tx.q('UPDATE plaza_visits SET retired_at=now() WHERE id=$1',[v.id]);retired.push(v.id);}
          await tx.q(`UPDATE plaza_visits SET fallback_reply=$1 WHERE room_id=$2 AND host_id=$3 AND retired_at IS NULL AND request IS NOT NULL AND reply IS NULL AND fallback_reply IS NULL`,[{text:room.card.reply_options[0].text,source:'example',reason:exchangeReason},id,p.id]);
        }
        await fillVisits(tx,room,exchangeReason);
      }
      const result={saved:true,attendance:body.attendance,version:p.attendance_version+1,retired_count:retired.length};
      await remember(tx,room,ctx,'attendance',body,result);await touch(tx,room,ctx,'attendance_changed',p.id,{from:p.attendance,to:body.attendance,reason,retired_visit_ids:retired});
      return result;
    });
  }
  async function movePhoto(id,ctx,body) {
    const reserved=await transaction(async tx=>{
      const room=await roomFor(tx,id,ctx,true),old=await operation(tx,room,ctx,'photo_move',body);if(old)return old;
      if(body.confirm!==true||!UUID.test(body.capture_id||''))fail(400,'옮길 사진과 두 가게를 확인해 주세요.');
      const f=await tx.one('SELECT f.*,o.object_key FROM plaza_photos f JOIN plaza_photo_objects o ON o.photo_id=f.id WHERE f.id=$1 AND f.room_id=$2',[body.capture_id,id]);
      if(!f||f.invalidated_at)fail(409,'현재 사진을 다시 확인해 주세요.');
      const source=await participant(tx,room,f.participant_id),target=await participant(tx,room,body.participant_id);
      if(source.id===target.id||source.target_version!==body.source_version||target.target_version!==body.target_version||(f.status!=='stored'&&f.target_version!==source.target_version)||(f.status==='stored'&&source.current_photo_id!==f.id))fail(409,'사진 대상이 바뀌었습니다. 두 가게를 다시 확인해 주세요.','version_conflict');
      // Commit hiding + both target-version fences before any file transfer.
      await tx.q('UPDATE plaza_participants SET target_version=target_version+1,current_photo_id=CASE WHEN id=$1 THEN NULL ELSE current_photo_id END WHERE id IN ($1,$2)',[source.id,target.id]);
      await tx.q('UPDATE plaza_photos SET invalidated_at=now() WHERE room_id=$1 AND participant_id IN ($2,$3) AND (status<>\'stored\' OR id=$4) AND invalidated_at IS NULL',[id,source.id,target.id,f.id]);
      const captureId=crypto.randomUUID(),objectId=crypto.randomUUID();
      await tx.q('INSERT INTO plaza_photos(id,room_id,participant_id,target_version,created_by) VALUES($1,$2,$3,$4,$5)',[captureId,id,target.id,target.target_version+1,ctx.user.id]);
      await tx.q('INSERT INTO plaza_photo_objects(id,photo_id,object_key) VALUES($1,$2,$3)',[objectId,captureId,`${objectId}.jpg`]);
      const result={id:captureId,participant_id:target.id,target_version:target.target_version+1,needs_upload:f.status!=='stored',source_key:f.object_key,saved:false};
      await remember(tx,room,ctx,'photo_move',body,result);await touch(tx,room,ctx,'photo_move_reserved',target.id,{from_participant_id:source.id,from_capture_id:f.id,capture_id:captureId});
      return result;
    });
    if(!reserved.needs_upload&&!reserved.saved){
      const bytes=await storage.read(reserved.source_key);
      await uploadPhoto(id,reserved.id,ctx,{data_url:`data:image/jpeg;base64,${bytes.toString('base64')}`,target_version:reserved.target_version});
      await transaction(async tx=>{const room=await roomFor(tx,id,ctx,true);await tx.q('UPDATE plaza_operations SET result=$1 WHERE room_id=$2 AND attempt_id=$3',[{...reserved,saved:true},id,body.attempt_id]);await event(tx,room,ctx.user,'photo_move_stored',reserved.participant_id,{capture_id:reserved.id});});
      reserved.saved=true;
    }
    if(reserved.needs_upload){
      const stored=await transaction(async tx=>{await roomFor(tx,id,ctx,true);return tx.one("SELECT 1 FROM plaza_photos WHERE id=$1 AND room_id=$2 AND status='stored' AND invalidated_at IS NULL",[reserved.id,id]);});
      if(stored){reserved.saved=true;reserved.needs_upload=false;}
    }
    const {source_key,...result}=reserved;return result;
  }
  async function paper(id,ctx){return transaction(async tx=>({card:studentCard((await roomFor(tx,id,ctx,true)).card)}));}
  return {operation,remember,retryEntry,replayWrite,rememberWrite,reissue,claim,exchanges,openVisits,attendance,movePhoto,paper};
}
module.exports={createStage3};
