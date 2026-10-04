'use strict';
const {plazaConfig}=require('../lib/plaza-config');
async function setup(){
  if(!plazaConfig()?.stage5)throw new Error('5단계 별도 로컬 시험 환경이 필요합니다.');
  // No new schema, automatic migration or central-account changes in stage 5.
  return require('./plaza-stage4-setup').setup();
}
module.exports={setup};
if(require.main===module)setup().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
