'use strict';
const crypto = require('node:crypto');
const {digest,submission,insertCareerRecord} = require('./career-log');
const {fail,text,pick,attempt,QUESTIONS,studentCard,aiInput,validatedOutput,exampleOutput,cycle,slidesInput} = require('./plaza-program');
const {activitySource,sourceInput,requireSource,sourceRecord} = require('./plaza-activity-source');

function createStage2({transaction,roomFor,own,event,publicRoom,aiProvider,stage3,stage4}) {
  const touch = async (tx,room,ctx,kind,pid=null,details={}) => {
    await tx.q('UPDATE plaza_rooms SET version=version+1 WHERE id=$1',[room.id]);
    await event(tx,room,ctx.user,kind,pid,details);
  };
  async function activity(tx,pid) {
    await tx.q('INSERT INTO plaza_activities(participant_id) VALUES($1) ON CONFLICT DO NOTHING',[pid]);
    return tx.one('SELECT * FROM plaza_activities WHERE participant_id=$1',[pid]);
  }
  const phase = (room,allowed) => { if (!allowed.includes(room.state)) fail(409,'선생님이 수업 단계를 열면 이어서 해 주세요.','phase_conflict'); };
  async function editable(tx,pid) {
    if(stage4&&await tx.one('SELECT 1 FROM plaza_participants WHERE id=$1 AND activity_completed_at IS NOT NULL',[pid]))fail(409,'완료한 활동입니다.','activity_frozen');
    if (await tx.one('SELECT 1 FROM plaza_record_receipts WHERE participant_id=$1',[pid])) fail(409,'확인한 최종 기록은 고정되었습니다. 저장 상태를 확인해 주세요.','record_frozen');
  }
  const runView = r => r ? {kind:r.kind,status:r.status,source:r.source,call_attempted:r.call_attempted,failure_code:r.failure_code,output:r.output,selection:r.input ? {customer_id:r.input.customer.id,material_ids:r.input.materials.map(m=>m.id)} : undefined} : null;
  async function exchanges(tx,room,pid) {
    if(stage3)return stage3.exchanges(tx,room,pid);
    const rows = await tx.q(`SELECT v.*, p.store_public_id,p2.store_public_id AS visitor_store_id FROM plaza_visits v
      LEFT JOIN plaza_participants p ON p.id=v.host_id LEFT JOIN plaza_participants p2 ON p2.id=v.visitor_id
      WHERE v.room_id=$1 AND (v.visitor_id=$2 OR v.host_id=$2)`,[room.id,pid]);
    const outgoing=rows.find(v=>v.visitor_id===pid),incoming=rows.find(v=>v.host_id===pid);
    const view=v=>v ? {id:v.id,store_public_id:v.host_id===pid?v.visitor_store_id:v.store_public_id,substitute:v.substitute,request:v.request,reply:v.reply,reaction:v.reaction} : null;
    // A one-person lesson has a separate, explicitly example-authored incoming request.
    return {outgoing:outgoing?.substitute?{...view(outgoing),reply:outgoing.request?{text:room.card.reply_options[0].text,source:'example'}:null}:view(outgoing),incoming:incoming?view(incoming):outgoing?.substitute?{...view(outgoing),request:{request_id:room.card.requests[0].id,source:'example'},reply:outgoing.reply,reaction:outgoing.reply?{reaction_id:'understood',source:'example'}:null}:null};
  }
  async function receipt(tx,pid) {
    const row=await tx.one('SELECT attempt_id,digest,snapshot,record_id,saved_at FROM plaza_record_receipts WHERE participant_id=$1',[pid]);
    return row ? {...row,saved:!!row.record_id} : null;
  }
  async function extras(tx,room,grant) {
    const pid=grant.participant_id,a=await activity(tx,pid);
    const runs=await tx.q('SELECT * FROM plaza_ai_runs WHERE participant_id=$1',[pid]);
    return {card:studentCard(room.card),source_activity:activitySource(room.card),activity:{version:a.version,actual:a.actual,reflection:a.reflection},
      ai:Object.fromEntries(runs.map(r=>[r.kind,runView(r)])),exchange:await exchanges(tx,room,pid),receipt:await receipt(tx,pid)};
  }
  async function savePlan(tx,room,grant,ctx,body) {
    const pid=grant.participant_id,requestId=attempt(body);
    const replay=await stage3?.replayWrite(tx,pid,'plan',body);if(replay)return replay;
    const old=await tx.one('SELECT * FROM plaza_drafts WHERE participant_id=$1 FOR UPDATE',[pid]);
    requireSource(room.card,old.content);
    const run=await tx.one("SELECT * FROM plaza_ai_runs WHERE participant_id=$1 AND kind='ideas' AND status='ready'",[pid]);
    if (!run) fail(409,'두 구상을 먼저 확인해 주세요.');
    const idea=pick(run.output.ideas,body.idea_id),combination=pick(run.input.combinations,body.combination_id),intro=pick(room.card.introductions,body.introduction_id);
    if (idea.combination_id===combination.id && idea.introduction_id===intro.id) fail(400,'고른 구상에서 한 가지를 바꿔 주세요.','change_required');
    const names={};
    for (const key of ['artwork','store']) {
      const seed=pick(room.card.names[key],body[`${key}_seed_id`]);
      const value=text(body[`${key}_name`],40);
      if (value===seed.text) fail(400,'이름 후보에 내 생각을 더해 바꿔 주세요.','name_change_required');
      names[`${key}_seed_id`]=seed.id;names[`${key}_name`]=value;
    }
    const content={customer_id:run.input.customer.id,material_ids:run.input.materials.map(m=>m.id),idea_id:idea.id,
      combination_id:combination.id,introduction_id:intro.id,plan:intro.text,...names,
      changed_combination:idea.combination_id!==combination.id,changed_introduction:idea.introduction_id!==intro.id,
      ...(old.content.source_activity?{source_activity:old.content.source_activity}:{})};
    const hash=digest(JSON.stringify(content));
    if (old.last_attempt_id===requestId) {if(old.last_digest!==hash) fail(409,'같은 저장 번호의 내용이 다릅니다.','attempt_conflict');return {saved:true,duplicate:true,version:old.version,saved_at:old.saved_at};}
    phase(room,['planning']);await editable(tx,pid);
    if (body.version!==old.version) fail(409,'다른 화면의 저장을 먼저 확인해 주세요.','version_conflict');
    const saved=await tx.one(`UPDATE plaza_drafts SET content=$1,version=version+1,last_attempt_id=$2,last_digest=$3,saved_at=now()
      WHERE participant_id=$4 RETURNING version,saved_at`,[content,requestId,hash,pid]);
    await touch(tx,room,ctx,'plan_confirmed',pid);
    const result={saved:true,...saved};await stage3?.rememberWrite(tx,pid,'plan',body,result);return result;
  }
  async function ai(id,req,ctx,body) {
    const kind=body?.kind;if(!['ideas','reply'].includes(kind)) fail(400,'활동 종류를 확인해 주세요.');
    const reserved=await transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx);attempt(body);
      if(kind==='ideas')requireSource(room.card,(await tx.one('SELECT content FROM plaza_drafts WHERE participant_id=$1',[g.participant_id])).content);
      let selection=body;
      if(kind==='reply') {
        const d=await tx.one('SELECT content FROM plaza_drafts WHERE participant_id=$1',[g.participant_id]);
        const ex=await exchanges(tx,room,g.participant_id);
        if (!ex.incoming?.request) fail(409,'받은 요청을 먼저 확인해 주세요.');
        if(stage3&&body.visit_id!==ex.incoming.id)fail(409,'받은 요청의 배정이 바뀌었습니다. 다시 확인해 주세요.','visit_changed');
        selection={...d.content,request_id:ex.incoming.request.request_id};
      }
      const input=aiInput(room.card,kind,selection),hash=digest(JSON.stringify(input));
      const old=await tx.one('SELECT * FROM plaza_ai_runs WHERE participant_id=$1 AND kind=$2',[g.participant_id,kind]);
      if(old) {
        if(old.input_digest!==hash) fail(409,'이미 확인한 제안의 선택값은 바꿀 수 없습니다.','ai_selection_frozen');
        if(old.status==='ready')return {ready:runView(old)};
        if(Date.now()-new Date(old.created_at).getTime()<20000)return {ready:{kind,status:'running'}};
        const recovered=await tx.one("UPDATE plaza_ai_runs SET status='ready',source='example',failure_code='interrupted',output=$1 WHERE id=$2 RETURNING *",[exampleOutput(input),old.id]);
        await touch(tx,room,ctx,'suggestion_recovered',g.participant_id,{kind,source:'example'});
        return {ready:runView(recovered)};
      }
      phase(room,kind==='ideas'?['planning']:['exchange','reflection']);await editable(tx,g.participant_id);
      exampleOutput(input); // Validate a safe fallback before reserving the single invocation.
      const runId=crypto.randomUUID();
      await tx.q(`INSERT INTO plaza_ai_runs(id,room_id,participant_id,kind,attempt_id,input_digest,input,status,call_attempted)
        VALUES($1,$2,$3,$4,$5,$6,$7,'running',$8)`,[runId,id,g.participant_id,kind,body.attempt_id,hash,input,!!aiProvider]);
      return {runId,input};
    });
    if(reserved.ready)return reserved.ready;
    let output=exampleOutput(reserved.input),source='example',failure_code='provider_not_configured',timeout;
    const controller=new AbortController();
    if(aiProvider)try {
      // The provider (lib/plaza-ai.js) is injected only when configured; it may only pick vetted option IDs.
      const value=await Promise.race([aiProvider(structuredClone(reserved.input),{signal:controller.signal}),new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},aiProvider.timeoutMs||8000);})]);
      output=validatedOutput(reserved.input,value);source='ai';failure_code=null;
    }catch{failure_code=controller.signal.aborted?'timeout':'unavailable_or_invalid';}finally{clearTimeout(timeout);}
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx);
      const row=await tx.one(`UPDATE plaza_ai_runs SET status='ready',source=$1,failure_code=$2,output=$3
        WHERE id=$4 AND participant_id=$5 AND status='running' RETURNING *`,[source,failure_code,output,reserved.runId,g.participant_id]);
      await touch(tx,room,ctx,'suggestion_ready',g.participant_id,{kind,source:row?.source||'example'});
      return runView(row||await tx.one('SELECT * FROM plaza_ai_runs WHERE id=$1',[reserved.runId]));
    });
  }
  async function saveSource(id,req,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id;
      const replay=await stage3?.replayWrite(tx,pid,'source-activity',body);if(replay)return replay;
      const requestId=attempt(body),content=sourceInput(room.card,body),hash=digest(JSON.stringify(content));
      const old=await tx.one('SELECT * FROM plaza_drafts WHERE participant_id=$1 FOR UPDATE',[pid]);
      if(old.last_attempt_id===requestId){if(old.last_digest!==hash)fail(409,'같은 저장 번호의 내용이 다릅니다.','attempt_conflict');return {saved:true,duplicate:true,version:old.version};}
      phase(room,['planning']);await editable(tx,pid);
      if(old.content.idea_id||await tx.one("SELECT 1 FROM plaza_ai_runs WHERE participant_id=$1 AND kind='ideas'",[pid]))fail(409,'구상에 사용한 영감은 고정됩니다. 같은 내용으로 작품을 이어가 주세요.','source_activity_frozen');
      if(!Number.isSafeInteger(body.version)||body.version!==old.version)fail(409,'다른 화면의 저장을 먼저 확인해 주세요.','version_conflict');
      // Confirmation is not a completed plan. Keep saved_at null until the sign and plan are saved.
      const row=await tx.one(`UPDATE plaza_drafts SET content=$1,version=version+1,last_attempt_id=$2,last_digest=$3
        WHERE participant_id=$4 RETURNING version`,[{...old.content,source_activity:{...content,confirmed_at:new Date().toISOString()}},requestId,hash,pid]);
      await touch(tx,room,ctx,'source_activity_confirmed',pid,{adapter_id:content.adapter_id,mode:content.mode});
      const result={saved:true,...row};await stage3?.rememberWrite(tx,pid,'source-activity',body,result);return result;
    });
  }
  async function saveActivity(id,req,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id,a=await activity(tx,pid);
      const replay=await stage3?.replayWrite(tx,pid,'activity',body);if(replay)return replay;
      const requestId=attempt(body);let content;
      if(body.kind==='actual') {
        if(!['same','changed','not_made'].includes(body.result)) fail(400,'제작 결과를 골라 주세요.');
        content={result:body.result,note:text(body.note,200)};
      }else if(body.kind==='reflection') {
        if(!Array.isArray(body.answers)||body.answers.length!==3)fail(400,'돌아보기 세 문항을 확인해 주세요.');
        content={answers:body.answers.map(value=>text(value,220))};
      }else fail(400,'활동 종류를 확인해 주세요.');
      const hash=digest(JSON.stringify({kind:body.kind,content}));
      if(a.last_attempt_id===requestId){if(a.last_digest!==hash)fail(409,'같은 저장 번호의 내용이 다릅니다.','attempt_conflict');return {saved:true,version:a.version,duplicate:true};}
      phase(room,body.kind==='actual'?['returning','exchange','reflection']:['reflection']);await editable(tx,pid);
      if(a.version!==body.version)fail(409,'다른 화면의 저장을 먼저 확인해 주세요.','version_conflict');
      const column=body.kind==='actual'?'actual':'reflection';
      const row=await tx.one(`UPDATE plaza_activities SET ${column}=$1,version=version+1,last_attempt_id=$2,last_digest=$3,saved_at=now() WHERE participant_id=$4 RETURNING version`,[content,requestId,hash,pid]);
      await touch(tx,room,ctx,`${column}_saved`,pid);
      const result={saved:true,...row};await stage3?.rememberWrite(tx,pid,'activity',body,result);return result;
    });
  }
  async function message(id,req,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id;
      const requestId=attempt(body),kind=body.kind;
      const replay=await stage3?.replayWrite(tx,pid,'message',body);if(replay)return replay;
      if(!['request','reply','reaction'].includes(kind))fail(400,'교류 단계를 확인해 주세요.');
      const outgoing=kind!=='reply';
      const visit=await tx.one(`SELECT * FROM plaza_visits WHERE room_id=$1 ${stage3?'AND retired_at IS NULL':''} AND ${outgoing?'visitor_id=$2':stage3?'host_id=$2':'(host_id=$2 OR (visitor_id=$2 AND substitute))'}`,[id,pid]);
      if(!visit)fail(409,'방문 배정을 먼저 확인해 주세요.');
      if(stage3&&body.visit_id!==visit.id)fail(409,'방문 배정이 바뀌었습니다. 상대를 다시 확인해 주세요.','visit_changed');
      let content;
      if(kind==='request')content={request_id:pick(room.card.requests,body.request_id).id};
      if(kind==='reply') {
        if(!visit.request)fail(409,'요청을 먼저 보내거나 받아 주세요.');
        const run=await tx.one("SELECT * FROM plaza_ai_runs WHERE participant_id=$1 AND kind='reply' AND status='ready'",[pid]);
        if(!run)fail(409,'답장 초안을 먼저 확인해 주세요.');
        const original=pick(room.card.reply_options,run.output.reply_id);
        const revised=text(body.text,300);
        if(revised===original.text)fail(400,'답장 초안을 내 말로 바꿔 주세요.','change_required');
        // Students can select a reviewed alternative or write their own short revision.
        content={text:revised,draft_reply_id:original.id,draft_source:run.source};
      }
      if(kind==='reaction') {if(!visit.reply&&!visit.fallback_reply)fail(409,'도착한 답장을 먼저 읽어 주세요.');content={reaction_id:pick(room.card.reactions,body.reaction_id).id};}
      if(stage3){
        const medium=body.medium||'online';
        if(!['online','paper-confirmed'].includes(medium)||(medium==='paper-confirmed'&&body.confirm!==true))fail(400,'종이로 한 활동은 본인이 내용을 확인해 주세요.');
        content.medium=medium;
      }
      const hash=digest(JSON.stringify(content));
      if(visit[kind]) {
        if(visit[kind].attempt_id===requestId && visit[kind].digest===hash)return {saved:true,duplicate:true};
        fail(409,'이미 보낸 내용은 확정되어 있습니다.','message_frozen');
      }
      phase(room,['exchange','reflection']);await editable(tx,pid);
      const message={...content,attempt_id:requestId,digest:hash,source:'student'};
      await tx.q(`UPDATE plaza_visits SET ${kind}=$1 WHERE id=$2`,[message,visit.id]);
      if(stage3&&visit.substitute){
        if(kind==='request')await tx.q('UPDATE plaza_visits SET fallback_reply=$1 WHERE id=$2',[{text:room.card.reply_options[0].text,source:'example',reason:visit.reason},visit.id]);
        if(kind==='reply')await tx.q('UPDATE plaza_visits SET reaction=$1 WHERE id=$2',[{reaction_id:room.card.reactions[0].id,source:'example',reason:visit.reason},visit.id]);
      }
      await touch(tx,room,ctx,`${kind}_sent`,pid,{substitute:visit.substitute,medium:content.medium||'online'});
      const result={saved:true};await stage3?.rememberWrite(tx,pid,'message',body,result);return result;
    });
  }
  async function board(id,req,ctx,since) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx);await own(tx,room,req,ctx);
      if(String(room.version)===since)return {version:room.version,unchanged:true};
      const rows=await tx.q(`SELECT p.id,p.store_public_id,p.current_photo_id,d.content,d.saved_at FROM plaza_participants p
        JOIN plaza_drafts d ON d.participant_id=p.id WHERE p.room_id=$1 AND p.status='active' ${stage3?"AND p.attendance='present'":''} AND d.saved_at IS NOT NULL ORDER BY p.store_public_id`,[id]);
      if(stage4)for(const p of rows)if(!await stage4.photoAllowed(tx,id,p.id))p.current_photo_id=null;
      return {version:room.version,stores:rows.map(p=>({id:p.store_public_id,name:p.content.store_name,artwork_name:p.content.artwork_name,introduction:p.content.plan,
        photo_url:p.current_photo_id&&['exchange','reflection'].includes(room.state)?`/api/plaza/rooms/${id}/photos/${p.current_photo_id}`:null}))};
    });
  }
  async function counts(tx,room) {
    const rows=await tx.q(`SELECT p.id,${stage4?'p.record_choice,p.activity_completed_at,':''}${stage3?'p.attendance':"'present' AS attendance"},d.saved_at AS plan,d.content->'source_activity' AS source_activity,a.actual,a.reflection,r.record_id,
      v.request,v.reaction,${stage3?'(v.substitute OR incoming.substitute OR v.fallback_reply IS NOT NULL OR incoming.fallback_reply IS NOT NULL) AS substitute,incoming.reply':'v.substitute,COALESCE(incoming.reply,CASE WHEN v.substitute THEN v.reply END) AS reply'}
      FROM plaza_participants p JOIN plaza_drafts d ON d.participant_id=p.id
      LEFT JOIN plaza_activities a ON a.participant_id=p.id LEFT JOIN plaza_record_receipts r ON r.participant_id=p.id
      LEFT JOIN plaza_visits v ON v.visitor_id=p.id ${stage3?'AND v.retired_at IS NULL':''} LEFT JOIN plaza_visits incoming ON incoming.host_id=p.id ${stage3?'AND incoming.retired_at IS NULL':''}
      WHERE p.room_id=$1 AND p.status<>'left'`,[room.id]);
    const complete=r=>r.request&&r.reply&&r.reaction;
    const present=rows.filter(r=>r.attendance==='present');
    return {progress:rows.map(r=>({id:r.id,attendance:r.attendance,source_activity:!!r.source_activity,plan:!!r.plan,actual:!!r.actual,request:!!r.request,reply:!!r.reply,reaction:!!r.reaction,reflection:!!r.reflection,saved:!!r.record_id,substitute:!!r.substitute})),
      counts:{present:present.length,absent:rows.length-present.length,source_activity_missing:activitySource(room.card)?present.filter(r=>!r.source_activity).length:0,plan_missing:present.filter(r=>!r.plan).length,actual_missing:present.filter(r=>!r.actual).length,exchange_missing:present.filter(r=>!complete(r)).length,
        peer_complete:rows.filter(r=>complete(r)&&!r.substitute).length,substitute_complete:rows.filter(r=>complete(r)&&r.substitute).length,
        record_saved:rows.filter(r=>r.record_id).length,record_missing:rows.filter(r=>r.record_choice!=='no-record'&&!r.record_id).length,
        ...(stage4?{no_record:rows.filter(r=>r.record_choice==='no-record').length,activity_completed:rows.filter(r=>r.activity_completed_at).length}: {})}};
  }
  async function transition(tx,room,ctx,body) {
    const targets={planning:['paused','closed'],paused:['planning','returning','closed'],returning:['exchange','closed'],exchange:['reflection','closed'],reflection:['closed']};
    if(!targets[room.state]?.includes(body.state))fail(409,'수업 순서에 맞게 진행해 주세요.');
    const summary=await counts(tx,room);
    let reason=null;
    if(body.state==='closed'&&summary.counts.record_missing)reason=text(body.reason,300);
    if(body.state==='exchange') {
      const active=await tx.q(`SELECT id FROM plaza_participants WHERE room_id=$1 AND status='active' ${stage3?"AND attendance='present'":''} ORDER BY id`,[room.id]);
      if(!active.length)fail(409,'참여자가 없어서 광장을 열지 않았습니다.');
      if(!Array.isArray(body.participant_ids)||JSON.stringify([...body.participant_ids].sort())!==JSON.stringify(active.map(p=>p.id).sort()))fail(409,'현재 참여자 명단을 다시 확인해 주세요.','roster_changed');
      if(await tx.one('SELECT 1 FROM plaza_visits WHERE room_id=$1',[room.id]))fail(409,'확정한 방문 배정은 다시 섞지 않습니다.');
      if(stage3)await stage3.openVisits(tx,room,active.map(p=>p.id));
      else for(const v of cycle(active.map(p=>p.id)))await tx.q('INSERT INTO plaza_visits(id,room_id,visitor_id,host_id,substitute) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),room.id,v.visitor_id,v.host_id,v.substitute]);
    }
    await event(tx,room,ctx.user,'stage2_transition',null,{to:body.state,counts:summary.counts,reason});
  }
  async function prepareRecord(id,req,ctx) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id;
      if(stage4&&g.record_choice==='no-record')fail(409,'진로기록 없이 참여 중입니다. 활동 완료를 눌러 주세요.','record_declined');
      const existing=await receipt(tx,pid);if(existing)return existing;
      phase(room,['reflection']);
      const d=(await tx.one('SELECT * FROM plaza_drafts WHERE participant_id=$1',[pid])).content,a=await activity(tx,pid),ex=await exchanges(tx,room,pid);
      if(!d.idea_id||!a.actual||!a.reflection||!ex.outgoing?.request||!ex.incoming?.reply||!ex.outgoing?.reaction)fail(409,'구상, 제작 확인, 요청·답장·반응과 돌아보기를 모두 확인해 주세요.','activity_incomplete');
      const runs=await tx.q("SELECT kind,source,call_attempted,output,failure_code FROM plaza_ai_runs WHERE participant_id=$1 AND status='ready' ORDER BY kind",[pid]);
      const idea=runs.find(r=>r.kind==='ideas'),reply=runs.find(r=>r.kind==='reply');
      if(!idea||!reply)fail(409,'활동 출처를 확인하지 못했습니다.');
      const customer=pick(room.card.customers,d.customer_id),combo=pick(room.card.combinations,d.combination_id);
      const materialNames=combo.material_ids.map(m=>pick(room.card.materials,m).title).join(', ');
      const origin=source=>source==='ai'?'AI 제안':'준비된 예시';
      const substituted=ex.outgoing.substitute||ex.incoming.substitute;
      const provenance={program_key:room.card.program_key,version:room.card.version,example_version:room.card.example_version,planning:{source:idea.source,selected:pick(idea.output.ideas,d.idea_id),decision:d},actual:a.actual,
        exchange:{mode:substituted?'example-substitution':'peer',sent_request_id:ex.outgoing.request.request_id,
          own_reply:ex.incoming.reply.text,reply_source:reply.source,sent_reaction_id:ex.outgoing.reaction.reaction_id,
          received_reply_source:ex.outgoing.reply?.source||'pending',
          ...(stage3?{outgoing_reason:ex.outgoing.reason,incoming_reason:ex.incoming.reason,incoming_request_source:ex.incoming.request.source,
            media:{request:ex.outgoing.request.medium,reply:ex.incoming.reply.medium,reaction:ex.outgoing.reaction.medium}}:{})},
        reflection:a.reflection,ai_runs:runs};
      const fields={process:`손님: ${customer.title}\n${origin(idea.source)} 두 안 중 하나를 고르고 ${d.changed_combination?'재료 조합':''}${d.changed_combination&&d.changed_introduction?'과 ':''}${d.changed_introduction?'소개 문구':''}를 바꾸었다. 선택 재료: ${materialNames}.\n제작 확인: ${a.actual.result==='same'?'구상대로 제작':a.actual.result==='changed'?'구상에서 변경':'제작하지 않음'} · ${a.actual.note}\n교류: ${substituted?'예시 손님과 대체 진행':'배정된 또래 가게와 진행'}. 요청을 보내고, ${origin(reply.source)} 답장 초안을 내 말로 수정하고, 받은 답장에 반응을 골랐다.${stage3&&[ex.outgoing.request,ex.incoming.reply,ex.outgoing.reaction].some(m=>m.medium==='paper-confirmed')?' 종이로 진행한 교류는 재접속 후 본인이 확인해 입력했다.':''}`,
        artifact:`작품: ${d.artwork_name}\n가게: ${d.store_name}\n내가 확정한 소개: ${d.plan}\n내 답장: ${ex.incoming.reply.text}`,
        reflection:QUESTIONS.map((q,i)=>`${q}\n${a.reflection.answers[i]}`).join('\n\n')};
      fields.process=sourceRecord(room.card,d)+fields.process;
      const attemptId=crypto.randomUUID();if(!submission({...fields,deck_id:room.deck_id,attempt_id:attemptId}))fail(400,'최종 기록 길이를 확인해 주세요.');
      const snapshot={...fields,plaza:provenance},hash=digest(JSON.stringify(snapshot));
      await tx.q('INSERT INTO plaza_record_receipts(participant_id,attempt_id,snapshot,digest) VALUES($1,$2,$3,$4)',[pid,attemptId,snapshot,hash]);
      await touch(tx,room,ctx,'record_prepared',pid);
      return receipt(tx,pid);
    });
  }
  async function finalize(id,req,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id;
      if(stage4&&g.record_choice==='no-record')fail(409,'진로기록 없이 참여 중입니다.','record_declined');
      const r=await receipt(tx,pid);
      if(!r||body?.attempt_id!==r.attempt_id||body.digest!==r.digest)fail(409,'먼저 저장할 내용을 확인해 주세요.','receipt_conflict');
      if(r.record_id)return {...r,duplicate:true};
      phase(room,['reflection']);
      const input=submission({...r.snapshot,deck_id:room.deck_id,attempt_id:r.attempt_id});
      const job={deck_id:room.deck_id,deck_title:room.title,session_title:room.cs.title,
        teacher_ids:[...new Set([room.cs.created_by,room.cs.instructor_id].filter(Number.isSafeInteger))],student_name:ctx.user.name,entry_kind:'student_reflection',identity:'class-code',
        plaza:{...r.snapshot.plaza,snapshot_digest:r.digest}};
      const saved=await insertCareerRecord(tx,{studentId:g.student_uuid,deck:{id:room.deck_id},cs:room.cs,input,job,provenanceDigest:r.digest});
      if(saved.conflict)fail(409,'같은 저장 번호의 기록이 다릅니다.','attempt_conflict');
      await tx.q('UPDATE plaza_record_receipts SET record_id=$1,saved_at=now() WHERE participant_id=$2',[saved.id,pid]);
      await touch(tx,room,ctx,'record_saved',pid);return {...await receipt(tx,pid),duplicate:saved.duplicate};
    });
  }
  async function finish(id,req,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx),g=await own(tx,room,req,ctx),pid=g.participant_id;
      if(!stage4||g.record_choice!=='no-record')fail(409,'진로기록 저장 경로에서 완료해 주세요.');
      const prior=await stage3.replayWrite(tx,pid,'finish',body);if(prior)return prior;
      attempt(body);phase(room,['reflection']);
      const d=await tx.one('SELECT content FROM plaza_drafts WHERE participant_id=$1',[pid]),a=await activity(tx,pid),ex=await exchanges(tx,room,pid);
      if(!d?.content.idea_id||!a.actual||!a.reflection||!ex.outgoing?.request||!ex.incoming?.reply||!ex.outgoing?.reaction)fail(409,'구상, 제작 확인, 교류와 돌아보기를 모두 확인해 주세요.','activity_incomplete');
      const row=await tx.one('UPDATE plaza_participants SET activity_completed_at=COALESCE(activity_completed_at,now()) WHERE id=$1 RETURNING activity_completed_at',[pid]);
      const result={completed:true,record_saved:false,...row};
      await stage3.rememberWrite(tx,pid,'finish',body,result);await touch(tx,room,ctx,'activity_completed_without_record',pid);
      return result;
    });
  }
  async function slides(id,ctx,body) {
    return transaction(async tx=>{
      const room=await roomFor(tx,id,ctx,true);
      if(body) {
        const deck=await tx.one('SELECT created_by FROM decks WHERE id=$1',[room.deck_id]);
        if(!['admin','superadmin'].includes(ctx.user.role)&&deck.created_by!==ctx.user.id)fail(403,'자료를 만든 강사만 교안을 등록할 수 있습니다.');
        const content=slidesInput(body);
        if(await tx.one('SELECT 1 FROM plaza_teacher_materials WHERE program_version_id=$1',[room.program_version_id]))fail(409,'이 설정 버전에 등록한 교안이 있습니다. 새 설정 버전으로 준비해 주세요.');
        await tx.q('INSERT INTO plaza_teacher_materials(program_version_id,content,created_by) VALUES($1,$2,$3)',[room.program_version_id,content,ctx.user.id]);
        await event(tx,room,ctx.user,'teacher_material_registered');
      }
      const material=await tx.one('SELECT content FROM plaza_teacher_materials WHERE program_version_id=$1',[room.program_version_id]);
      return {material:material?.content||null};
    });
  }
  return {extras,savePlan,saveSource,ai,saveActivity,message,board,counts,transition,prepareRecord,finalize,slides,finish};
}
module.exports={createStage2};
