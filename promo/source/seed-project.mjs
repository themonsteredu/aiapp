const BASE='http://localhost:3000'; let ck='';
async function api(m,p,b){const r=await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',origin:BASE,cookie:ck},body:b?JSON.stringify(b):undefined});const s=r.headers.get('set-cookie');if(s)ck=s.split(';')[0];const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p+JSON.stringify(j));return j;}
await api('POST','/api/login',{username:'superadmin',password:'Promo!Demo77'});
const pr=await api('POST','/api/projects',{title:'우리 동네 추천 AI 웹앱 만들기',schoolLabel:'모아중학교',classLabel:'1학년 1반',teamCount:6,currentSession:3});
console.log(JSON.stringify(pr));
