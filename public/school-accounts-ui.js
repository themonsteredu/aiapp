// 학교·기관 학생 계정 발급 화면. 서버 API는 lib/school-registry-api.js.
// 임시 비밀번호는 발급 직후 이 화면 메모리에만 두고, 학교를 바꾸거나 화면이 가려지면 지운다 (모아허브와 같은 규칙).
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
      const instructors = isAdmin() && S.schoolId
        ? (await api('GET', '/api/users')).users.filter(u => u.active && !u.schoolAccount && ['instructor', 'admin', 'superadmin'].includes(u.role))
        : [];
      if (location.hash !== PAGE) return;
      render(instructors);
    } catch (e) { shell('학교 학생 계정', msg(e.message, true)); }
  });

  function render(instructors) {
    const current = school(), admin = isAdmin();
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
}
