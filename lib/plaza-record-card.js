'use strict';
const QRCode=require('qrcode');
const {UUID}=require('./plaza-program');
function cardUrl(id,port=process.env.PORT||'3000') {
  if(!UUID.test(id)||!/^\d{1,5}$/.test(String(port))||Number(port)<1||Number(port)>65535)throw new Error('로컬 시험 카드 주소를 확인해 주세요.');
  // Test-only canonical origin. Host/X-Forwarded-Host and client input never choose the QR destination.
  return `http://127.0.0.1:${Number(port)}/class#/plaza-record/${id.toLowerCase()}`;
}
function registerRecordCard({route,one,identity,staffScope,send,fail}) {
  route('GET',/^\/api\/career-log\/records\/([0-9a-f-]{36})\/card$/i,'student',async(req,res,ctx)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Cookie');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    const missing=()=>fail(res,404,'현재 열람할 수 있는 광장 기록을 찾지 못했습니다. 로그인과 내 진로기록을 확인해 주세요.');
    if(!UUID.test(ctx.params[0]))return missing();
    const params=[ctx.params[0]];let scope;
    if(ctx.user.role==='student'){
      const who=await identity(req,ctx);if(!who)return missing();
      params.push(who.student_id);scope='r.student_id=$2';
    }else scope=staffScope(ctx,params);
    // A QR is an address, not a capability. Reuse the existing record identity/staff scope on every read.
    // Hide superseded snapshots; a printed old URL never resurfaces an outdated original.
    const record=await one(`SELECT r.id,r.occurred_at,r.process,r.artifact,r.reflection,r.verification_status,
      r.raw_data->'job'->>'deck_title' AS title,r.raw_data->'job'->'plaza'->>'program_key' AS program_key,
      r.raw_data->'job'->'plaza'->>'version' AS program_version
      FROM career_log.records r WHERE r.id=$1 AND r.source='job' AND ${scope}
      AND jsonb_typeof(r.raw_data->'job'->'plaza')='object'
      AND NOT EXISTS(SELECT 1 FROM career_log.records n WHERE n.student_id=r.student_id AND n.supersedes_id=r.id)`,params);
    if(!record)return missing();
    const url=cardUrl(record.id);
    const svg=await QRCode.toString(url,{type:'svg',errorCorrectionLevel:'M',margin:4,color:{dark:'#17324d',light:'#ffffff'}});
    return send(res,200,{record,url,qr_data_url:`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,local_test_only:true,
      access_note:'QR은 기록 주소이며 열람 권한을 주지 않습니다. 기존 로그인과 기록 열람 권한이 필요합니다. 수업 코드 접속은 수업 종료·만료 또는 기기 재발급 후 사용할 수 없습니다. 인쇄물은 직접 보관해 주세요.'});
  });
}
module.exports={cardUrl,registerRecordCard};
