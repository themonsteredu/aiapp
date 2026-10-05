'use strict';
const {activitySources} = require('./plaza-activity-source');
const crypto=require('node:crypto');
const {validateCard,templates}=require('./plaza-card-catalog');
const {UUID,fail}=require('./plaza-program');
const admin=user=>['admin','superadmin'].includes(user.role);
const positive=value=>Number.isSafeInteger(value)&&value>0;
function createStage5({transaction,guestDeckAccess,canManageSession,storage}) {
  async function staff(tx,ctx) {
    if(!['instructor','admin','superadmin'].includes(ctx.user.role))fail(403,'담당 강사만 이용할 수 있습니다.');
    if(!await tx.one('SELECT 1 FROM sessions WHERE token=$1 AND user_id=$2 AND expires_at>now()',[ctx.token,ctx.user.id]))fail(401,'접속이 만료되었습니다.');
  }
  async function deckFor(tx,id,ctx) {
    const deck=await tx.one('SELECT id,title,created_by FROM decks WHERE id=$1 FOR SHARE',[id]);
    if(!deck||(!admin(ctx.user)&&deck.created_by!==ctx.user.id))fail(403,'자신이 만든 수업 자료에 수업 설정을 저장해 주세요.');
    return deck;
  }
  return {
    list:ctx=>transaction(async tx=>{
      await staff(tx,ctx);
      const params=admin(ctx.user)?[]:[ctx.user.id];
      const decks=await tx.q(`SELECT id,title FROM decks ${params.length?'WHERE created_by=$1':''} ORDER BY id DESC LIMIT 200`,params);
      const programs=await tx.q(`SELECT p.id,p.program_key,p.version,p.deck_id,p.review_status,p.card,d.title AS deck_title FROM plaza_program_versions p JOIN decks d ON d.id=p.deck_id ${params.length?'WHERE d.created_by=$1':''} ORDER BY p.program_key,p.version DESC LIMIT 200`,params);
      const sessions=await tx.q(`SELECT id,title,code FROM class_sessions WHERE active AND expires_at>now() ${params.length?'AND (created_by=$1 OR instructor_id=$1)':''} ORDER BY id DESC LIMIT 100`,params);
      return {programs,decks,sessions,activity_sources:activitySources(),templates:templates(),synthetic_templates:process.env.PLAZA_SYNTHETIC_KIT==='1'?templates({synthetic:true}):[],real_collection_allowed:false};
    }),
    register:(ctx,body)=>transaction(async tx=>{
      await staff(tx,ctx);
      if(!positive(body?.deck_id))fail(400,'실제 수업 자료 번호를 선택해 주세요.');
      await deckFor(tx,body.deck_id,ctx);
      const card=validateCard(body.card);
      if(card.materials_status==='test-approved'&&process.env.PLAZA_SYNTHETIC_KIT!=='1')fail(409,'가짜 키트 시험 설정에서만 시험 재료를 등록할 수 있습니다.');
      await tx.q("SELECT pg_advisory_xact_lock(hashtext('plaza-program'),hashtext($1))",[card.program_key]);
      const previous=await tx.one('SELECT * FROM plaza_program_versions WHERE program_key=$1 AND version=$2',[card.program_key,card.version]);
      if(previous){
        let same=false;try{same=JSON.stringify(validateCard(previous.card))===JSON.stringify(card);}catch{}
        if(previous.deck_id!==body.deck_id||!same)fail(409,'이미 저장된 설정 버전입니다. 내용을 바꾸려면 설정 버전 숫자를 올려 새로 저장해 주세요.');
        return {id:previous.id,duplicate:true,review_status:'test-only'};
      }
      const row=await tx.one("INSERT INTO plaza_program_versions(id,program_key,version,deck_id,card,review_status) VALUES($1,$2,$3,$4,$5,'test-only') RETURNING id",[crypto.randomUUID(),card.program_key,card.version,body.deck_id,card]);
      return {...row,duplicate:false,review_status:'test-only'};
    }),
    prepare:(ctx,body)=>transaction(async tx=>{
      await staff(tx,ctx);
      if(!positive(body?.class_session_id)||!UUID.test(body?.program_version_id||'')||!positive(body?.seat_count)||body.seat_count>100)fail(400,'담당 수업·저장한 수업 설정·자리 수(1~100)를 확인해 주세요.');
      const program=await tx.one('SELECT * FROM plaza_program_versions WHERE id=$1',[body.program_version_id]);
      if(!program)fail(404,'저장한 수업 설정을 찾을 수 없습니다.');
      await deckFor(tx,program.deck_id,ctx);
      // Class lock serializes room creation and configuration retries. Existing rooms are never rewritten.
      const cs=await tx.one('SELECT * FROM class_sessions WHERE id=$1 FOR UPDATE',[body.class_session_id]);
      if(!cs||!canManageSession(ctx.user,cs))fail(403,'담당 수업만 준비할 수 있습니다.');
      if(!cs.active||new Date(cs.expires_at)<=new Date())fail(403,'수업 이용 시간이 끝났습니다.');
      if(cs.deck_id!==program.deck_id&&!await tx.one('SELECT 1 FROM session_items WHERE session_id=$1 AND deck_id=$2',[cs.id,program.deck_id]))fail(403,'이번 수업에 등록할 자료를 먼저 배정해 주세요.');
      if(!(await guestDeckAccess(cs,program.deck_id,tx)).allowed)fail(403,'수업에 자료를 배정하고 학생 공개·잠금 해제를 확인해 주세요.');
      const old=await tx.one('SELECT * FROM plaza_rooms WHERE class_session_id=$1 AND deck_id=$2',[cs.id,program.deck_id]);
      if(old){
        if(old.state==='closed'||await storage.marker('room',old.id))fail(410,'종료되거나 파기된 광장은 다시 열지 않습니다. 새 수업을 준비해 주세요.');
        if(old.program_version_id!==program.id||old.seat_count!==body.seat_count)fail(409,'준비된 광장의 수업 설정과 자리 수는 바꾸지 않습니다.');
        return {id:old.id,duplicate:true,policy_required:!await tx.one('SELECT 1 FROM plaza_retention_policies WHERE room_id=$1',[old.id])};
      }
      validateCard(program.card);
      const room=await tx.one('INSERT INTO plaza_rooms(id,class_session_id,deck_id,program_version_id,seat_count) VALUES($1,$2,$3,$4,$5) RETURNING id',[crypto.randomUUID(),cs.id,program.deck_id,program.id,body.seat_count]);
      return {...room,duplicate:false,policy_required:true};
    }),
  };
}
module.exports={createStage5};
