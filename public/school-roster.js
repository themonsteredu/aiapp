(function (root, factory) {
  'use strict';
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else root.AccountRoster = helpers;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MAX_ROWS = 100;
  const HEADER_KEYS = { '학년': 'grade', '반': 'classNumber', '번호': 'studentNumber', '이름': 'displayName', '학생이름': 'displayName' };

  function rowError(line, message) {
    return new Error(`${line}행: ${message}`);
  }

  // A delimiter inside a quoted cell is part of the cell, not a column break.
  function delimiterFor(text) {
    let quoted = false;
    let commas = 0;
    let tabs = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted) {
        if (char === '\t') tabs += 1;
        else if (char === ',') commas += 1;
        else if (char === '\r' || char === '\n') {
          if (tabs || commas) break;
        }
      }
    }
    return tabs ? '\t' : ',';
  }

  function readRows(text) {
    const delimiter = delimiterFor(text);
    const rows = [];
    let fields = [];
    let field = '';
    let quoted = false;
    let quoteClosed = false;
    let line = 1;
    let rowLine = 1;

    function finishRow() {
      fields.push(field);
      if (fields.some(value => value.trim() !== '')) rows.push({ fields, line: rowLine });
      fields = [];
      field = '';
      quoteClosed = false;
    }

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            quoted = false;
            quoteClosed = true;
          }
        } else if (char === '\r' || char === '\n') {
          if (char === '\r' && text[i + 1] === '\n') i += 1;
          field += '\n';
          line += 1;
        } else field += char;
      } else if (char === delimiter) {
        fields.push(field);
        field = '';
        quoteClosed = false;
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        finishRow();
        line += 1;
        rowLine = line;
      } else if (char === '"') {
        if (field !== '' || quoteClosed) throw rowError(line, '따옴표 형식이 올바르지 않습니다. CSV 파일을 다시 저장해 주세요.');
        quoted = true;
      } else {
        if (quoteClosed) throw rowError(line, '닫는 따옴표 뒤에는 쉼표 또는 줄바꿈만 올 수 있습니다.');
        field += char;
      }
    }
    if (quoted) throw rowError(rowLine, '닫히지 않은 따옴표가 있습니다. CSV 파일을 다시 저장해 주세요.');
    finishRow();
    return rows;
  }

  function number(value, maximum, label, line) {
    const text = String(value ?? '').trim();
    const result = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(result) || result < 1 || result > maximum) {
      throw rowError(line, `${label}${label.endsWith('번호') ? '는' : '은'} 1~${maximum} 사이의 숫자로 입력해 주세요.`);
    }
    return result;
  }

  function parseRoster(text, options = {}) {
    if (typeof text !== 'string') throw rowError(1, '학생 명단을 텍스트로 입력해 주세요.');
    if (options.mode !== 'class' && options.mode !== 'school') throw rowError(1, '한 반 등록 또는 학교 전체 등록을 선택해 주세요.');
    const rows = readRows(text.replace(/^\uFEFF/, ''));
    const keys = options.mode === 'class'
      ? ['studentNumber', 'displayName']
      : ['grade', 'classNumber', 'studentNumber', 'displayName'];
    let grade;
    let classNumber;
    if (options.mode === 'class') {
      grade = number(options.grade, 6, '선택한 학년', 1);
      classNumber = number(options.classNumber, 99, '선택한 반', 1);
    }
    if (!rows.length) throw rowError(1, '학생 명단이 비어 있습니다.');

    const first = rows[0];
    const header = first.fields.map(value => HEADER_KEYS[value.trim()]);
    const validHeader = header.length === keys.length && new Set(header).size === keys.length && keys.every(key => header.includes(key));
    const columnKeys = validHeader ? header : keys;
    if (validHeader) rows.shift();
    if (!rows.length) throw rowError(first.line, '제목 아래에 학생 명단을 입력해 주세요.');
    if (rows.length > MAX_ROWS) throw rowError(rows[MAX_ROWS].line, `한 번에 최대 ${MAX_ROWS}명까지 등록할 수 있습니다. 명단을 나누어 주세요.`);

    const seen = new Map();
    return rows.map(row => {
      if (row.fields.length !== keys.length) {
        throw rowError(row.line, options.mode === 'class'
          ? '번호와 이름 두 칸을 입력해 주세요. 여러 반 명단은 학교 전체 등록을 사용해 주세요.'
          : '학년, 반, 번호, 이름 네 칸을 입력해 주세요.');
      }
      const values = Object.fromEntries(columnKeys.map((key, index) => [key, row.fields[index].trim()]));
      const student = {
        grade: options.mode === 'class' ? grade : number(values.grade, 6, '학년', row.line),
        classNumber: options.mode === 'class' ? classNumber : number(values.classNumber, 99, '반', row.line),
        studentNumber: number(values.studentNumber, 999, '번호', row.line),
        displayName: values.displayName,
      };
      if (!student.displayName || student.displayName.length > 80 || /[\u0000-\u001F\u007F]/.test(student.displayName)) {
        throw rowError(row.line, '이름은 줄바꿈 없이 1~80자로 입력해 주세요.');
      }
      const key = `${student.grade}:${student.classNumber}:${student.studentNumber}`;
      if (seen.has(key)) throw rowError(row.line, `${student.grade}학년 ${student.classNumber}반 ${student.studentNumber}번이 ${seen.get(key)}행과 중복됩니다.`);
      seen.set(key, row.line);
      return student;
    });
  }

  function csv(headers, rows) {
    function cell(value) {
      let text = String(value ?? '');
      // Quoting alone does not stop Excel from executing a formula.
      if (/^[\s\u0000-\u001F]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    }
    if (!Array.isArray(headers) || !headers.length || !Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== headers.length)) {
      throw new Error('다운로드할 표의 열 수가 맞지 않습니다.');
    }
    return `\uFEFF${[headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')}\r\n`;
  }

  function safeFilePart(name) {
    return String(name ?? '').normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 60).replace(/[. ]+$/g, '') || '학생계정';
  }

  return Object.freeze({ parseRoster, csv, safeFilePart });
}));
