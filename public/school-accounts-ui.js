// 학교·기관 학생 계정 발급 화면. 서버 API는 lib/school-registry-api.js.
// 임시 비밀번호는 발급 직후 이 화면 메모리에만 두고, 학교를 바꾸거나 화면이 가려지면 지운다 (모아허브와 같은 규칙).
// 쓴 사람 줄은 학생 화면(내 진로기록)·모아허브와 같은 규칙을 그대로 쓴다.
import { recordWriter, recordSession } from './career-log-ui.js';

export function registerSchoolAccountsUI({ route, api, shell, state, esc, toast, navigate, level, icon }) {
  const IO = window.AccountRoster;
  const PAGE = '#/school-accounts';
  const isAdmin = () => !!state.me && level(state.me.role) >= 2;
  const S = { schoolId: '', schools: [], students: [], mode: 'class', grade: '', classNumber: '', rosterText: '', preview: [], previewKey: '', issued: [], editing: null };
  const clearIssued = () => { S.issued = []; };
  const clearPreview = () => { S.preview = []; S.previewKey = ''; };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S.issued.length) { clearIssued(); if (location.hash === PAGE) navigate(); }
  });
  const msg = (text, err = false) => `<p class="career-message${err ? ' is-error' : ''}" role="${err ? 'alert' : 'status'}">${esc(text)}</p>`;
  const setMsg = (id, text, err = false) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = `msg ${err ? 'err' : 'ok'}`; } };
  const school = () => S.schools.find(s => s.id === S.schoolId) || null;
  const rowValues = s => [s.grade ?? '', s.classNumber ?? '', s.studentNumber ?? '', s.displayName ?? s.display_name ?? '', s.username];
  const fileName = suffix => `${IO.safeFilePart(school()?.name || '학교')}_${suffix}_${new Date().toISOString().slice(0, 10)}.csv`;
  function download(headers, rows, name) {
    const blob = new Blob([IO.csv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const previewKey = () => JSON.stringify([S.schoolId, S.mode, S.grade, S.classNumber, S.rosterText]);

  route(new RegExp(`^${PAGE}$`), async () => {
    if (!state.me || level(state.me.role) < 1) { location.hash = '#/'; return; }
    shell('학교 학생 계정', msg('불러오는 중…'));
    try {
      S.schools = (await api('GET', '/api/school-accounts/schools')).schools;
      if (S.schoolId && !S.schools.some(s => s.id === S.schoolId)) { S.schoolId = ''; clearIssued(); clearPreview(); S.editing = null; }
      S.students = S.schoolId ? (await api('GET', `/api/school-accounts/schools/${S.schoolId}/students`)).students : [];
      // 담당 강사 지정은 강사 이상만, 기록 권한은 진로업체 담당자도 받는다.
      const accounts = isAdmin() && S.schoolId
        ? (await api('GET', '/api/users')).users.filter(u => u.active && !u.schoolAccount)
        : [];
      const instructors = accounts.filter(u => ['instructor', 'admin', 'superadmin'].includes(u.role));
      const recordCandidates = accounts.filter(u => ['partner', 'instructor', 'admin', 'superadmin'].includes(u.role));
      const access = isAdmin() && S.schoolId ? (await api('GET', `/api/school-accounts/schools/${S.schoolId}/record-access`)).users : [];
      if (location.hash !== PAGE) return;
      render(instructors, access, recordCandidates);
    } catch (e) { shell('학교 학생 계정', msg(e.message, true)); }
  });

  function render(instructors, access = [], recordCandidates = instructors) {
    const current = school(), admin = isAdmin();
    const LEVEL = { view: '열람만', edit: '열람 + 수정' };
    shell('학교 학생 계정', `<div class="sa-page">
      <div class="page-head"><div><div class="ph-t">학교 학생 계정</div><div class="desc">모아킷 공통 학생 계정을 발급합니다. 학생은 이 아이디·비밀번호로 모아랩과 모아허브에 함께 로그인하고, 진로기록이 한 학생의 기록으로 모입니다. 수업 입장 코드 방식은 지금처럼 그대로 쓸 수 있습니다.</div></div></div>
      ${admin ? `<div class="card sa-card"><h2>학교·기관 등록 <span class="sub">관리자만 · 등록한 사람이 담당자가 됩니다</span></h2>
        <form id="sa-school-form" class="form-grid"><div><label>학교·기관 이름</label><input name="name" required maxlength="120" placeholder="예: 모아초등학교"></div><div><button class="btn btn-primary" type="submit">${icon('plus')} 등록</button></div></form><div class="msg" id="sa-school-msg"></div></div>` : ''}
      <div class="card sa-card"><h2>담당 학교</h2>
        <div class="form-grid"><div><label>학교 선택</label><select id="sa-school"><option value="">학교를 선택하세요</option>${S.schools.map(s => `<option value="${s.id}"${s.id === S.schoolId ? ' selected' : ''}>${esc(s.name)}${s.via === 'open' ? ' · 모아허브에서 열어 줌' : ''}</option>`).join('')}</select></div></div>
        ${current ? `<p class="sa-help">${current.via === 'open' ? '모아허브에서 이 학교를 모아랩에 열어 주어 관리자 권한으로 관리합니다.' : '내가 담당하는 학교입니다.'}</p>` : `<p class="sa-help">${S.schools.length ? '학교를 선택하면 학생 명단과 발급 메뉴가 나옵니다.' : '담당 학교가 없습니다. 관리자에게 학교 등록과 담당 지정을 요청하세요.'}</p>`}
        ${current && admin ? `<div class="sa-access">
          <label class="sa-check"><input type="checkbox" id="sa-open-hub"${current.openedTo.includes('moakit-hub') ? ' checked' : ''}> <span><b>모아허브(hub.moakit.ai)에 열기</b><br><span class="sa-help">켜면 모아허브 관리자가 이 학교의 학생 계정을 관리하고 담당 선생님을 지정할 수 있습니다. 학생 아이디와 진로기록은 그대로입니다.</span></span></label>
          <form id="sa-manager-form" class="form-grid"><div><label>담당 강사 지정</label><select name="instructorId" required><option value="">강사 선택</option>${instructors.map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select></div><div><button class="btn btn-ghost" type="submit">담당 지정</button></div></form><div class="msg" id="sa-manager-msg"></div>
          <div class="sa-access"><b>진로기록 열람·수정 권한</b>
            <p class="sa-help">외부 진로업체 담당자나 강사에게 이 학교 학생의 기록을 열어 줍니다. 진로업체 직원은 <a href="#/partners">진로업체 담당자</a> 화면에서 계정을 먼저 만드세요 — 그 계정은 기록 화면 말고는 아무것도 보지 못합니다. 계정 발급·수정 권한은 주어지지 않습니다. 관리자는 항상 열람·수정할 수 있습니다.</p>
            <form id="sa-access-form" class="form-grid"><div><label>계정</label><select name="userId" required><option value="">계정 선택</option>${recordCandidates.map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)}) · ${esc(u.roleLabel || u.role)}</option>`).join('')}</select></div><div><label>권한</label><select name="level"><option value="edit">열람 + 수정</option><option value="view">열람만</option></select></div><div><button class="btn btn-ghost" type="submit">권한 부여</button></div></form><div class="msg" id="sa-access-msg"></div>
            ${access.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>이름</th><th>아이디</th><th>권한</th><th>관리</th></tr></thead><tbody>${access.map(u => `<tr><td>${esc(u.name)}${u.role === 'partner' ? ' <span class="badge amber">진로업체</span>' : ''}${u.active ? '' : ' <span class="badge red">비활성</span>'}</td><td><code>${esc(u.username)}</code></td><td><span class="badge ${u.level === 'edit' ? 'green' : 'gray'}">${LEVEL[u.level] || esc(u.level)}</span></td><td><button type="button" class="btn btn-ghost btn-sm" data-sa-revoke="${u.id}">해제</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="sa-help">아직 권한을 준 계정이 없습니다.</p>'}
            <div class="sa-actions"><a class="btn btn-ghost" href="#/student-records">학생 기록 열람 화면으로</a></div>
          </div>
        </div>` : ''}
      </div>
      ${current ? rosterCard() + issuedCard() + studentsCard() : ''}
    </div>`);
    bind();
  }

  function rosterCard() {
    const single = S.mode === 'class';
    return `<div class="card sa-card"><h2>학생 계정 일괄 발급 <span class="sub">명단 입력 → 명단 확인 → 계정 발급 · 한 번에 최대 100명</span></h2>
      <form id="sa-roster-form">
        <div class="form-grid">
          <div><label>등록 방식</label><select id="sa-mode"><option value="class"${single ? ' selected' : ''}>한 반 · 번호와 이름</option><option value="school"${single ? '' : ' selected'}>여러 반 · 학년·반·번호·이름</option></select></div>
          <div id="sa-grade-field"${single ? '' : ' hidden'}><label>학년</label><select id="sa-grade"><option value="">선택</option>${[1, 2, 3, 4, 5, 6].map(g => `<option value="${g}"${String(g) === S.grade ? ' selected' : ''}>${g}학년</option>`).join('')}</select></div>
          <div id="sa-class-field"${single ? '' : ' hidden'}><label>반</label><input id="sa-class" type="number" inputmode="numeric" min="1" max="99" placeholder="예: 1" value="${esc(S.classNumber)}"></div>
        </div>
        <label class="field-label" style="display:block;margin-top:14px">학생 명단 <span class="sub" id="sa-columns">${single ? '번호 · 이름 두 열을 엑셀에서 복사해 붙여넣으세요.' : '학년 · 반 · 번호 · 이름 네 열을 엑셀에서 복사해 붙여넣으세요.'}</span></label>
        <textarea id="sa-roster" class="input sa-roster" spellcheck="false" placeholder="${single ? '1\t김하나\n2\t이두나' : '2\t1\t1\t김하나\n2\t2\t1\t이두나'}">${esc(S.rosterText)}</textarea>
        <div class="sa-actions"><button type="button" id="sa-preview" class="btn btn-primary">명단 확인</button><button type="button" id="sa-template" class="btn btn-ghost">여러 반 양식 CSV</button></div>
        <p class="sa-help">엑셀(.xlsx) 파일은 셀을 복사해 붙여넣으세요. 이미 발급한 학생을 다시 넣으면 안 됩니다. 진급·반 변경은 아래 학생 목록의 소속 수정으로 처리하면 아이디와 진로기록이 유지됩니다.</p>
        ${S.preview.length ? `<div class="sa-preview"><b>${previewSummary()}</b>
          <div class="tbl-scroll"><table class="tbl"><thead><tr><th>학년</th><th>반</th><th>번호</th><th>이름</th></tr></thead><tbody>${S.preview.map(s => `<tr><td>${s.grade}</td><td>${s.classNumber}</td><td>${s.studentNumber}</td><td>${esc(s.displayName)}</td></tr>`).join('')}</tbody></table></div>
          <label class="sa-check"><input type="checkbox" id="sa-confirm"> 기존에 계정을 발급한 학생이 아닌 신규 학생임을 확인했습니다.</label>
          <button class="btn btn-primary" type="submit">확인한 ${S.preview.length}명 계정 발급</button></div>` : ''}
        <div class="msg" id="sa-roster-msg"></div>
      </form></div>`;
  }
  function previewSummary() {
    const groups = new Map();
    for (const s of S.preview) { const g = `${s.grade}학년 ${s.classNumber}반`; groups.set(g, (groups.get(g) || 0) + 1); }
    return `총 ${S.preview.length}명 · ${[...groups].map(([name, count]) => `${name} ${count}명`).join(' / ')}`;
  }
  function issuedCard() {
    if (!S.issued.length) return '';
    return `<div class="card sa-card sa-issued"><h2>발급 완료 · 계정 파일 받기 <span class="sub">${S.issued.length}명</span></h2>
      <p class="sa-help">임시 비밀번호는 지금 이 화면에서만 볼 수 있습니다. 화면을 떠나거나 학교를 바꾸면 지워집니다. 각 학생에게 본인 계정만 전달하세요. 학생은 첫 로그인 때 비밀번호를 바꿉니다.</p>
      <div class="tbl-scroll"><table class="tbl"><thead><tr><th>학년</th><th>반</th><th>번호</th><th>이름</th><th>아이디</th><th>임시 비밀번호</th></tr></thead><tbody>${S.issued.map(s => `<tr>${rowValues(s).map(v => `<td>${esc(String(v))}</td>`).join('')}<td><code>${esc(s.temporaryPassword)}</code></td></tr>`).join('')}</tbody></table></div>
      <div class="sa-actions"><button type="button" id="sa-download-issued" class="btn btn-primary">${icon('download')} 발급 계정 CSV 다운로드</button><button type="button" id="sa-clear-issued" class="btn btn-ghost">발급 정보 지우기</button></div></div>`;
  }
  function studentsCard() {
    const e = S.editing;
    return `<div class="card sa-card"><h2>등록된 학생 <span class="sub">${S.students.length}명</span><span class="spacer"></span>${S.students.length ? '<button type="button" id="sa-download-students" class="btn btn-ghost btn-sm">학생 명단 CSV</button>' : ''}</h2>
      <p class="sa-help">비밀번호는 조회할 수 없습니다. 잊은 학생만 초기화해 새 임시 비밀번호를 전달하세요. 초기화하면 그 학생의 기존 로그인은 모두 끝납니다.</p>
      <div class="tbl-scroll"><table class="tbl resp"><thead><tr><th>학년</th><th>반</th><th>번호</th><th>이름</th><th>아이디</th><th>상태</th><th style="width:220px">관리</th></tr></thead><tbody>
        ${S.students.map(s => `<tr><td data-label="학년">${s.grade ?? '<span class="muted">-</span>'}</td><td data-label="반">${s.grade ? s.classNumber : esc(s.class_name || '')}</td><td data-label="번호">${s.studentNumber ?? '<span class="muted">-</span>'}</td><td data-label="이름" class="cell-main">${esc(s.display_name)}</td><td data-label="아이디"><code>${esc(s.username)}</code></td><td data-label="상태">${s.active ? (s.must_change_password ? '<span class="badge amber">첫 로그인 전</span>' : '<span class="badge green">사용 중</span>') : '<span class="badge red">비활성</span>'}</td>
          <td><div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-sa-edit="${s.id}">소속 수정</button><button type="button" class="btn btn-ghost btn-sm" data-sa-reset="${s.id}">비밀번호 초기화</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty-note">아직 발급한 학생 계정이 없습니다.</td></tr>'}
      </tbody></table></div>
      ${e ? `<form id="sa-edit-form" class="sa-edit"><h3 style="margin:0 0 6px">학생 소속 정보 변경 <span class="sub">${esc(e.display_name)} · ${esc(e.username)}</span></h3>${e.grade ? '' : `<p class="sa-help">기존 소속: ${esc(e.class_name || '')}. 학년·반·번호를 입력하면 같은 계정에 연결됩니다.</p>`}
        <div class="form-grid"><div><label>이름</label><input name="displayName" required maxlength="80" value="${esc(e.display_name)}"></div><div><label>학년</label><input name="grade" type="number" min="1" max="6" required value="${e.grade ?? ''}"></div><div><label>반</label><input name="classNumber" type="number" min="1" max="99" required value="${e.classNumber ?? ''}"></div><div><label>번호</label><input name="studentNumber" type="number" min="1" max="999" required value="${e.studentNumber ?? ''}"></div></div>
        <p class="sa-help">소속을 바꿔도 학생 아이디와 진로기록은 유지됩니다.</p><div class="sa-actions"><button class="btn btn-primary" type="submit">저장</button><button type="button" id="sa-edit-cancel" class="btn btn-ghost">취소</button></div><div class="msg" id="sa-edit-msg"></div></form>` : ''}
    </div>`;
  }

  function bind() {
    const $ = id => document.getElementById(id);
    const busy = (form, on) => { for (const c of form.querySelectorAll('input,select,textarea,button')) c.disabled = on; };
    $('sa-school').onchange = () => { S.schoolId = $('sa-school').value; clearIssued(); clearPreview(); S.editing = null; S.rosterText = ''; navigate(); };
    const schoolForm = $('sa-school-form');
    if (schoolForm) schoolForm.onsubmit = async e => {
      e.preventDefault(); busy(schoolForm, true);
      try { const created = await api('POST', '/api/school-accounts/schools', { name: new FormData(schoolForm).get('name') }); S.schoolId = created.id; clearIssued(); clearPreview(); toast('학교를 등록했습니다.'); navigate(); }
      catch (err) { setMsg('sa-school-msg', err.message, true); busy(schoolForm, false); }
    };
    const openHub = $('sa-open-hub');
    if (openHub) openHub.onchange = async () => {
      const enabled = openHub.checked; openHub.disabled = true;
      try { await api('PATCH', `/api/school-accounts/schools/${S.schoolId}/access`, { issuer: 'moakit-hub', enabled }); toast(enabled ? '모아허브에 열었습니다. 모아허브 관리자가 이 학교를 볼 수 있습니다.' : '모아허브 열기를 해제했습니다.'); }
      catch (err) { toast(err.message, true); openHub.checked = !enabled; }
      navigate();
    };
    const accessForm = $('sa-access-form');
    if (accessForm) accessForm.onsubmit = async e => {
      e.preventDefault(); const f = new FormData(accessForm); busy(accessForm, true);
      try { await api('PUT', `/api/school-accounts/schools/${S.schoolId}/record-access/${Number(f.get('userId'))}`, { level: f.get('level') }); toast('기록 권한을 부여했습니다.'); navigate(); }
      catch (err) { setMsg('sa-access-msg', err.message, true); busy(accessForm, false); }
    };
    document.querySelectorAll('[data-sa-revoke]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('이 계정의 기록 권한을 해제할까요?')) return;
        b.disabled = true;
        try { await api('DELETE', `/api/school-accounts/schools/${S.schoolId}/record-access/${b.dataset.saRevoke}`); toast('권한을 해제했습니다.'); }
        catch (err) { toast(err.message, true); }
        navigate();
      };
    });
    const managerForm = $('sa-manager-form');
    if (managerForm) managerForm.onsubmit = async e => {
      e.preventDefault(); busy(managerForm, true);
      try { await api('POST', `/api/school-accounts/schools/${S.schoolId}/managers`, { instructorId: Number(new FormData(managerForm).get('instructorId')) }); setMsg('sa-manager-msg', '담당 강사를 지정했습니다. 그 강사의 학교 학생 계정 메뉴에 이 학교가 나옵니다.'); }
      catch (err) { setMsg('sa-manager-msg', err.message, true); }
      busy(managerForm, false);
    };
    const rosterForm = $('sa-roster-form');
    if (!rosterForm) return;
    const readInputs = () => { S.mode = $('sa-mode').value; S.grade = $('sa-grade').value; S.classNumber = $('sa-class').value; S.rosterText = $('sa-roster').value; };
    $('sa-mode').onchange = () => { readInputs(); S.rosterText = ''; clearPreview(); navigate(); };
    for (const id of ['sa-grade', 'sa-class', 'sa-roster']) $(id).oninput = () => { readInputs(); if (S.preview.length && previewKey() !== S.previewKey) { clearPreview(); navigate(); } };
    $('sa-template').onclick = () => download(['학년', '반', '번호', '이름'], [], '학생명단_여러반_양식.csv');
    $('sa-preview').onclick = () => {
      readInputs(); clearPreview();
      try {
        const rows = IO.parseRoster(S.rosterText, { mode: S.mode, grade: S.grade, classNumber: S.classNumber });
        const key = s => [s.grade, s.classNumber, s.studentNumber].join(':');
        const occupied = new Set(S.students.filter(s => s.grade && s.classNumber && s.studentNumber).map(key));
        const dup = rows.find(s => occupied.has(key(s)));
        if (dup) throw new Error(`${dup.grade}학년 ${dup.classNumber}반 ${dup.studentNumber}번은 이미 등록되어 있습니다. 기존 학생의 소속 수정을 이용하세요.`);
        S.preview = rows; S.previewKey = previewKey(); navigate();
      } catch (err) { setMsg('sa-roster-msg', err.message, true); }
    };
    rosterForm.onsubmit = async e => {
      e.preventDefault(); readInputs();
      if (!S.preview.length || previewKey() !== S.previewKey) { clearPreview(); setMsg('sa-roster-msg', '명단이 바뀌었습니다. 명단 확인을 다시 눌러 주세요.', true); return; }
      if (!$('sa-confirm')?.checked) { setMsg('sa-roster-msg', '신규 학생 명단 확인란에 체크해 주세요.', true); return; }
      busy(rosterForm, true); setMsg('sa-roster-msg', `${S.preview.length}명 계정을 발급하는 중… 창을 닫지 마세요.`);
      try {
        const result = await api('POST', `/api/school-accounts/schools/${S.schoolId}/students`, { students: S.preview.map(s => ({ ...s })) });
        S.issued = result.students; S.rosterText = ''; clearPreview();
        toast(`${result.students.length}명 계정을 발급했습니다. 계정 파일을 지금 내려받으세요.`); navigate();
      } catch (err) { setMsg('sa-roster-msg', err.message, true); busy(rosterForm, false); }
    };
    const dl = $('sa-download-issued');
    if (dl) dl.onclick = () => download(['학교', '학년', '반', '번호', '이름', '아이디', '임시 비밀번호'], S.issued.map(s => [school()?.name || '', ...rowValues(s), s.temporaryPassword]), fileName('발급계정'));
    const clr = $('sa-clear-issued');
    if (clr) clr.onclick = () => { clearIssued(); navigate(); };
    const dls = $('sa-download-students');
    if (dls) dls.onclick = () => download(['학교', '학년', '반', '번호', '이름', '아이디', '기존 소속'], S.students.map(s => [school()?.name || '', ...rowValues(s), s.grade ? '' : s.class_name || '']), fileName('학생명단'));
    document.querySelectorAll('[data-sa-edit]').forEach(b => { b.onclick = () => { S.editing = S.students.find(s => s.id === b.dataset.saEdit) || null; navigate(); }; });
    document.querySelectorAll('[data-sa-reset]').forEach(b => {
      b.onclick = async () => {
        const s = S.students.find(x => x.id === b.dataset.saReset); if (!s) return;
        if (!confirm(`${s.display_name} 학생의 임시 비밀번호를 새로 발급할까요? 이 학생의 기존 로그인은 모두 종료됩니다.`)) return;
        b.disabled = true;
        try { const r = await api('POST', `/api/school-accounts/schools/${S.schoolId}/students/${s.id}/reset`); S.issued = [{ ...s, displayName: s.display_name, temporaryPassword: r.temporaryPassword }]; toast('임시 비밀번호를 새로 발급했습니다. 계정 파일을 내려받아 전달하세요.'); }
        catch (err) { toast(err.message, true); }
        navigate();
      };
    });
    const editForm = $('sa-edit-form');
    if (editForm) {
      $('sa-edit-cancel').onclick = () => { S.editing = null; navigate(); };
      editForm.onsubmit = async e => {
        e.preventDefault(); const f = new FormData(editForm); busy(editForm, true);
        try { await api('PATCH', `/api/school-accounts/schools/${S.schoolId}/students/${S.editing.id}`, { displayName: f.get('displayName'), grade: Number(f.get('grade')), classNumber: Number(f.get('classNumber')), studentNumber: Number(f.get('studentNumber')) }); S.editing = null; toast('소속 정보를 수정했습니다. 아이디와 진로기록은 그대로입니다.'); navigate(); }
        catch (err) { setMsg('sa-edit-msg', err.message, true); busy(editForm, false); }
      };
    }
  }

  // ================= 학생 기록 열람·수정 =================
  // 관리자와 기록 권한(record_access)을 받은 계정만. 최신 버전만 보여주고, 정정은 새 버전으로 남긴다.
  const RP = '#/student-records';
  const isPartner = () => !!state.me && state.me.role === 'partner';
  const PROGRAM_LABELS = { 'history-ai-01': '역사 AI 수업', 'science-observation-ai-03': '자연을 관찰하는 AI', 'aviation-mobility-01': '항공 모빌리티', 'hub-submission-v1': '활동 결과물 제출', 'job-staff-record': '담당자 기록', 'job-career-observation': '진로 관찰 기록' };
  // 진로 관찰 기록인지 판단한다. 정정본은 entry_kind 가 'revision' 이라 observation_kind/observation 을 함께 본다.
  const isObservation = r => !!r.observation || r.entry_kind === 'career_observation' || r.program_ref === 'job-career-observation';
  // 정정본은 원래 출처(학교 수업/진로 수업)를 그대로 보여준다.
  const sourceLabel = r => (r.source === 'hub' || r.original_source === 'hub') ? '모아허브 · 학교 수업' : '모아랩 · 진로 수업';
  // 정정 표시가 종류를 대신하면 안 된다 — 정정된 관찰 기록도 관찰 기록임을 알 수 있어야 한다.
  const kindLabel = r => r.supersedes_id ? `${isObservation(r) ? '진로 관찰 기록 ' : ''}<span class="badge amber">정정됨</span>`
    : isObservation(r) ? '진로 관찰 기록' : r.entry_kind === 'staff_record' ? '담당자 작성' : (r.source === 'hub' ? '수업 활동 기록' : '학생 작성');
  // 쓴 사람(정정본이면 고친 사람)은 학생 화면과 같은 문구로 보인다 — 학생 글을 고친 정정본에 담당자를 '작성'으로 붙이지 않는다.
  // 수업 이름이 제목과 같으면(담당자 기록·웹앱 기록은 늘 같다) 되풀이하지 않는다 — recordSession.
  const subLine = (r, heading) => [recordSession(r, heading), recordWriter(r), isObservation(r) && r.deck_title ? `웹앱: ${r.deck_title}` : ''].filter(Boolean).map(esc).join(' · ');
  // 진로 관찰 기록에서 각 칸이 무엇을 묻는 칸인지. 저장 칸(process·artifact·reflection)은 그대로 두고 이름표만 바꾼다.
  const OBS_LABELS = [
    ['activity', 'process', '수업에서 한 활동과 학생의 모습', '무엇을 어떻게 했는지, 어떤 태도로 참여했는지 적어 주세요.', 1500, true],
    ['strengths', 'artifact', '드러난 강점·흥미', '잘한 점, 관심을 보인 분야를 적어 주세요.', 1500, false],
    ['next_step', 'reflection', '추천하는 다음 활동', '이어서 해 보면 좋을 활동이나 진로 탐색 방향을 적어 주세요.', 1000, false],
  ];
  const RS = { schoolId: '', schools: [], students: [], studentId: '', level: 'view', student: null, records: [], page: 0, hasMore: false, editing: null, adding: false, addKind: 'career_observation', history: {}, newPhotos: [], dropPhotos: {},
    // addDeck·addPrefill: '이 활동에 관찰 남기기'로 열면 미리 채울 웹앱·제목·날짜. deckList: GET /api/decks 결과(관리자만, 한 번만 불러온다).
    // deckError: 웹앱 목록을 못 불러왔다 — '다시 불러오기'를 누를 때까지 다시 부르지 않는다.
    addDeck: '', addPrefill: null, deckList: null, deckListFor: null, deckLoad: null, deckError: false,
    // 저장 시도 번호. 폼을 열 때 만들고 실패 후 다시 보낼 때는 그대로 쓴다 — 응답만 잃은 저장이 두 번 남지 않는다.
    addAttempt: '', editAttempt: '',
    // classFilter: 학생 선택 칸의 학년·반 거르기('' = 전체, 'other' = 기타). bulk: 반 전체 기록 작성 내용(학생별 보기로 오가도 남는다).
    classFilter: '', bulk: null, bulkOpen: false,
    // photoing: '사진 더하기'를 연 기록 id. 기록 본문은 그대로 두고 사진만 붙인다(정정 아님).
    photoing: null };
  const dateText = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }); };
  const dateInput = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function newAttemptId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // randomUUID 는 https·localhost 에서만 있다. 없으면 같은 형식(v4)을 직접 만든다.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // 저장 실패를 '저장되지 않았다'(서버가 답함 — 로그인 만료·이용 시간·동의 필요 포함)와 '결과를 모른다'(연결 끊김)로 나눈다.
  // accessBefore: 요청 직전의 state.access. api() 는 이용 시간 제한(403 time_blocked)일 때 이 값을 새로 바꾼다.
  const saveFailure = (err, accessBefore) => classifySaveError(err, { signedIn: !!state.me, mustAgree: !!state.mustAgree, accessChanged: state.access !== accessBefore });
  const saveError = (err, accessBefore) => saveFailure(err, accessBefore).message;

  // ---- 웹앱(덱) 연결 ----
  // 학생이 웹앱에서 직접 남긴 기록(raw_data.job.deck_id). 관찰 기록은 deck_id 가 있어도 여기에 들지 않는다.
  const isDeckActivity = r => !isObservation(r) && Number(r.deck_id) > 0;
  // 아무 웹앱이나 잇는 것은 관리자만이다(서버 addRecord 와 같은 규칙). 강사·진로업체 담당자는 웹앱 목록을 부르지 않고
  // 이 학생이 기록을 남긴 웹앱 가운데서만 고른다 — 볼 수 없는 웹앱의 제목이 화면이나 기록에 실리지 않는다.
  const canListDecks = () => !!state.me && level(state.me.role) >= 2;
  // 고를 수 있는 웹앱: 이 학생 기록에 나온 웹앱 + (관리자) 웹앱 목록.
  function deckChoices() {
    const mine = [], seen = new Set();
    for (const r of RS.records) {
      const id = Number(r.deck_id);
      if (!isDeckActivity(r) || seen.has(id)) continue;
      seen.add(id); mine.push({ id, title: r.deck_title || r.title || `웹앱 ${id}` });
    }
    const all = canListDecks() && RS.deckListFor === state.me.id && RS.deckList ? RS.deckList.filter(d => !seen.has(d.id)) : [];
    return { mine, all };
  }
  function deckOptionsHtml(selected) {
    const { mine, all } = deckChoices();
    const opt = d => `<option value="${d.id}"${String(d.id) === String(selected) ? ' selected' : ''}>${esc(d.title)}</option>`;
    return `<option value="">연결 안 함</option>${all.length
      ? `${mine.length ? `<optgroup label="이 학생이 활동한 웹앱">${mine.map(opt).join('')}</optgroup>` : ''}<optgroup label="다른 웹앱">${all.map(opt).join('')}</optgroup>`
      : mine.map(opt).join('')}`;
  }
  // 웹앱 목록은 처음 필요할 때 한 번만 불러온다. 불러오는 동안·실패했을 때는 선택 칸 아래에 그렇다고 알리고(조용히 '연결 안 함'만 두지 않는다),
  // 실패하면 '다시 불러오기'를 누를 때까지 다시 부르지 않는다. force: 그 버튼.
  function loadDeckList(force = false) {
    if (!canListDecks()) return;
    const me = state.me.id;
    if (RS.deckListFor === me && (RS.deckList || RS.deckLoad || (RS.deckError && !force))) return;
    RS.deckListFor = me; RS.deckList = null; RS.deckError = false;
    RS.deckLoad = api('GET', '/api/decks')
      .then(data => {
        if (RS.deckListFor !== me) return;
        RS.deckList = (data.decks || []).filter(d => Number.isSafeInteger(d.id) && d.id > 0).map(d => ({ id: d.id, title: d.title || `웹앱 ${d.id}` }));
      })
      .catch(() => { if (RS.deckListFor === me) RS.deckError = true; })
      .finally(() => {
        if (RS.deckListFor === me) RS.deckLoad = null;
        paintDeckFields();
      });
    paintDeckFields();
  }
  // 웹앱 목록 상태 문구. 선택 칸 아래 role=status 줄이 화면에 먼저 있고 글자만 바뀌어 읽힌다.
  function deckStateText(kind) {
    if (RS.deckLoad) return { text: '웹앱 목록을 불러오는 중…', err: false };
    if (RS.deckError) return { text: `웹앱 목록을 불러오지 못했습니다. ${kind === 'bulk' ? "지금은 '연결 안 함'만" : '지금은 이 학생이 활동한 웹앱만'} 고를 수 있습니다. 다시 불러오려면 아래 단추를 눌러 주세요.`, err: true };
    if (kind === 'bulk' && RS.deckList && !RS.deckList.length) return { text: '고를 수 있는 웹앱이 없습니다.', err: false };
    return { text: '', err: false };
  }
  // selectId: 이 상태 줄이 설명하는 선택 칸. 다시 불러오기를 누르면 그 칸으로 초점을 옮긴다(단추가 사라지므로).
  function deckStateHtml(selectId, kind) {
    const { text, err } = deckStateText(kind);
    return `<div class="rs-deck-state" data-rs-deck-state="${selectId}" data-rs-deck-kind="${kind}">
      <p class="msg${err ? ' err' : ''}" id="${selectId}-state" role="status" data-rs-deck-note="1">${esc(text)}</p>
      <button type="button" class="btn btn-ghost btn-sm" data-rs-deck-retry="1"${err ? '' : ' hidden'}>웹앱 목록 다시 불러오기</button></div>`;
  }
  // 쓰던 글을 지우지 않도록 화면 전체가 아니라 선택 칸의 항목과 상태 줄만 바꾼다.
  function paintDeckFields() {
    const add = document.getElementById('rs-add-deck');
    if (add) add.innerHTML = deckOptionsHtml(add.value);
    const bulk = document.getElementById('rs-bulk-deck');
    if (bulk) bulk.innerHTML = bulkDeckOptionsHtml(bulk.value);
    for (const select of [add, bulk]) {
      if (!select) continue;
      if (RS.deckLoad) select.setAttribute('aria-busy', 'true'); else select.removeAttribute('aria-busy');
    }
    document.querySelectorAll('[data-rs-deck-state]').forEach(box => {
      const { text, err } = deckStateText(box.dataset.rsDeckKind);
      const note = box.querySelector('[data-rs-deck-note]'), retry = box.querySelector('[data-rs-deck-retry]');
      if (note) { note.textContent = text; note.className = `msg${err ? ' err' : ''}`; }
      if (retry) retry.hidden = !err;
    });
  }

  route(new RegExp(`^${RP}$`), async () => {
    if (!state.me || (level(state.me.role) < 1 && !isPartner())) { location.hash = '#/'; return; }
    shell(isPartner() ? '학생 진로기록' : '학생 기록 열람', msg('불러오는 중…'));
    try {
      RS.schools = (await api('GET', '/api/school-accounts/record-schools')).schools;
      // 이 탭에 남은 반 전체 기록 작성 내용: 다른 계정의 것과 더는 열 수 없는 학교의 것은 지운다.
      // 새로 고친 탭(학교를 아직 안 고름)이면 작성 중이던 학교로 돌아간다.
      const drafts = sweepBulkDrafts(state.me.id).filter(id => {
        if (RS.schools.some(s => s.id === id)) return true;
        clearBulkDraft(state.me.id, id); return false;
      });
      if (!RS.schoolId && !RS.bulk && drafts.length) RS.schoolId = drafts[0];
      // 학교가 하나뿐인 담당자는 고르는 단계를 건너뛴다 (진로업체 담당자는 대개 한 학교만 받는다).
      if (!RS.schoolId && RS.schools.length === 1) RS.schoolId = RS.schools[0].id;
      if (RS.schoolId && !RS.schools.some(s => s.id === RS.schoolId)) { RS.schoolId = ''; RS.studentId = ''; }
      if (RS.schoolId) {
        const data = await api('GET', `/api/school-accounts/schools/${RS.schoolId}/record-students`);
        RS.students = data.students; RS.level = data.level;
        if (RS.studentId && !RS.students.some(s => s.id === RS.studentId)) RS.studentId = '';
      } else { RS.students = []; RS.studentId = ''; }
      // 반 전체 기록 작성 내용은 같은 계정·같은 학교·수정 권한일 때만 이어 쓴다 (공용 PC 에서 다음 사람에게 남지 않게).
      if (RS.bulk && !RS.bulk.running && (RS.bulk.owner !== state.me.id || RS.bulk.schoolId !== RS.schoolId || RS.level !== 'edit')) {
        if (RS.bulk.owner === state.me.id && RS.bulk.schoolId === RS.schoolId) clearBulkDraft(RS.bulk.owner, RS.bulk.schoolId);
        RS.bulk = null;
      }
      if (RS.schoolId && RS.level !== 'edit') clearBulkDraft(state.me.id, RS.schoolId);
      // 탭을 새로 고쳤으면(아이패드가 탭을 다시 읽은 경우 포함) 이 탭에 남겨 둔 작성 내용을 되살린다.
      if (!RS.bulk && RS.schoolId && RS.level === 'edit') {
        const restored = readBulkDraft(state.me.id, RS.schoolId);
        if (restored) {
          RS.bulk = restored.bulk; RS.bulkOpen = restored.open;
          if (!RS.bulk.date) RS.bulk.date = today();
        }
      }
      if (!RS.bulk) RS.bulkOpen = false;
      const classKeys = classGroups(RS.students).map(g => g.key);
      if (RS.classFilter && !classKeys.includes(RS.classFilter)) RS.classFilter = '';
      if (RS.bulk && !RS.bulk.running && RS.bulk.classKey && !classKeys.includes(RS.bulk.classKey)) { RS.bulk.classKey = ''; RS.bulk.rows = {}; }
      if (RS.studentId) {
        const data = await api('GET', `/api/school-accounts/schools/${RS.schoolId}/students/${RS.studentId}/records?page=0`);
        RS.student = data.student; RS.records = data.records; RS.hasMore = data.hasMore; RS.page = 0; RS.level = data.level;
      } else { RS.student = null; RS.records = []; }
      if (location.hash !== RP) return;
      renderRecords();
    } catch (e) { shell(isPartner() ? '학생 진로기록' : '학생 기록 열람', msg(e.message, true)); }
  });

  // ---- 활동 사진: 브라우저에서 미리 줄여 보낸다 ----
  // Vercel 이 요청 본문을 4.5MB 에서 자르므로(서버 lib/school-registry.js 의 같은 값) 장당·합계를 여기서도 지킨다.
  // 넘으면 품질을 한 단계씩 낮춰 다시 만들고, 그래도 크면 사용자에게 알린다.
  const MAX_PHOTOS = 6;
  const MAX_PHOTO_CHARS = 900_000;
  const MAX_PHOTOS_TOTAL_CHARS = 3_200_000;
  const photoChars = data => data.length - (data.indexOf(',') + 1);
  async function readPhoto(file) {
    if (!/^image\//.test(file.type || '')) throw new Error('사진은 이미지 파일만 넣을 수 있습니다.');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    let data = '';
    for (const [edge, quality] of [[1280, 0.75], [1280, 0.6], [1024, 0.6], [800, 0.55]]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL('image/jpeg', quality);
      if (photoChars(data) <= MAX_PHOTO_CHARS) break;
    }
    if (bitmap.close) bitmap.close();
    if (photoChars(data) > MAX_PHOTO_CHARS) throw new Error('사진 용량이 너무 큽니다. 더 작은 사진으로 올려 주세요.');
    return data;
  }
  const photoValue = () => RS.newPhotos.map(photo => ({ data: photo.data, caption: photo.caption }));
  const photoTotal = () => RS.newPhotos.reduce((sum, photo) => sum + photoChars(photo.data), 0);

  // 새로 고른 사진 미리보기. 글을 쓰던 중이라 화면 전체를 다시 그리지 않고 이 칸만 갈아 끼운다.
  // limit: 이번에 더 넣을 수 있는 장수 (사진 더하기는 이미 붙은 장수를 뺀 만큼). 감싸는 칸의 data-rs-limit 으로 받는다.
  function photoPickerHtml(limit = MAX_PHOTOS) {
    return `<div class="rs-photo-picker">
      <div class="rs-photo-list">${RS.newPhotos.map((photo, index) => `<figure class="rs-photo-item">
        <img src="${photo.data}" alt="">
        <input class="input" data-rs-caption="${index}" maxlength="120" value="${esc(photo.caption)}" placeholder="사진 설명 (선택)">
        <button type="button" class="btn btn-ghost btn-sm" data-rs-photo-remove="${index}">빼기</button>
      </figure>`).join('')}</div>
      <label class="btn btn-soft btn-sm rs-photo-add">사진 고르기
        <input type="file" accept="image/*" multiple hidden id="rs-photo-input">
      </label>
      <span class="sa-help">최대 ${limit}장 · 올리면 자동으로 줄여서 저장합니다. 큰 사진은 더 줄어듭니다. 학생 본인과 기록 권한이 있는 담당자만 볼 수 있습니다.</span>
      <div class="msg" id="rs-photo-msg"></div>
    </div>`;
  }
  function bindPhotoPicker(container) {
    if (!container) return;
    const input = container.querySelector('#rs-photo-input');
    const limit = Number(container.dataset.rsLimit) || MAX_PHOTOS;
    const redraw = () => { container.innerHTML = photoPickerHtml(limit); bindPhotoPicker(container); };
    if (input) input.onchange = async () => {
      const files = [...input.files];
      input.value = '';
      const note = container.querySelector('#rs-photo-msg');
      try {
        for (const file of files) {
          if (RS.newPhotos.length >= limit) throw new Error(`사진은 최대 ${limit}장까지 넣을 수 있습니다.`);
          const data = await readPhoto(file);
          if (photoTotal() + photoChars(data) > MAX_PHOTOS_TOTAL_CHARS) {
            throw new Error('한 번에 올리는 사진 용량이 너무 큽니다. 장수를 줄이거나 나눠서 올려 주세요.');
          }
          RS.newPhotos.push({ data, caption: '' });
        }
        redraw();
      } catch (err) {
        redraw();
        const after = container.querySelector('#rs-photo-msg') || note;
        if (after) { after.textContent = err.message; after.className = 'msg err'; }
      }
    };
    container.querySelectorAll('[data-rs-photo-remove]').forEach(button => {
      button.onclick = () => { RS.newPhotos.splice(Number(button.dataset.rsPhotoRemove), 1); redraw(); };
    });
    container.querySelectorAll('[data-rs-caption]').forEach(field => {
      field.oninput = () => { RS.newPhotos[Number(field.dataset.rsCaption)].caption = field.value; };
    });
  }

  // ---- 기록 카드 ----
  const photoStrip = r => (r.photos && r.photos.length) ? `<div class="rs-photos">${r.photos.map(photo => `<figure>
      <img src="/api/career-photos/${encodeURIComponent(photo.id)}" alt="${esc(photo.caption || '활동 사진')}" loading="lazy">
      ${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : '';

  // 진로 관찰 기록은 같은 칸을 관찰 항목 이름으로 보여준다.
  function bodyList(r) {
    if (isObservation(r)) {
      const obs = r.observation || {};
      const items = OBS_LABELS.map(([key, column, label]) => {
        const value = obs[key] ?? r[column] ?? '';
        return value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';
      }).join('');
      return `<dl>${items}</dl>`;
    }
    return `<dl><div><dt>활동 과정</dt><dd>${esc(r.process || '')}</dd></div>${r.artifact ? `<div><dt>결과물</dt><dd>${esc(r.artifact)}</dd></div>` : ''}${r.reflection ? `<div><dt>돌아보기</dt><dd>${esc(r.reflection)}</dd></div>` : ''}</dl>`;
  }

  // 정정 폼의 본문 칸. 진로 관찰 기록이면 관찰 항목 이름으로 받는다.
  function editFields(r) {
    if (isObservation(r)) {
      const obs = r.observation || {};
      return OBS_LABELS.map(([key, column, label, hint, max, required]) => `
        <label class="field-label" style="display:block;margin-top:10px">${esc(label)}${required ? '' : ' <span class="sub">선택 입력</span>'}</label>
        <textarea name="${key}" class="input sa-roster" maxlength="${max}"${required ? ' required' : ''} style="${required ? '' : 'min-height:70px'}" placeholder="${esc(hint)}">${esc(obs[key] ?? r[column] ?? '')}</textarea>`).join('');
    }
    return `
      <label class="field-label" style="display:block;margin-top:10px">활동 과정</label><textarea name="process" class="input sa-roster" maxlength="1500" required>${esc(r.process || '')}</textarea>
      <label class="field-label" style="display:block;margin-top:10px">결과물 <span class="sub">선택 입력</span></label><textarea name="artifact" class="input sa-roster" maxlength="1500" style="min-height:70px">${esc(r.artifact || '')}</textarea>
      <label class="field-label" style="display:block;margin-top:10px">돌아보기 <span class="sub">선택 입력</span></label><textarea name="reflection" class="input sa-roster" maxlength="1000" style="min-height:70px">${esc(r.reflection || '')}</textarea>`;
  }

  // 정정할 때 이미 있는 사진은 그대로 이어지고, 체크를 풀면 새 버전에서 빠진다 (이전 버전에는 남는다).
  function keepPhotosHtml(r) {
    if (!r.photos || !r.photos.length) return '';
    // 남기는 사진과 새로 넣는 사진을 합쳐 상한을 넘으면 저장할 때 막힌다. 미리 알려 준다.
    return `<div class="rs-keep-photos"><p class="field-label" style="margin-top:12px">이미 올린 사진</p>
      <div class="rs-photo-list">${r.photos.map(photo => `<figure class="rs-photo-item">
        <img src="/api/career-photos/${encodeURIComponent(photo.id)}" alt="${esc(photo.caption || '활동 사진')}" loading="lazy">
        <label class="small"><input type="checkbox" data-rs-keep="${esc(photo.id)}" checked> 이 사진 남기기</label>
      </figure>`).join('')}</div>
      <p class="sa-help">체크를 풀면 정정본에서 빠집니다. 이전 버전에는 그대로 남습니다. 남기는 사진과 새로 넣는 사진을 합쳐 ${MAX_PHOTOS}장을 넘을 수 없습니다.</p></div>`;
  }

  // 사진 더하기: 저장된 관찰 기록에 사진만 붙인다. 기록 본문·버전은 그대로라 '정정됨'으로 표시되지 않는다.
  function photoAddHtml(r) {
    const room = MAX_PHOTOS - (r.photos || []).length;
    return `<form class="sa-edit" data-rs-photo-form="${esc(r.id)}">
      <p class="field-label" style="margin:0" tabindex="-1" data-rs-photo-head="1">사진 더하기</p>
      <div data-rs-picker="1" data-rs-limit="${room}">${photoPickerHtml(room)}</div>
      <p class="sa-help">기록 내용은 그대로 두고 사진만 더합니다. 정정으로 남지 않습니다. 한 기록에 사진은 ${MAX_PHOTOS}장까지이고, 지금 ${room}장 더 넣을 수 있습니다.</p>
      <div class="sa-actions"><button class="btn btn-primary" type="submit">사진 저장</button><button type="button" class="btn btn-ghost" data-rs-photo-cancel="1">취소</button></div>
      <div class="msg" data-rs-photo-save-msg="1"></div></form>`;
  }

  function recordCard(r) {
    const canEdit = RS.level === 'edit';
    const editing = RS.editing === r.id;
    const hist = RS.history[r.id];
    const canAddPhotos = canEdit && isObservation(r) && (r.photos || []).length < MAX_PHOTOS;
    const recordTitle = r.title || PROGRAM_LABELS[r.program_ref] || '진로 활동';
    const sub = subLine(r, recordTitle);
    return `<article class="career-record" id="rec-${r.id}">
      <div class="career-record-meta"><span>${esc(dateText(r.occurred_at))}</span><span>${esc(sourceLabel(r))}</span><span>${kindLabel(r)}</span></div>
      <h2>${esc(recordTitle)}</h2>${sub ? `<p class="career-record-sub">${sub}</p>` : ''}
      ${editing ? `<form class="sa-edit" data-sa-revise="${r.id}">
        <div class="form-grid"><div><label>제목</label><input name="title" maxlength="120" value="${esc(r.title || '')}" placeholder="비우면 기존 제목 유지"></div><div><label>활동 날짜</label><input name="occurred_at" type="date" value="${dateInput(r.occurred_at)}"></div></div>
        ${editFields(r)}
        ${isObservation(r) ? `${keepPhotosHtml(r)}<p class="field-label" style="margin-top:12px">사진 더 넣기</p><div data-rs-picker="1">${photoPickerHtml()}</div>` : ''}
        <p class="sa-help">저장하면 새 버전으로 남고 원래 내용은 이력으로 보관됩니다. 누가 언제 고쳤는지 기록됩니다.</p>
        <div class="sa-actions"><button class="btn btn-primary" type="submit">정정 저장</button><button type="button" class="btn btn-ghost" data-sa-cancel="1">취소</button></div><div class="msg" data-sa-msg="${r.id}"></div></form>` : `
      ${bodyList(r)}
      ${photoStrip(r)}
      <div class="career-view-actions">${canEdit && isDeckActivity(r) ? `<button type="button" class="btn btn-soft btn-sm" data-rs-observe="${esc(r.id)}" aria-label="이 활동에 관찰 남기기: ${esc(r.deck_title || r.title || '웹앱 활동')}">이 활동에 관찰 남기기</button>` : ''}${canAddPhotos && RS.photoing !== r.id ? `<button type="button" class="btn btn-soft btn-sm" data-rs-photo-open="${esc(r.id)}" aria-label="사진 더하기: ${esc(recordTitle)}">사진 더하기</button>` : ''}${canEdit ? `<button type="button" class="btn btn-ghost btn-sm" data-sa-edit-rec="${r.id}">수정</button>` : ''}${r.supersedes_id ? `<button type="button" class="btn btn-ghost btn-sm" data-sa-history="${r.id}">${hist ? '이전 내용 닫기' : '이전 내용 보기'}</button>` : ''}<details class="career-receipt"><summary>접수번호</summary><code>${esc(r.id)}</code></details></div>
      ${canAddPhotos && RS.photoing === r.id ? photoAddHtml(r) : ''}
      ${hist ? `<div class="sa-history">${hist.length ? hist.map(h => `<div class="sa-history-item"><div class="career-record-meta"><span>이전 버전 · ${esc(dateText(h.created_at))} 저장</span><span>${esc(sourceLabel(h))}</span></div>${bodyList(h)}${photoStrip(h)}</div>`).join('') : '<p class="sa-help">이전 버전을 찾지 못했습니다.</p>'}</div>` : ''}`}
    </article>`;
  }

  // 기록 추가 폼. 기본값은 진로 관찰 기록이다.
  function addFormHtml() {
    const observation = RS.addKind === 'career_observation';
    const fields = observation
      ? OBS_LABELS.map(([key, , label, hint, max, required]) => `
        <label class="field-label" for="rs-add-${key}" style="display:block;margin-top:10px">${esc(label)}${required ? '' : ' <span class="sub">선택 입력</span>'}</label>
        <textarea id="rs-add-${key}" name="${key}" class="input sa-roster" maxlength="${max}"${required ? ' required' : ''} style="${required ? '' : 'min-height:70px'}" placeholder="${esc(hint)}"></textarea>`).join('')
      : `<label class="field-label" for="rs-add-process" style="display:block;margin-top:10px">활동 과정</label><textarea id="rs-add-process" name="process" class="input sa-roster" maxlength="1500" required placeholder="학생이 어떤 활동을 했는지"></textarea>
        <label class="field-label" for="rs-add-artifact" style="display:block;margin-top:10px">결과물 <span class="sub">선택 입력</span></label><textarea id="rs-add-artifact" name="artifact" class="input sa-roster" maxlength="1500" style="min-height:70px"></textarea>
        <label class="field-label" for="rs-add-reflection" style="display:block;margin-top:10px">돌아보기·관찰 <span class="sub">선택 입력</span></label><textarea id="rs-add-reflection" name="reflection" class="input sa-roster" maxlength="1000" style="min-height:70px"></textarea>`;
    // 웹앱 연결은 진로 관찰 기록에만. 관리자가 아니면 이 학생이 활동한 웹앱만 고르고, 그런 웹앱이 없으면 칸을 두지 않는다.
    const choices = deckChoices(), all = canListDecks();
    const deckField = observation && (all || choices.mine.length)
      ? `<div><label for="rs-add-deck">연결할 웹앱 <span class="sub">선택</span></label><select id="rs-add-deck" name="deck_id" aria-describedby="rs-add-deck-help${all ? ' rs-add-deck-state' : ''}"${all && RS.deckLoad ? ' aria-busy="true"' : ''}>${deckOptionsHtml(RS.addDeck)}</select>
        <p class="sa-help" id="rs-add-deck-help">${all ? '고르면 그 웹앱 활동에 대한 관찰로 이어집니다.' : '이 학생이 기록을 남긴 웹앱 가운데 고를 수 있습니다.'}</p>${all ? deckStateHtml('rs-add-deck', 'add') : ''}</div>`
      : '';
    const prefill = RS.addPrefill || {};
    return `<form id="rs-add-form" class="sa-edit">
      <div class="form-grid">
        <div><label for="rs-add-kind">기록 종류</label><select id="rs-add-kind">
          <option value="career_observation"${observation ? ' selected' : ''}>진로 관찰 기록 (사진 첨부 가능)</option>
          <option value="staff_record"${observation ? '' : ' selected'}>일반 담당자 기록 (상담·행정)</option>
        </select></div>
        <div><label for="rs-add-date">활동 날짜</label><input id="rs-add-date" name="occurred_at" type="date" value="${esc(prefill.date || dateInput(new Date().toISOString()))}"></div>
        ${deckField}
      </div>
      <label class="field-label" for="rs-add-title" style="display:block;margin-top:10px">제목</label>
      <input id="rs-add-title" name="title" class="input" maxlength="120" required value="${esc(prefill.title || '')}" placeholder="${observation ? '예: 항공 진로 체험 2회차' : '예: 진로 상담 1회차'}">
      ${fields}
      ${observation ? `<p class="field-label" style="margin-top:12px">활동 사진</p><div data-rs-picker="1">${photoPickerHtml()}</div>` : ''}
      <p class="sa-help">${observation ? '진로 관찰 기록으로 저장되며 학생 본인도 사진과 함께 볼 수 있습니다.' : '담당자 작성 기록으로 저장되며 학생 본인도 볼 수 있습니다.'} 저장한 기록은 원본으로 남고, 고칠 때는 새 버전이 추가됩니다.</p>
      <div class="sa-actions"><button class="btn btn-primary" type="submit">기록 저장</button><button type="button" id="rs-add-cancel" class="btn btn-ghost">취소</button></div><div class="msg" id="rs-add-msg"></div></form>`;
  }

  // 학생 선택 칸: 학년·반으로 거른다. 지금 보고 있는 학생은 다른 반을 골라도 목록에 남겨 선택 칸과 아래 화면이 어긋나지 않게 한다.
  function classFilterOptionsHtml() {
    return `<option value="">전체 (${RS.students.length}명)</option>${classGroups(RS.students).map(g => `<option value="${esc(g.key)}"${g.key === RS.classFilter ? ' selected' : ''}>${esc(g.label)} (${g.count}명)</option>`).join('')}`;
  }
  function studentOptionsHtml() {
    const list = RS.students.filter(s => !RS.classFilter || classKeyOf(s) === RS.classFilter);
    const current = RS.students.find(s => s.id === RS.studentId);
    if (current && !list.includes(current)) list.unshift(current);
    return `<option value="">학생을 선택하세요</option>${list.map(s => `<option value="${esc(s.id)}"${s.id === RS.studentId ? ' selected' : ''}>${esc(s.class_name)} ${esc(s.display_name)}</option>`).join('')}`;
  }

  // ---- 반 전체 기록 ----
  // 수업 직후 한 반 학생 모두의 진로 관찰 기록을 한 화면에서 남긴다. 저장은 학생마다 기존 기록 추가 API 를 차례로 부른다
  // (새 API 가 없어 진로업체 담당자 허용 목록도 그대로다). 학생마다 시도 번호를 따로 두어 다시 보내도 한 번만 남는다.
  // 사진은 받지 않는다 — 요청 본문 4.5MB 한도 때문이다. 저장한 뒤 학생별 화면의 '사진 더하기'로 붙인다(정정을 만들지 않는다).
  // 결석·제외로 표시한 학생(비활성 계정은 처음부터 제외)은 채우기·저장 모두 건너뛴다 — 저장한 기록은 지울 수 없다.
  // 작성 내용은 이 탭의 sessionStorage 에도 둔다(아이패드가 탭을 다시 읽어도 남게). 탭을 닫으면 사라지고 localStorage 는 쓰지 않는다(공용 기기).
  const today = () => dateInput(new Date().toISOString());
  const bulkStudents = () => (RS.bulk && RS.bulk.classKey ? RS.students.filter(s => classKeyOf(s) === RS.bulk.classKey) : []);
  function bulkRow(id) {
    if (!RS.bulk.rows[id]) RS.bulk.rows[id] = { activity: '', strengths: '', next_step: '', attempt: '', status: '', message: '' };
    return RS.bulk.rows[id];
  }
  // 적었지만 아직 저장하지 못한 학생 수. 학교·반을 바꾸거나 닫을 때, 창을 닫을 때 이 수로 확인을 받는다.
  // 결석·제외로 표시한 학생과, 다른 내용으로 이미 저장된 학생(서버에 기록이 있다)은 세지 않는다.
  const bulkUnsaved = () => (RS.bulk ? bulkStudents().filter(s => {
    const row = RS.bulk.rows[s.id];
    return bulkRowFilled(row) && !bulkRowSettled(row) && !bulkExcluded(s, row);
  }).length : 0);
  // 한 명이라도 저장되면(저장 확인 필요 포함) 제목·날짜·웹앱은 고정한다 — 같은 반 기록이 서로 다른 제목으로 갈라지지 않고, 다시 보낼 때도 내용이 같다.
  const bulkLocked = () => !!RS.bulk && bulkSharedLocked(bulkStudents(), RS.bulk.rows);
  function confirmDropBulk(action) {
    const n = bulkUnsaved();
    return !n || confirm(`저장하지 않은 학생 기록이 ${n}명 있습니다. ${action} 적은 내용이 사라집니다. 계속할까요?`);
  }
  function newBulk() {
    const keys = classGroups(RS.students).map(g => g.key);
    const selected = RS.students.find(s => s.id === RS.studentId);
    const classKey = [RS.classFilter, selected ? classKeyOf(selected) : ''].find(key => key && keys.includes(key)) || '';
    return { owner: state.me.id, schoolId: RS.schoolId, classKey, title: '', date: today(), deckId: '', deckTitle: '', common: '', rows: {}, running: false, summary: null };
  }
  // 이 탭에 작성 내용을 남긴다. 남길 것이 없으면(모두 저장됨·빈 화면) 지운다 — 다 저장한 뒤 새로 고치면 빈 화면으로 돌아온다.
  function persistBulk() {
    const B = RS.bulk;
    if (!B) return;
    const keep = B.running || bulkUnsaved() > 0 || (!bulkLocked() && !!(B.title.trim() || B.common.trim()));
    if (keep) writeBulkDraft(B.owner, B.schoolId, bulkSnapshot(B, RS.bulkOpen));
    else clearBulkDraft(B.owner, B.schoolId);
  }
  function dropBulk() {
    if (RS.bulk) clearBulkDraft(RS.bulk.owner, RS.bulk.schoolId);
    RS.bulk = null; RS.bulkOpen = false;
  }
  window.addEventListener('beforeunload', event => {
    if (!RS.bulk || (!RS.bulk.running && !bulkUnsaved())) return;
    persistBulk();
    event.preventDefault(); event.returnValue = '';
  });
  // 반 전체 기록의 웹앱 칸: 관리자만 보이고 웹앱 목록 전체에서 고른다 (강사·진로업체 담당자는 학생마다 활동한 웹앱만 이을 수 있어 뺀다).
  function bulkDeckOptionsHtml(selected) {
    const list = canListDecks() && RS.deckListFor === state.me.id && RS.deckList ? RS.deckList.slice() : [];
    if (selected && !list.some(d => String(d.id) === String(selected))) list.unshift({ id: Number(selected), title: (RS.bulk && RS.bulk.deckTitle) || `웹앱 ${selected}` });
    return `<option value="">연결 안 함</option>${list.map(d => `<option value="${d.id}"${String(d.id) === String(selected) ? ' selected' : ''}>${esc(d.title)}</option>`).join('')}`;
  }
  // failed: 서버가 거절해 저장되지 않음 · unknown: 연결이 끊겨 저장됐는지 모름(같은 시도 번호로 다시 보내면 한 번만 남는다)
  // conflict: 같은 시도 번호로 다른 내용이 먼저 저장돼 있음(409) — 다시 보내지 않고 학생별 보기에서 확인한다.
  const BULK_STATUS = {
    queued: ['gray', '저장 대기'], saving: ['amber', '저장 중'], saved: ['green', '저장됨'], duplicate: ['green', '이미 저장됨'],
    failed: ['red', '저장 안 됨'], unknown: ['amber', '저장 확인 필요'], conflict: ['amber', '이미 저장됨 · 내용이 다름'],
  };
  function bulkStatusHtml(row) {
    const status = row && BULK_STATUS[row.status];
    if (!status) return '';
    const note = row.status === 'conflict' ? '<span class="rs-bulk-note">학생별 보기에서 확인하세요</span>'
      : bulkRowRetry(row) && row.message ? `<span class="rs-bulk-error">${esc(row.message)}</span>` : '';
    return `<span class="badge ${status[0]}">${status[1]}</span>${note}`;
  }
  function bulkCountText() {
    const list = bulkStudents(), rows = RS.bulk.rows;
    const count = status => list.filter(s => rows[s.id] && rows[s.id].status === status).length;
    const done = list.filter(s => bulkRowDone(rows[s.id])).length;
    const skipped = list.filter(s => !bulkRowSettled(rows[s.id]) && bulkExcluded(s, rows[s.id])).length;
    const conflict = count('conflict'), failed = count('failed'), unknown = count('unknown');
    return `반 ${list.length}명 · 저장할 학생 ${bulkUnsaved()}명 · 저장됨 ${done}명${conflict ? ` · 내용이 다름 ${conflict}명` : ''}${skipped ? ` · 결석·제외 ${skipped}명` : ''}${failed ? ` · 저장 안 됨 ${failed}명` : ''}${unknown ? ` · 저장 확인 필요 ${unknown}명` : ''}`;
  }
  function bulkRowHtml(s) {
    const B = RS.bulk, row = B.rows[s.id] || {}, settled = bulkRowSettled(row), id = esc(s.id);
    const skipped = !settled && bulkExcluded(s, row);
    const lock = settled || B.running || skipped;
    const who = s.studentNumber ? `${s.studentNumber}번` : (s.class_name || '');
    // 결석·제외: 이 학생 칸은 채우기·저장에서 빠진다. 비활성 계정은 처음부터 체크돼 있다.
    const skip = settled ? '' : `<label class="rs-bulk-skip"><input type="checkbox" data-bulk-skip="${id}"${skipped ? ' checked' : ''}${B.running ? ' disabled' : ''}> 결석·제외<span class="rs-sr"> · ${esc(s.display_name)}</span></label>`;
    return `<li class="rs-bulk-row${settled ? ' is-done' : ''}${skipped ? ' is-skipped' : ''}${bulkRowRetry(row) ? ' is-failed' : ''}" id="rs-bulk-row-${id}">
      <div class="rs-bulk-who"><span class="rs-bulk-no">${esc(who)}</span><b>${esc(s.display_name)}</b>${s.active === false ? '<span class="badge gray">비활성 계정</span>' : ''}${skip}<span class="rs-bulk-status">${bulkStatusHtml(row)}</span></div>
      <div class="rs-bulk-fields">${OBS_LABELS.map(([key, , label, , max, required]) => `<div>
        <label class="field-label" for="rs-bulk-${key}-${id}"><span class="rs-sr">${esc(s.display_name)} · </span>${esc(label)}${required ? '' : ' <span class="sub">선택</span>'}</label>
        <textarea id="rs-bulk-${key}-${id}" class="input" data-bulk-row="${id}" data-bulk-key="${key}" maxlength="${max}" rows="3"${lock ? ' readonly' : ''}>${esc(row[key] || '')}</textarea></div>`).join('')}</div>
      ${settled ? `<div class="sa-actions"><button type="button" class="btn btn-ghost btn-sm" data-bulk-view="${id}">${esc(s.display_name)} 기록 보기</button></div>` : ''}
    </li>`;
  }
  function bulkCardHtml() {
    const B = RS.bulk, run = B.running, locked = bulkLocked();
    const list = bulkStudents();
    const retry = list.filter(s => bulkRowRetry(B.rows[s.id])).length;
    const off = run ? ' disabled' : '', fixed = locked || run ? ' readonly' : '';
    // 웹앱 칸은 관리자만. 목록을 불러오는 중·실패한 상태를 칸 아래에 보여준다.
    const linkDeck = canListDecks();
    const deckField = linkDeck ? `<div><label for="rs-bulk-deck">연결할 웹앱 <span class="sub">선택</span></label><select id="rs-bulk-deck" aria-describedby="rs-bulk-deck-help rs-bulk-deck-state"${RS.deckLoad ? ' aria-busy="true"' : ''}${locked || run ? ' disabled' : ''}>${bulkDeckOptionsHtml(B.deckId)}</select>${deckStateHtml('rs-bulk-deck', 'bulk')}</div>` : '';
    // 저장을 마친 뒤의 요약. 초점을 옮길 자리이자 읽어 줄 자리라 늘 그려 두고, 막 끝난 직후에는 비워 둔 채 그린 다음 글자를 넣는다.
    const summary = B.summary && !B.announce ? B.summary : null;
    return `<section class="card sa-card rs-bulk" id="rs-bulk" aria-labelledby="rs-bulk-heading">
      <h2 id="rs-bulk-heading">반 전체 기록 <span class="sub">진로 관찰 기록</span></h2>
      <p class="sa-help">수업이 끝난 뒤 한 반 학생 모두의 관찰을 한 화면에서 남깁니다. '수업에서 한 활동과 학생의 모습'을 적은 학생만 저장되고, 모든 칸이 빈 학생은 건너뜁니다. 적은 내용은 학생별 보기로 다녀오거나 이 탭을 새로 고쳐도 남아 있습니다(탭을 닫으면 지워집니다).</p>
      <div class="sa-actions"><button type="button" id="rs-bulk-single" class="btn btn-ghost btn-sm"${off}>학생별 보기로</button><button type="button" id="rs-bulk-close" class="btn btn-ghost btn-sm"${off}>반 전체 기록 닫기</button></div>
      <div class="form-grid rs-bulk-common-fields">
        <div><label for="rs-bulk-class">기록할 반</label><select id="rs-bulk-class"${off}><option value="">반을 고르세요</option>${classGroups(RS.students).map(g => `<option value="${esc(g.key)}"${g.key === B.classKey ? ' selected' : ''}>${esc(g.label)} (${g.count}명)</option>`).join('')}</select></div>
        <div><label for="rs-bulk-date">활동 날짜</label><input id="rs-bulk-date" type="date" value="${esc(B.date)}"${fixed}></div>
        ${deckField}
      </div>
      ${linkDeck ? '<p class="sa-help" id="rs-bulk-deck-help">웹앱을 고르면 반 학생 모두의 관찰이 그 웹앱 활동에 이어집니다.</p>' : ''}
      <label class="field-label" for="rs-bulk-title" style="display:block;margin-top:12px">제목 <span class="sub">반 학생 모두의 기록에 같은 제목이 붙습니다</span></label>
      <input id="rs-bulk-title" class="input" maxlength="120" required value="${esc(B.title)}" placeholder="예: 항공 진로 체험 2회차"${fixed}>
      ${locked ? '<p class="sa-help">이미 저장했거나 저장 확인이 필요한 학생이 있어 제목·날짜·웹앱은 그대로 둡니다. 다시 저장할 때 내용이 같아야 기록이 한 번만 남습니다. 저장한 기록은 학생별 화면에서 정정할 수 있습니다.</p>' : ''}
      ${B.classKey ? `<div class="rs-bulk-common">
        <label class="field-label" for="rs-bulk-common">공통 활동 내용 <span class="sub">선택 · 반 전체가 함께 한 활동</span></label>
        <textarea id="rs-bulk-common" class="input" maxlength="1500" rows="3" placeholder="예: 드론 비행 원리를 배우고 모둠별로 비행 경로를 설계해 발표했습니다."${off}>${esc(B.common)}</textarea>
        <div class="sa-actions"><button type="button" id="rs-bulk-fill" class="btn btn-soft btn-sm"${off}>빈 칸에 채우기</button><button type="button" id="rs-bulk-fill-all" class="btn btn-ghost btn-sm"${off}>적은 칸도 바꾸기</button></div>
        <p class="sa-help">'수업에서 한 활동과 학생의 모습' 칸에 들어갑니다. '빈 칸에 채우기'는 이미 적은 칸을 건드리지 않고, '적은 칸도 바꾸기'는 먼저 확인을 받습니다. 결석·제외로 표시한 학생은 건너뜁니다(비활성 계정은 처음부터 제외). 채운 뒤 학생마다 다르게 보인 모습을 덧붙여 주세요.</p>
      </div>
      <p class="sa-help">사진은 여기서 넣지 않습니다. 저장한 뒤 학생별 화면에서 기록의 '사진 더하기'로 넣어 주세요. 기록 내용은 그대로이고 정정으로 남지 않습니다.</p>
      <p class="rs-bulk-count" id="rs-bulk-count">${bulkCountText()}</p>
      <ol class="rs-bulk-rows">${list.map(bulkRowHtml).join('') || '<li class="sa-help">이 반에 학생이 없습니다.</li>'}</ol>
      <div class="sa-actions"><button type="button" id="rs-bulk-save" class="btn btn-primary"${off}>${run ? '저장하는 중…' : '적은 학생 기록 저장'}</button>${retry && !run ? `<button type="button" id="rs-bulk-retry" class="btn btn-ghost">저장 안 됨·확인 필요 학생만 다시 저장 (${retry}명)</button>` : ''}</div>`
    : '<p class="sa-help">기록할 반을 고르면 그 반 학생 칸이 나옵니다.</p>'}
      <p class="msg rs-bulk-summary${summary && summary.err ? ' err' : ''}" id="rs-bulk-summary" tabindex="-1" role="status" aria-live="polite">${summary ? esc(summary.text) : ''}</p>
      <div class="msg" id="rs-bulk-msg" role="status" aria-live="polite"></div>
    </section>`;
  }
  function paintBulkRow(id) {
    const row = RS.bulk && RS.bulk.rows[id];
    const item = document.getElementById(`rs-bulk-row-${id}`);
    if (!row || !item) return;
    const status = item.querySelector('.rs-bulk-status');
    if (status) status.innerHTML = bulkStatusHtml(row);
    item.classList.toggle('is-done', bulkRowSettled(row));
    item.classList.toggle('is-failed', bulkRowRetry(row));
    const count = document.getElementById('rs-bulk-count');
    if (count) count.textContent = bulkCountText();
  }
  // 저장을 마친 뒤: 요약 줄로 초점을 옮기고, 그 줄(화면에 먼저 그려 둔 live region)에 글자를 넣어 읽히게 한다.
  function announceBulkSummary(B) {
    const target = document.getElementById('rs-bulk-summary');
    if (target) target.focus();
    setTimeout(() => {
      B.announce = false;
      const el = document.getElementById('rs-bulk-summary');
      if (!el || RS.bulk !== B || !B.summary) return;
      el.textContent = B.summary.text;
      el.className = `msg rs-bulk-summary${B.summary.err ? ' err' : ''}`;
    }, 80);
  }
  // 한 명씩 차례로 저장한다. 한 명이 실패해도 나머지는 계속하고, 실패한 학생은 같은 시도 번호로 다시 보낸다.
  // 로그인이 끝났거나(401) 이용 시간이 아니거나 동의가 필요하면(403) 다음 학생도 같은 이유로 막히므로 거기서 멈추고 이유를 알린다.
  async function runBulk(onlyFailed) {
    const B = RS.bulk;
    if (!B || B.running) return;
    if (!B.title.trim()) {
      setMsg('rs-bulk-msg', '제목을 적어 주세요. 반 학생 모두의 기록에 같은 제목이 붙습니다.', true);
      const title = document.getElementById('rs-bulk-title');
      if (title) title.focus();
      return;
    }
    const { send, invalid } = bulkPlan(bulkStudents(), B.rows, { onlyFailed });
    if (invalid.length) {
      for (const s of invalid) { const el = document.getElementById(`rs-bulk-activity-${s.id}`); if (el) el.setAttribute('aria-invalid', 'true'); }
      const names = invalid.slice(0, 3).map(s => s.display_name).join(', ') + (invalid.length > 3 ? ` 외 ${invalid.length - 3}명` : '');
      setMsg('rs-bulk-msg', `${names} 학생은 '수업에서 한 활동과 학생의 모습'을 적어야 저장됩니다. 그 칸을 채우거나 다른 칸을 비워 주세요.`, true);
      const first = document.getElementById(`rs-bulk-activity-${invalid[0].id}`);
      if (first) first.focus();
      return;
    }
    if (!send.length) {
      setMsg('rs-bulk-msg', onlyFailed ? '다시 저장할 학생이 없습니다.' : '저장할 기록이 없습니다. 학생 칸에 활동과 모습을 적어 주세요.', true);
      return;
    }
    // 저장한 기록은 지울 수 없다(정정만 된다). 누구 기록이 남는지 이름으로 확인받는다. 실패한 학생만 다시 보낼 때는 이미 확인했다.
    if (!onlyFailed) {
      const skipped = bulkStudents().filter(s => !bulkRowSettled(B.rows[s.id]) && bulkExcluded(s, B.rows[s.id])).length;
      if (!confirm(bulkSaveConfirm(send, skipped))) return;
    }
    const school = RS.schoolId, linkDeck = canListDecks();
    B.running = true; B.summary = null; B.announce = false;
    for (const s of send) {
      const row = B.rows[s.id];
      row.status = 'queued'; row.message = '';
      if (!row.attempt) row.attempt = newAttemptId();
    }
    persistBulk();
    renderRecords();
    let index = 0, halt = null;
    for (const s of send) {
      const row = B.rows[s.id];
      row.status = 'saving'; index += 1;
      persistBulk(); paintBulkRow(s.id);
      setMsg('rs-bulk-msg', `${send.length}명 가운데 ${index}번째 저장 중… 창을 닫지 마세요.`);
      const accessBefore = state.access;
      try {
        const result = await api('POST', `/api/school-accounts/schools/${school}/students/${s.id}/records`, bulkPayload(B, row, { linkDeck }));
        row.status = result.duplicate ? 'duplicate' : 'saved';
        row.recordId = result.id || '';
      } catch (err) {
        const failure = saveFailure(err, accessBefore);
        // 멈춤: 이 학생은 저장되지 않았고 보내지 않은 것과 같다 — 다음에 '적은 학생 기록 저장'으로 함께 보낸다.
        if (failure.kind === 'stop') { row.status = ''; row.message = ''; halt = failure; }
        else { row.status = bulkRowStatusFor(failure); row.message = failure.kind === 'conflict' ? '' : failure.message; }
      }
      persistBulk(); paintBulkRow(s.id);
      if (halt) break;
    }
    // 멈췄으면 아직 보내지 않은 학생을 '저장 대기'에서 빈 상태로 돌린다. 시도 번호는 그대로라 다시 보내도 한 번만 남는다.
    for (const s of send) if (B.rows[s.id].status === 'queued') B.rows[s.id].status = '';
    B.running = false;
    B.summary = bulkRunSummary(send.map(s => B.rows[s.id]), halt);
    persistBulk();
    toast(B.summary.short, B.summary.err);
    // 로그인·동의 화면으로 넘어갔거나 이용 시간 안내가 화면을 덮었으면 그 화면을 다시 덮지 않는다. 요약은 돌아왔을 때 보인다.
    if (halt || location.hash !== RP || RS.bulk !== B) return;
    B.announce = true;
    renderRecords();
    announceBulkSummary(B);
  }

  // 기록 추가·정정·사진 더하기 폼에 적은 내용(또는 고른 사진)이 있는지. 다른 폼이나 반 전체 기록을 열면 그 내용이 사라진다.
  function formDraftDirty() {
    if (RS.newPhotos.length) return true;
    return [...document.querySelectorAll('#rs-add-form, [data-sa-revise], [data-rs-photo-form]')].some(form =>
      [...form.querySelectorAll('input, textarea')].some(el => (el.type === 'checkbox' ? el.checked !== el.defaultChecked : el.type !== 'file' && el.value !== el.defaultValue)));
  }
  const confirmDropForm = () => !formDraftDirty() || confirm('쓰던 기록 내용이 있습니다. 다른 화면을 열면 적은 내용이 사라집니다. 계속할까요?');

  function renderRecords() {
    const current = RS.schools.find(s => s.id === RS.schoolId) || null;
    const canEdit = RS.level === 'edit';
    const partner = isPartner();
    const title = partner ? '학생 진로기록' : '학생 기록 열람';
    const bulkView = !!(current && canEdit && RS.bulkOpen && RS.bulk);
    const picking = RS.bulk && RS.bulk.running ? ' disabled' : '';
    const drafted = bulkUnsaved();
    shell(title, `<div class="sa-page">
      <div class="page-head"><div><div class="ph-t">${esc(title)}</div><div class="desc">${partner
        ? `담당 학교 학생의 진로 활동을 기록합니다. ${canEdit ? '수업에서 본 모습과 활동 사진을 남겨 주세요.' : '이 학교는 열람 전용으로 열려 있습니다.'}`
        : `학교 수업(모아허브)과 진로 수업(모아랩) 기록을 한 학생 기준으로 봅니다. ${canEdit ? '이 학교는 정정과 기록 추가가 가능합니다. 원본은 이력으로 남습니다.' : '이 화면은 열람 전용입니다.'}`}</div></div></div>
      <div class="card sa-card"><div class="form-grid">
        <div><label for="rs-school">학교</label><select id="rs-school"${picking}><option value="">학교를 선택하세요</option>${RS.schools.map(s => `<option value="${s.id}"${s.id === RS.schoolId ? ' selected' : ''}>${esc(s.name)} · ${s.level === 'edit' ? '열람+수정' : '열람'}</option>`).join('')}</select></div>
        ${current ? `${bulkView ? '' : `<div><label for="rs-class-filter">학생 찾기 · 학년·반</label><select id="rs-class-filter"${picking}>${classFilterOptionsHtml()}</select></div>`}
        <div><label for="rs-student">학생</label><select id="rs-student"${picking}>${studentOptionsHtml()}</select></div>` : ''}
        ${current && canEdit && RS.students.length && !bulkView ? `<div><button type="button" id="rs-bulk-open" class="btn btn-soft">${drafted ? `반 전체 기록 이어 쓰기 (${drafted}명 작성 중)` : '반 전체 기록'}</button></div>` : ''}
      </div>${!RS.schools.length ? `<p class="sa-help">${partner ? '아직 열린 학교가 없습니다. 모아킷 관리자에게 학교 배정을 요청하세요.' : '기록을 볼 수 있는 학교가 없습니다. 관리자에게 기록 권한을 요청하세요.'}</p>` : ''}</div>
      ${bulkView ? bulkCardHtml() : RS.student ? `<div class="card sa-card"><h2>${esc(RS.student.displayName)} <span class="sub">${esc(RS.student.className)} · ${esc(RS.student.username)}</span><span class="spacer"></span>${canEdit ? '<button type="button" id="rs-add" class="btn btn-primary btn-sm">기록 추가</button>' : ''}</h2>
        ${RS.adding ? addFormHtml() : ''}
        <div class="career-records-list" id="rs-list">${RS.records.map(recordCard).join('') || '<div class="career-empty"><h2>아직 기록이 없습니다.</h2></div>'}</div>
        <div class="sa-actions">${RS.hasMore ? '<button type="button" id="rs-more" class="btn btn-ghost">기록 더 보기</button>' : ''}</div>
      </div>` : ''}
    </div>`);
    bindRecords();
  }

  function bindBulk() {
    const B = RS.bulk, $ = id => document.getElementById(id);
    if (!B || !$('rs-bulk')) return;
    const syncCount = () => { const el = $('rs-bulk-count'); if (el) el.textContent = bulkCountText(); };
    // 학생별 보기로: 방금 저장한 기록이 보이도록 목록을 다시 불러온다. 작성 내용은 남는다.
    $('rs-bulk-single').onclick = () => { RS.bulkOpen = false; persistBulk(); navigate(); };
    $('rs-bulk-close').onclick = () => {
      if (!confirmDropBulk('닫으면')) return;
      dropBulk(); navigate();
    };
    const cls = $('rs-bulk-class');
    cls.onchange = () => {
      if (!confirmDropBulk('반을 바꾸면')) { cls.value = B.classKey; return; }
      // 제목·날짜·공통 내용은 같은 수업을 여러 반에서 할 때가 많아 그대로 두고, 학생 칸만 새로 연다.
      B.classKey = cls.value; B.rows = {}; B.summary = null;
      persistBulk();
      renderRecords();
      const again = $('rs-bulk-class');
      if (again) again.focus();
    };
    const date = $('rs-bulk-date');
    date.oninput = date.onchange = () => { B.date = date.value; persistBulk(); };
    const title = $('rs-bulk-title');
    title.oninput = () => { B.title = title.value; persistBulk(); };
    const deck = $('rs-bulk-deck');
    if (deck) {
      loadDeckList();
      deck.onchange = () => {
        B.deckId = deck.value;
        B.deckTitle = deck.value && deck.selectedOptions[0] ? deck.selectedOptions[0].textContent : '';
        if (B.deckId && !B.title.trim()) { B.title = `${B.deckTitle} 관찰`.slice(0, 120); title.value = B.title; }
        persistBulk();
      };
    }
    const common = $('rs-bulk-common');
    if (common) common.oninput = () => { B.common = common.value; persistBulk(); };
    // 공통 내용 채우기. 버튼이 둘이라 고른 대로만 한다: '빈 칸에 채우기'는 적은 칸을 그대로 두고,
    // '적은 칸도 바꾸기'는 확인을 받고 취소하면 아무것도 바꾸지 않는다. 결석·제외와 저장된 학생은 건너뛴다.
    const fillRows = overwrite => {
      const text = B.common.trim();
      if (!text) { setMsg('rs-bulk-msg', '공통 활동 내용을 먼저 적어 주세요.', true); if (common) common.focus(); return; }
      const open = bulkStudents().filter(s => !bulkRowSettled(B.rows[s.id]) && !bulkExcluded(s, B.rows[s.id]));
      const written = open.filter(s => { const value = String((B.rows[s.id] || {}).activity || '').trim(); return value && value !== text; });
      if (overwrite && written.length && !confirm(`활동 모습을 이미 적은 학생 ${written.length}명의 칸을 공통 내용으로 바꿉니다. 그 학생들에게 적어 둔 내용은 사라집니다. 계속할까요?`)) return;
      let count = 0;
      for (const s of open) {
        const row = bulkRow(s.id), currentText = row.activity.trim();
        if (currentText === text || (currentText && !overwrite)) continue;
        row.activity = text; count += 1;
        const field = $(`rs-bulk-activity-${s.id}`);
        if (field) { field.value = text; field.removeAttribute('aria-invalid'); }
      }
      syncCount(); persistBulk();
      const kept = overwrite ? 0 : written.length;
      const keptText = kept ? ` 이미 적은 ${kept}명은 그대로 두었습니다.` : '';
      setMsg('rs-bulk-msg', count ? `${count}명 칸에 공통 활동 내용을 채웠습니다.${keptText} 학생마다 다르게 보인 모습을 덧붙여 주세요.` : `새로 채울 칸이 없습니다.${keptText}`);
    };
    const fill = $('rs-bulk-fill');
    if (fill) fill.onclick = () => fillRows(false);
    const fillAll = $('rs-bulk-fill-all');
    if (fillAll) fillAll.onclick = () => fillRows(true);
    document.querySelectorAll('[data-bulk-skip]').forEach(box => {
      box.onchange = () => {
        const id = box.dataset.bulkSkip;
        bulkRow(id).skip = box.checked;
        persistBulk();
        renderRecords();
        const again = document.querySelector(`[data-bulk-skip="${CSS.escape(id)}"]`);
        if (again) again.focus();
      };
    });
    document.querySelectorAll('[data-bulk-row]').forEach(field => {
      field.oninput = () => {
        bulkRow(field.dataset.bulkRow)[field.dataset.bulkKey] = field.value;
        if (field.dataset.bulkKey === 'activity') field.removeAttribute('aria-invalid');
        syncCount(); persistBulk();
      };
    });
    document.querySelectorAll('[data-bulk-view]').forEach(b => {
      b.onclick = () => { RS.studentId = b.dataset.bulkView; RS.bulkOpen = false; RS.history = {}; persistBulk(); navigate(); };
    });
    const save = $('rs-bulk-save');
    if (save) save.onclick = () => runBulk(false);
    const retry = $('rs-bulk-retry');
    if (retry) retry.onclick = () => runBulk(true);
  }

  function bindRecords() {
    const $ = id => document.getElementById(id);
    const busy = (form, on) => { for (const c of form.querySelectorAll('input,select,textarea,button')) c.disabled = on; };
    const resetDraft = () => { RS.newPhotos = []; };
    const closeAdd = () => { RS.adding = false; RS.addDeck = ''; RS.addPrefill = null; RS.addAttempt = ''; };
    const openAdd = () => { RS.adding = true; RS.editing = null; RS.editAttempt = ''; RS.photoing = null; RS.addAttempt = newAttemptId(); resetDraft(); };
    $('rs-school').onchange = () => {
      const schoolSel = $('rs-school');
      if (!confirmDropBulk('학교를 바꾸면') || !confirmDropForm()) { schoolSel.value = RS.schoolId; return; }
      dropBulk(); RS.classFilter = '';
      RS.schoolId = schoolSel.value; RS.studentId = ''; RS.editing = null; RS.photoing = null; closeAdd(); RS.history = {}; resetDraft(); navigate();
    };
    const studentSel = $('rs-student');
    // 반 전체 기록을 쓰다가 학생을 고르면 학생별 보기로 넘어간다. 작성 내용은 RS.bulk 에 그대로 남는다.
    if (studentSel) studentSel.onchange = () => {
      if (!confirmDropForm()) { studentSel.value = RS.studentId; return; }
      RS.studentId = studentSel.value; RS.bulkOpen = false; persistBulk(); RS.editing = null; RS.photoing = null; closeAdd(); RS.history = {}; resetDraft(); navigate();
    };
    const classFilter = $('rs-class-filter');
    if (classFilter && studentSel) classFilter.onchange = () => { RS.classFilter = classFilter.value; studentSel.innerHTML = studentOptionsHtml(); };
    const bulkOpen = $('rs-bulk-open');
    if (bulkOpen) bulkOpen.onclick = () => {
      if (!confirmDropForm()) return;
      if (!RS.bulk) RS.bulk = newBulk();
      RS.bulkOpen = true; RS.editing = null; RS.editAttempt = ''; RS.photoing = null; closeAdd(); resetDraft();
      persistBulk();
      renderRecords();
      const first = $(RS.bulk.classKey ? 'rs-bulk-title' : 'rs-bulk-class');
      if (first) first.focus();
    };
    bindBulk();
    const add = $('rs-add');
    if (add) add.onclick = () => { if (!confirmDropForm()) return; openAdd(); RS.addDeck = ''; RS.addPrefill = null; renderRecords(); };
    const addCancel = $('rs-add-cancel');
    if (addCancel) addCancel.onclick = () => { closeAdd(); resetDraft(); renderRecords(); };
    // 종류를 바꿔도 같은 기록을 쓰는 중이므로 시도 번호는 그대로 둔다. 웹앱 연결·미리 채운 제목은 관찰 기록에만 맞으니 비운다.
    const kindSel = $('rs-add-kind');
    if (kindSel) kindSel.onchange = () => { RS.addKind = kindSel.value; RS.addDeck = ''; RS.addPrefill = null; resetDraft(); renderRecords(); };
    if ($('rs-add-deck')) loadDeckList();
    // 웹앱 목록 다시 불러오기: 누른 단추가 숨으므로 초점을 그 선택 칸으로 옮긴다.
    document.querySelectorAll('[data-rs-deck-retry]').forEach(b => {
      b.onclick = () => {
        const box = b.closest('[data-rs-deck-state]');
        loadDeckList(true);
        const select = box && $(box.dataset.rsDeckState);
        if (select && !select.disabled) select.focus();
      };
    });
    document.querySelectorAll('[data-rs-picker]').forEach(bindPhotoPicker);
    // 학생이 웹앱에서 남긴 기록에서 바로 관찰 기록을 연다: 그 웹앱·날짜·제목을 미리 채운다.
    document.querySelectorAll('[data-rs-observe]').forEach(b => {
      b.onclick = () => {
        const r = RS.records.find(x => x.id === b.dataset.rsObserve);
        if (!r || !confirmDropForm()) return;
        openAdd();
        RS.addKind = 'career_observation';
        RS.addDeck = String(Number(r.deck_id));
        RS.addPrefill = { title: `${r.deck_title || r.title || '웹앱 활동'} 관찰`.slice(0, 120), date: dateInput(r.occurred_at) };
        renderRecords();
        const form = $('rs-add-form');
        if (!form) return;
        const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        form.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        const first = form.querySelector('textarea[name="activity"]');
        if (first) first.focus({ preventScroll: true });
      };
    });

    const addForm = $('rs-add-form');
    if (addForm) addForm.onsubmit = async e => {
      e.preventDefault(); const f = new FormData(addForm); busy(addForm, true);
      const observation = RS.addKind === 'career_observation';
      if (!RS.addAttempt) RS.addAttempt = newAttemptId();
      const payload = { kind: RS.addKind, title: f.get('title'), occurred_at: f.get('occurred_at') || undefined, attempt_id: RS.addAttempt };
      if (observation) {
        for (const [key] of OBS_LABELS) payload[key] = f.get(key) || '';
        payload.photos = photoValue();
        const deckId = Number(f.get('deck_id') || 0);
        if (deckId > 0) payload.deck_id = deckId;
      } else {
        payload.process = f.get('process'); payload.artifact = f.get('artifact'); payload.reflection = f.get('reflection');
      }
      const accessBefore = state.access;
      try {
        const result = await api('POST', `/api/school-accounts/schools/${RS.schoolId}/students/${RS.studentId}/records`, payload);
        closeAdd(); resetDraft();
        toast(result.duplicate ? '앞서 보낸 저장이 이미 반영돼 있었습니다. 기록은 하나만 남았습니다.' : '기록을 저장했습니다.');
        navigate();
      } catch (err) { setMsg('rs-add-msg', saveError(err, accessBefore), true); busy(addForm, false); }
    };
    const more = $('rs-more');
    if (more) more.onclick = async () => {
      more.disabled = true;
      try {
        const data = await api('GET', `/api/school-accounts/schools/${RS.schoolId}/students/${RS.studentId}/records?page=${RS.page + 1}`);
        RS.page += 1; RS.records.push(...data.records); RS.hasMore = data.hasMore; renderRecords();
      } catch (err) { toast(err.message, true); more.disabled = false; }
    };
    document.querySelectorAll('[data-sa-edit-rec]').forEach(b => { b.onclick = () => { if (!confirmDropForm()) return; RS.editing = b.dataset.saEditRec; RS.editAttempt = newAttemptId(); RS.photoing = null; closeAdd(); resetDraft(); renderRecords(); }; });
    // 사진 더하기: 정정 폼과 따로 연다. 저장은 사진 전용 경로라 기록 본문·버전이 바뀌지 않는다.
    document.querySelectorAll('[data-rs-photo-open]').forEach(b => {
      b.onclick = () => {
        if (!confirmDropForm()) return;
        RS.photoing = b.dataset.rsPhotoOpen; RS.editing = null; RS.editAttempt = ''; closeAdd(); resetDraft(); renderRecords();
        // 누른 버튼이 폼으로 바뀌어 사라지므로 초점을 폼 머리로 옮긴다.
        const form = document.querySelector(`[data-rs-photo-form="${CSS.escape(RS.photoing)}"]`);
        const head = form && form.querySelector('[data-rs-photo-head]');
        if (head) head.focus();
      };
    });
    document.querySelectorAll('[data-rs-photo-cancel]').forEach(b => { b.onclick = () => { RS.photoing = null; resetDraft(); renderRecords(); }; });
    document.querySelectorAll('[data-rs-photo-form]').forEach(form => {
      form.onsubmit = async e => {
        e.preventDefault();
        const id = form.dataset.rsPhotoForm, note = form.querySelector('[data-rs-photo-save-msg]');
        const say = (text, err) => { if (note) { note.textContent = text; note.className = `msg ${err ? 'err' : 'ok'}`; } };
        if (!RS.newPhotos.length) { say('넣을 사진을 먼저 골라 주세요.', true); return; }
        busy(form, true); say('사진을 올리는 중…');
        const accessBefore = state.access;
        try {
          // 같은 사진을 다시 보내면 서버가 건너뛴다 — 응답만 잃은 재시도로 사진이 두 번 붙지 않는다.
          const result = await api('POST', `/api/school-accounts/schools/${RS.schoolId}/students/${RS.studentId}/records/${id}/photos`, { photos: photoValue() });
          RS.photoing = null; resetDraft();
          toast(result.duplicate ? '고른 사진은 이미 이 기록에 들어가 있습니다.' : `사진 ${result.photos}장을 더했습니다.`);
          navigate();
        } catch (err) { say(saveError(err, accessBefore), true); busy(form, false); }
      };
    });
    document.querySelectorAll('[data-sa-cancel]').forEach(b => { b.onclick = () => { RS.editing = null; RS.editAttempt = ''; resetDraft(); renderRecords(); }; });
    document.querySelectorAll('[data-sa-history]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.saHistory;
        if (RS.history[id]) { delete RS.history[id]; renderRecords(); return; }
        b.disabled = true;
        try { RS.history[id] = (await api('GET', `/api/school-accounts/schools/${RS.schoolId}/students/${RS.studentId}/records/${id}/history`)).history; renderRecords(); }
        catch (err) { toast(err.message, true); b.disabled = false; }
      };
    });
    document.querySelectorAll('[data-sa-revise]').forEach(form => {
      form.onsubmit = async e => {
        e.preventDefault(); const id = form.dataset.saRevise; const f = new FormData(form); busy(form, true);
        const record = RS.records.find(r => r.id === id);
        const observation = !!record && isObservation(record);
        if (!RS.editAttempt) RS.editAttempt = newAttemptId();
        const payload = { title: f.get('title'), occurred_at: f.get('occurred_at') || undefined, attempt_id: RS.editAttempt };
        if (observation) {
          for (const [key] of OBS_LABELS) payload[key] = f.get(key) || '';
          payload.photos = photoValue();
          payload.keep_photo_ids = [...form.querySelectorAll('[data-rs-keep]')].filter(box => box.checked).map(box => box.dataset.rsKeep);
        } else {
          payload.process = f.get('process'); payload.artifact = f.get('artifact'); payload.reflection = f.get('reflection');
        }
        const accessBefore = state.access;
        try {
          const result = await api('POST', `/api/school-accounts/schools/${RS.schoolId}/students/${RS.studentId}/records/${id}/revise`, payload);
          RS.editing = null; RS.editAttempt = ''; RS.history = {}; resetDraft();
          toast(result.duplicate ? '앞서 보낸 정정이 이미 반영돼 있었습니다.' : '정정 내용을 새 버전으로 저장했습니다.');
          navigate();
        } catch (err) { const m = form.querySelector('[data-sa-msg]'); if (m) { m.textContent = saveError(err, accessBefore); m.className = 'msg err'; } busy(form, false); }
      };
    });
  }
}

// ================= 반 전체 기록 규칙 =================
// 화면(위의 학생 기록 열람·수정)과 test/student-records-bulk*.test.js 가 함께 쓴다. DOM 을 건드리지 않는다.
const BULK_FIELDS = ['activity', 'strengths', 'next_step'];
// 학년·반 묶음. 소속이 'N학년 N반 N번' 형식이 아니어서 학년·반을 알 수 없는 학생은 '기타'로 모은다.
export function classKeyOf(student) {
  return student && student.grade && student.classNumber ? `${student.grade}-${student.classNumber}` : 'other';
}
export function classGroups(students) {
  const counts = new Map();
  for (const s of students || []) { const key = classKeyOf(s); counts.set(key, (counts.get(key) || 0) + 1); }
  const order = key => (key === 'other' ? [999, 999] : key.split('-').map(Number));
  return [...counts].map(([key, count]) => {
    const [grade, classNumber] = order(key);
    return { key, count, label: key === 'other' ? '기타' : `${grade}학년 ${classNumber}반` };
  }).sort((a, b) => { const x = order(a.key), y = order(b.key); return x[0] - y[0] || x[1] - y[1]; });
}
export const bulkRowFilled = row => !!row && BULK_FIELDS.some(key => String(row[key] || '').trim() !== '');
export const bulkRowDone = row => !!row && (row.status === 'saved' || row.status === 'duplicate');
// 서버에 이 줄의 시도 번호로 남은 기록이 있다 — 저장됐거나(saved·duplicate) 다른 내용으로 먼저 저장됐다(conflict).
// 어느 쪽이든 다시 보내지 않고, 칸은 읽기 전용이며, '기록 보기'로 학생별 화면에서 확인한다.
export const bulkRowSettled = row => bulkRowDone(row) || (!!row && row.status === 'conflict');
// '저장 안 됨·확인 필요 학생만 다시 저장' 대상: 서버가 거절했거나(failed) 결과를 모르는(unknown) 줄.
export const bulkRowRetry = row => !!row && (row.status === 'failed' || row.status === 'unknown');
// 반 공통 칸(제목·날짜·웹앱)을 고정할지. 서버에 기록이 있는 줄(settled)뿐 아니라 결과를 모르는 줄(unknown)도 센다 —
// 연결이 끊긴 사이 이미 저장됐을 수 있고, 공통 칸을 바꾼 채 같은 시도 번호로 다시 보내면 저장된 학생이 모두 409(내용이 다름)가 된다.
export const bulkSharedLocked = (students, rows) => (students || []).some(s => {
  const row = rows && rows[s.id];
  return bulkRowSettled(row) || (!!row && row.status === 'unknown');
});
// 결석·제외: 줄에서 직접 고른 값이 우선이고, 고르지 않았으면 비활성 계정만 제외한다.
export const bulkExcluded = (student, row) => (row && typeof row.skip === 'boolean' ? row.skip : !!student && student.active === false);
// 저장할 학생과, 활동 칸이 비어 저장할 수 없는 학생. 모든 칸이 빈 학생·이미 서버에 있는 학생·결석·제외 학생은 건너뛴다.
export function bulkPlan(students, rows, { onlyFailed = false } = {}) {
  const send = [], invalid = [];
  for (const s of students || []) {
    const row = rows && rows[s.id];
    if (!bulkRowFilled(row) || bulkRowSettled(row) || bulkExcluded(s, row)) continue;
    if (onlyFailed && !bulkRowRetry(row)) continue;
    (String(row.activity || '').trim() ? send : invalid).push(s);
  }
  return { send, invalid };
}
// 저장 전 확인 문구: 몇 명의 누구 기록이 남는지. 저장한 기록은 지울 수 없어 이름으로 확인받는다.
export function bulkSaveConfirm(send, skipped = 0) {
  const names = send.map(s => `${s.studentNumber ? `${s.studentNumber}번 ` : ''}${s.display_name}`).join(', ');
  return `${send.length}명의 진로 관찰 기록을 저장합니다.\n${names}${skipped ? `\n\n결석·제외로 표시한 ${skipped}명은 저장하지 않습니다.` : ''}\n\n저장한 기록은 지울 수 없고 정정만 할 수 있습니다. 저장할까요?`;
}
// 학생 한 명 몫의 요청 본문 — 학생별 '기록 추가'와 같은 진로 관찰 기록. 사진은 넣지 않는다.
// 아무 웹앱이나 잇는 것은 관리자만이라(서버 addRecord) linkDeck 일 때만 웹앱을 보낸다. 강사·진로업체 담당자는 학생별 화면에서 잇는다.
export function bulkPayload(common, row, { linkDeck = false } = {}) {
  const payload = {
    kind: 'career_observation', title: common.title, occurred_at: common.date || undefined, attempt_id: row.attempt,
    activity: row.activity || '', strengths: row.strengths || '', next_step: row.next_step || '',
  };
  const deckId = Number(common.deckId || 0);
  if (linkDeck && Number.isSafeInteger(deckId) && deckId > 0) payload.deck_id = deckId;
  return payload;
}

// ---- 저장 실패 가려내기 ----
// public/app.js api() 가 던지는 모양에 맞춘다. 기준은 '저장됐는지 확실히 아는가'다.
//  - 서버가 답한 실패(4xx·5xx)는 응답 본문을 err.data 로 붙여 던진다 → 저장되지 않았다(rejected).
//    같은 시도 번호에 다른 내용이 이미 저장돼 있으면 서버가 code 'attempt_conflict'(409)를 붙인다 → conflict.
//  - 로그인 만료(401)·이용 시간 제한(403 time_blocked)·계약 동의 필요(403 agreement_required)는 data 없이 던지면서
//    state.me 를 비우거나 state.access·state.mustAgree 를 바꾼다 → 저장되지 않았고 다음 요청도 같은 이유로 막힌다(stop).
//  - 그 밖(연결이 끊긴 fetch 의 TypeError 등)은 요청이 서버에 닿았는지 모른다(unknown) → 같은 시도 번호로 다시 보내면 한 번만 남는다.
// after: 실패 직후의 { signedIn, mustAgree, accessChanged }.
export const SAVE_UNKNOWN = '저장 결과를 확인하지 못했습니다. 연결을 확인한 뒤 같은 내용으로 다시 저장하면 기록은 한 번만 남습니다.';
export function classifySaveError(err, after = {}) {
  if (err && err.data && typeof err.data === 'object') {
    if (err.data.code === 'attempt_conflict') return { kind: 'conflict', message: err.message };
    // 5xx(시간 초과 포함)는 서버가 저장을 마친 뒤 실패했을 수도 있다 — 같은 내용으로 다시 보내면 한 번만 남는다
    if (Number(err.status) >= 500) return { kind: 'unknown', message: SAVE_UNKNOWN };
    return { kind: 'rejected', message: err.data.error ? String(err.message) : '서버가 요청을 처리하지 못해 저장하지 않았습니다. 잠시 뒤 같은 내용으로 다시 저장해 주세요.' };
  }
  if (after.signedIn === false) return { kind: 'stop', reason: 'login', message: '로그인이 끝나 저장하지 못했습니다. 다시 로그인한 뒤 저장해 주세요.' };
  if (after.mustAgree) return { kind: 'stop', reason: 'agreement', message: '계약·보안 동의가 필요해 저장하지 못했습니다. 동의를 마친 뒤 다시 저장해 주세요.' };
  if (after.accessChanged) return { kind: 'stop', reason: 'time_blocked', message: '지금은 이용 시간이 아니어서 저장하지 못했습니다. 허용된 시간에 다시 저장해 주세요.' };
  return { kind: 'unknown', message: SAVE_UNKNOWN };
}
// 반 전체 기록 줄 상태. stop 은 줄 상태가 아니라 저장 전체를 멈추는 이유라 여기로 오지 않는다.
export const bulkRowStatusFor = failure => (failure.kind === 'conflict' ? 'conflict' : failure.kind === 'unknown' ? 'unknown' : 'failed');
// 저장을 마친 뒤의 요약. rows: 이번에 보낸 학생 줄, halt: 멈춘 이유(classifySaveError 의 stop).
export function bulkRunSummary(rows, halt = null) {
  const count = test => rows.filter(test).length;
  const done = count(bulkRowDone), conflict = count(row => row.status === 'conflict');
  const failed = count(row => row.status === 'failed'), unknown = count(row => row.status === 'unknown');
  const notSent = halt ? count(row => !row.status) : 0;
  const parts = [`${done}명 저장`];
  if (conflict) parts.push(`${conflict}명 이미 다른 내용으로 저장됨`);
  if (failed) parts.push(`${failed}명 저장 안 됨`);
  if (unknown) parts.push(`${unknown}명 저장 확인 필요`);
  if (notSent) parts.push(`${notSent}명 보내지 않음`);
  const err = !!(halt || conflict || failed || unknown);
  if (!err) return { text: `${done}명 저장했습니다. 사진은 학생별 화면에서 기록의 '사진 더하기'로 넣을 수 있습니다.`, short: `${done}명 저장했습니다.`, err };
  const notes = [];
  if (halt) notes.push(`${halt.message} 적은 내용은 이 탭에 남아 있습니다.`);
  if (conflict) notes.push("'이미 저장됨 · 내용이 다름' 학생은 다시 보내지 않습니다. 학생별 보기에서 저장된 기록을 확인하고 필요하면 정정해 주세요.");
  if (failed || unknown) notes.push("내용을 확인한 뒤 '저장 안 됨·확인 필요 학생만 다시 저장'을 눌러 주세요. 이미 저장된 학생은 두 번 저장되지 않습니다.");
  return { text: `${parts.join(', ')}. ${notes.join(' ')}`, short: halt ? `저장을 멈췄습니다. ${halt.message}` : `${parts.join(', ')}`, err };
}

// ---- 반 전체 기록 작성 내용을 이 탭에 남기기 ----
// 아이패드는 메모리가 모자라면 탭을 다시 읽는다. 그때 반 전체 작성 내용이 사라지지 않도록 sessionStorage 에 둔다.
// 공용 기기라 localStorage 는 쓰지 않는다(탭을 닫으면 지워진다). 계정·학교마다 따로 두고, 다른 계정의 것은 열 때 지운다.
const DRAFT_PREFIX = 'moalab:student-records:bulk:';
export const bulkDraftKey = (owner, schoolId) => `${DRAFT_PREFIX}${owner}:${schoolId}`;
const ROW_STATUSES = ['', 'queued', 'saving', 'saved', 'duplicate', 'failed', 'unknown', 'conflict'];
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function bulkSnapshot(bulk, open = false) {
  const rows = {};
  for (const [id, row] of Object.entries(bulk.rows || {})) {
    if (!row) continue;
    rows[id] = { activity: row.activity || '', strengths: row.strengths || '', next_step: row.next_step || '', attempt: row.attempt || '', status: row.status || '', message: row.message || '', recordId: row.recordId || '' };
    if (typeof row.skip === 'boolean') rows[id].skip = row.skip;
  }
  return { v: 1, owner: String(bulk.owner), schoolId: bulk.schoolId, classKey: bulk.classKey || '', title: bulk.title || '', date: bulk.date || '',
    deckId: String(bulk.deckId || ''), deckTitle: bulk.deckTitle || '', common: bulk.common || '', summary: bulk.summary || null, open: !!open, rows };
}
// 되살리기: 같은 계정·같은 학교의 것만, 모르는 값은 버린다. 저장 중이던 줄은 결과를 모르니 '저장 확인 필요'로,
// 아직 보내지 않은 줄(저장 대기)은 빈 상태로 돌린다. 시도 번호는 그대로라 다시 보내도 한 번만 남는다.
export function bulkRestore(raw, { owner, schoolId }) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!data || typeof data !== 'object' || data.v !== 1 || String(data.owner) !== String(owner) || data.schoolId !== schoolId) return null;
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const rows = {};
  for (const [id, row] of Object.entries(data.rows && typeof data.rows === 'object' ? data.rows : {})) {
    if (!row || typeof row !== 'object') continue;
    let status = ROW_STATUSES.includes(row.status) ? row.status : '';
    if (status === 'queued') status = '';
    if (status === 'saving') status = 'unknown';
    const out = { activity: text(row.activity, 1500), strengths: text(row.strengths, 1500), next_step: text(row.next_step, 1000),
      attempt: ATTEMPT.test(row.attempt || '') ? row.attempt : '', status, message: text(row.message, 300), recordId: text(row.recordId, 64) };
    if (status === 'unknown' && !out.message) out.message = SAVE_UNKNOWN;
    if (typeof row.skip === 'boolean') out.skip = row.skip;
    rows[id] = out;
  }
  const summary = data.summary && typeof data.summary === 'object' && typeof data.summary.text === 'string'
    ? { text: data.summary.text.slice(0, 600), short: text(data.summary.short, 300), err: !!data.summary.err } : null;
  return {
    open: !!data.open,
    bulk: { owner, schoolId, classKey: /^(\d{1,2}-\d{1,2}|other)$/.test(data.classKey || '') ? data.classKey : '', title: text(data.title, 120),
      date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : '', deckId: /^\d{1,15}$/.test(String(data.deckId || '')) ? String(data.deckId) : '',
      deckTitle: text(data.deckTitle, 200), common: text(data.common, 1500), rows, running: false, summary },
  };
}
// sessionStorage 는 사생활 보호 모드·차단된 사이트 데이터에서 없거나 던진다. 모든 읽기·쓰기를 감싸고, 실패하면 남기지 않을 뿐이다.
function draftStore() { try { return window.sessionStorage || null; } catch { return null; } }
function readBulkDraft(owner, schoolId) {
  try { const raw = draftStore()?.getItem(bulkDraftKey(owner, schoolId)); return raw ? bulkRestore(raw, { owner, schoolId }) : null; } catch { return null; }
}
function writeBulkDraft(owner, schoolId, snapshot) {
  try { draftStore()?.setItem(bulkDraftKey(owner, schoolId), JSON.stringify(snapshot)); } catch {}
}
function clearBulkDraft(owner, schoolId) {
  try { draftStore()?.removeItem(bulkDraftKey(owner, schoolId)); } catch {}
}
// 다른 계정이 이 탭에 남긴 작성 내용은 지우고, 내 것이 남은 학교 번호를 돌려준다.
function sweepBulkDrafts(owner) {
  const mine = [];
  try {
    const store = draftStore();
    if (!store) return mine;
    // 지우면 순서가 바뀔 수 있어 열쇠를 먼저 모은다.
    const keys = [];
    for (let i = 0; i < store.length; i += 1) { const key = store.key(i); if (key && key.startsWith(DRAFT_PREFIX)) keys.push(key); }
    for (const key of keys) {
      const rest = key.slice(DRAFT_PREFIX.length), cut = rest.indexOf(':');
      if (cut < 0 || rest.slice(0, cut) !== String(owner)) store.removeItem(key);
      else mine.push(rest.slice(cut + 1));
    }
  } catch {}
  return mine;
}
