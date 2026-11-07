/* Anonymous write-only intake. Configure the exact private spreadsheet before deploying. */
const INTAKE = Object.freeze({
  spreadsheetId: '__SPREADSHEET_ID__',
  accessKeyHash: '__SUBMIT_KEY_HASH__',
  sheetName: 'Результаты',
  formUrl: 'https://vakurov3334-byte.github.io/back-history-questionnaire/',
  protocol: 'back-history-submission-v1',
  questionnaireId: 'back-history-brief-personal-v2',
  version: 2,
  chunkSize: 25000,
  chunks: 8,
  maxChars: 200000,
  maxDaily: 30,
  maxRows: 300
});
const QUESTIONNAIRE = __BRIEF_SCHEMA__;

function reject_(message) {
  const error = new Error(message);
  error.publicMessage = message;
  throw error;
}

function isRecord_(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function questions_() {
  return QUESTIONNAIRE.sections.reduce(function (all, section) {
    return all.concat(section.questions);
  }, []);
}

function special_(value) {
  return value === '__skip' || value === '__decline';
}

function cleanAnswer_(question, value) {
  if (special_(value)) return value;
  if (question.type === 'text' || question.type === 'textarea') {
    if (typeof value !== 'string' || value.length > 20000) reject_('Один из текстовых ответов слишком длинный или имеет неверный формат.');
    return value.trim() ? value : undefined;
  }
  if (question.type === 'single') {
    if (!question.options.includes(value)) reject_('Один из вариантов ответа не соответствует этой версии анкеты.');
    return value;
  }
  if (question.type === 'multi') {
    if (!Array.isArray(value) || value.length > question.options.length || value.some(function (x) { return !question.options.includes(x); })) reject_('Неверный формат ответа с несколькими вариантами.');
    const unique = Array.from(new Set(value));
    if (unique.length > 1 && unique.some(function (x) { return (question.exclusive || []).includes(x); })) reject_('В одном ответе одновременно указаны несовместимые варианты. Проверь его перед отправкой.');
    return unique.length ? unique : undefined;
  }
  if (question.type === 'scale') {
    if (value === '__unknown') return value;
    if (!Number.isInteger(value) || value < 0 || value > 10) reject_('Оценка боли должна быть от 0 до 10.');
    return value;
  }
  if (question.type === 'tolerance') {
    if (!isRecord_(value) || !['limited', 'unlimited', 'untested', 'unknown'].includes(value.mode)) reject_('Неверный формат ответа о переносимости нагрузки.');
    if (value.mode !== 'limited') return {mode: value.mode};
    if (!['string', 'number'].includes(typeof value.minutes) || String(value.minutes).trim() === '' || !Number.isFinite(Number(value.minutes)) || Number(value.minutes) < 0 || Number(value.minutes) > 1440) reject_('Продолжительность ходьбы или сидения должна быть указана в минутах от 0 до 1440.');
    return {mode: value.mode, minutes: String(value.minutes)};
  }
  if (question.type === 'table') {
    if (!Array.isArray(value) || value.length > (question.maxRows || 8)) reject_('В одном из вопросов слишком много записей.');
    const keys = question.columns.map(function (column) { return column.key; });
    const rows = value.map(function (row) {
      if (!isRecord_(row) || Object.keys(row).some(function (key) { return !keys.includes(key); })) reject_('Неверный формат подробной записи.');
      const result = {};
      question.columns.forEach(function (column) {
        const cell = row[column.key];
        if (cell === undefined || cell === '') return;
        if (typeof cell !== 'string' || cell.length > 10000 || (column.options && !column.options.includes(cell))) reject_('Одна из подробных записей слишком длинная или имеет неверный формат.');
        if (cell.trim()) result[column.key] = cell;
      });
      return result;
    }).filter(function (row) { return Object.keys(row).length; });
    return rows.length ? rows : undefined;
  }
  reject_('Эта версия вопроса не поддерживается приёмником.');
}

function visible_(question, answers, byId, visited) {
  if (!question.when) return true;
  visited = visited || new Set();
  if (visited.has(question.id)) return false;
  visited.add(question.id);
  const rules = Array.isArray(question.when) ? question.when : [question.when];
  return rules.every(function (rule) {
    const parent = byId[rule.id];
    if (!parent || !visible_(parent, answers, byId, new Set(visited))) return false;
    const value = answers[rule.id];
    return rule.in ? rule.in.includes(value) : Array.isArray(value) && rule.has.some(function (choice) { return value.includes(choice); });
  });
}

function validate_(event) {
  if (!event || !event.parameter || event.parameter.website) reject_('Отправка не принята.');
  const raw = event.parameter.submission;
  if (typeof raw !== 'string' || raw.length > INTAKE.maxChars || (event.contentLength && event.contentLength > 1500000)) reject_('Объём ответов слишком большой для отправки. Сохрани текстовый файл и передай его владельцу анкеты.');
  let body;
  try { body = JSON.parse(raw); } catch (error) { reject_('Не удалось прочитать ответы. Вернись к анкете и повтори отправку.'); }
  if (!isRecord_(body) || body.protocol !== INTAKE.protocol || body.questionnaireId !== INTAKE.questionnaireId || body.version !== INTAKE.version) reject_('Эта версия анкеты не поддерживается. Сохрани черновик и свяжись с владельцем анкеты.');
  if (typeof body.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId)) reject_('Неверный номер отправки. Вернись к анкете и повтори попытку.');
  if (typeof body.sendKey !== 'string' || !/^[A-Za-z0-9_-]{32,80}$/.test(body.sendKey) || digest_(body.sendKey) !== INTAKE.accessKeyHash) reject_('Для автоматической отправки нужна полная ссылка приглашения. Открой ссылку, которую тебе прислали, или свяжись с владельцем анкеты.');
  if (!isRecord_(body.answers)) reject_('Нет списка ответов.');
  const questions = questions_();
  const byId = {};
  questions.forEach(function (question) { byId[question.id] = question; });
  if (Object.keys(body.answers).some(function (id) { return !Object.prototype.hasOwnProperty.call(byId, id); })) reject_('В отправке есть неизвестные вопросы. Сохрани черновик и обнови анкету.');
  const cleaned = {};
  questions.forEach(function (question) {
    if (!Object.prototype.hasOwnProperty.call(body.answers, question.id)) return;
    const value = cleanAnswer_(question, body.answers[question.id]);
    if (value !== undefined) cleaned[question.id] = value;
  });
  const answers = {};
  let activeQuestionCount = 0;
  questions.forEach(function (question) {
    if (!visible_(question, cleaned, byId)) return;
    activeQuestionCount++;
    if (Object.prototype.hasOwnProperty.call(cleaned, question.id)) answers[question.id] = cleaned[question.id];
  });
  const answeredCount = Object.keys(answers).filter(function (id) { return !special_(answers[id]); }).length;
  if (!answeredCount) reject_('В отправке нет заполненных ответов. Вернись к анкете и добавь ответы.');
  const labels = {}, context = {};
  QUESTIONNAIRE.sections.forEach(function (section) {
    section.questions.forEach(function (question) {
      if (!Object.prototype.hasOwnProperty.call(answers, question.id)) return;
      labels[question.id] = question.label;
      context[question.id] = {sectionId: section.id, sectionTitle: section.title, type: question.type, help: question.help || ''};
      if (question.columns) context[question.id].columns = question.columns.map(function (column) { return {key: column.key, label: column.label}; });
    });
  });
  return {
    protocol: INTAKE.protocol,
    submissionId: body.submissionId.toLowerCase(),
    questionnaireId: INTAKE.questionnaireId,
    version: INTAKE.version,
    clientSubmittedAt: typeof body.clientSubmittedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.clientSubmittedAt) ? body.clientSubmittedAt : null,
    answers: answers,
    questionLabels: labels,
    questionContext: context,
    answeredCount: answeredCount,
    activeQuestionCount: activeQuestionCount
  };
}

function answerText_(question, value) {
  if (value === '__skip') return 'Пропущено';
  if (value === '__decline') return 'Предпочитаю не отвечать';
  if (question.type === 'multi') return value.join('; ');
  if (question.type === 'scale') return value === '__unknown' ? 'Не могу оценить' : value + ' / 10';
  if (question.type === 'tolerance') return value.mode === 'limited' ? 'Примерно ' + value.minutes + ' мин подряд' : {unlimited:'Боль не ограничивает', untested:'Не пробовала / не было возможности оценить', unknown:'Не могу оценить'}[value.mode];
  if (question.type === 'table') return value.map(function (row, index) {
    return (index + 1) + '. ' + question.columns.filter(function (column) { return row[column.key] !== undefined; }).map(function (column) { return column.label + ': ' + row[column.key]; }).join('\n   ');
  }).join('\n\n');
  return String(value);
}

function summary_(payload, receivedAt) {
  const lines = ['АНКЕТА: БОЛЬ В ПОЯСНИЦЕ И НАГРУЗКА', 'Получено: ' + Utilities.formatDate(receivedAt, 'Asia/Yekaterinburg', 'dd.MM.yyyy HH:mm:ss') + ' (Екатеринбург)', 'Номер отправки: ' + payload.submissionId, 'Версия вопросов: ' + payload.version, 'Ответов: ' + payload.answeredCount + '; активных вопросов: ' + payload.activeQuestionCount, ''];
  QUESTIONNAIRE.sections.forEach(function (section) {
    const included = section.questions.filter(function (question) { return Object.prototype.hasOwnProperty.call(payload.answers, question.id); });
    if (!included.length) return;
    lines.push(section.title.toUpperCase(), '');
    included.forEach(function (question) { lines.push(question.label, answerText_(question, payload.answers[question.id]), ''); });
  });
  return lines.join('\n');
}

function digest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function (byte) { return ((byte + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function chunks_(text) {
  if (text.length > INTAKE.chunkSize * INTAKE.chunks) reject_('Объём ответов превышает допустимый. Сохрани текстовый файл и передай его владельцу анкеты.');
  const values = [];
  for (let i = 0; i < INTAKE.chunks; i++) values.push(text.slice(i * INTAKE.chunkSize, (i + 1) * INTAKE.chunkSize));
  return values;
}

function sheetText_(value) {
  // Sheets strips this leading apostrophe as a text escape; verify the readback below.
  return typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
}

function storeSubmission_(payload) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(INTAKE.spreadsheetId)) reject_('Приёмник ещё не подключён. Сохрани черновик и свяжись с владельцем анкеты.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) reject_('Приёмник занят. Повтори отправку через минуту.');
  try {
    const sheet = SpreadsheetApp.openById(INTAKE.spreadsheetId).getSheetByName(INTAKE.sheetName);
    if (!sheet || sheet.getRange(1, 2).getValue() !== 'Номер отправки' || sheet.getRange(1, 22).getValue() !== 'SHA-256') reject_('Хранилище требует настройки. Сохрани черновик и свяжись с владельцем анкеты.');
    const fingerprint = digest_(JSON.stringify({questionnaireId:payload.questionnaireId, version:payload.version, answers:payload.answers}));
    const lastRow = sheet.getLastRow();
    let rowNumber = lastRow + 1;
    if (lastRow > 1) {
      const existing = sheet.getRange(2, 2, Math.min(lastRow - 1, INTAKE.maxRows), 1).createTextFinder(payload.submissionId).matchEntireCell(true).findNext();
      if (existing) {
        const row = sheet.getRange(existing.getRow(), 1, 1, 22).getValues()[0];
        if (row[21] !== fingerprint) reject_('Этот номер уже связан с другим набором ответов. Вернись к анкете и начни новую отправку.');
        const saved = row.slice(13, 21).join('');
        let parsed;
        try { parsed = JSON.parse(saved); } catch (error) { parsed = null; }
        if (parsed && parsed.submissionId === payload.submissionId && Number.isFinite(new Date(parsed.receivedAt).getTime()) && row.slice(5,13).join('') === summary_(parsed, new Date(parsed.receivedAt)) && digest_(JSON.stringify({questionnaireId:parsed.questionnaireId,version:parsed.version,answers:parsed.answers})) === fingerprint) {
          return {submissionId:payload.submissionId,receivedAt:new Date(parsed.receivedAt),answeredCount:parsed.answeredCount,duplicate:true};
        }
        reject_('Предыдущая запись требует проверки владельцем анкеты. Сохрани файл ответов и сообщи ему номер отправки.');
      }
    }
    if (lastRow >= INTAKE.maxRows + 1) reject_('Приём новых ответов временно приостановлен. Сохрани черновик и свяжись с владельцем анкеты.');
    const now = new Date();
    const day = Utilities.formatDate(now, 'Asia/Yekaterinburg', 'yyyy-MM-dd');
    const properties = PropertiesService.getScriptProperties();
    const oldCounter = properties.getProperty('intake_daily_counter');
    let counter = {day:day,count:0};
    try { const parsed = JSON.parse(oldCounter || 'null'); if (parsed && parsed.day === day) counter = parsed; } catch (error) {}
    if (Number(counter.count) >= INTAKE.maxDaily) reject_('Сегодня приём новых ответов временно приостановлен. Сохрани черновик и свяжись с владельцем анкеты.');
    payload.receivedAt = now.toISOString();
    const json = JSON.stringify(payload);
    const text = summary_(payload, now);
    const jsonParts = chunks_(json), summaryParts = chunks_(text);
    const row = [now,payload.submissionId,payload.version,payload.answeredCount,payload.activeQuestionCount].concat(summaryParts, jsonParts, [fingerprint]);
    if (sheet.getMaxRows() < rowNumber) sheet.insertRowsAfter(sheet.getMaxRows(), rowNumber - sheet.getMaxRows());
    sheet.getRange(rowNumber, 6, 1, 17).setNumberFormat('@');
    sheet.getRange(rowNumber, 1, 1, 22).setValues([row.map(sheetText_)]);
    sheet.getRange(rowNumber, 1).setNumberFormat('dd.MM.yyyy HH:mm:ss');
    SpreadsheetApp.flush();
    const written = sheet.getRange(rowNumber, 1, 1, 22).getValues()[0];
    if (written[1] !== payload.submissionId || written[21] !== fingerprint || written.slice(13,21).join('') !== json || written.slice(5,13).join('') !== text) reject_('Сохранение не удалось подтвердить. Сохрани черновик и повтори отправку с тем же номером.');
    // Once the complete readback succeeded, a counter failure must not turn it into a false failure.
    try { properties.setProperty('intake_daily_counter', JSON.stringify({day:day,count:Number(counter.count || 0)+1})); } catch (error) { console.error('COUNTER_UPDATE_FAILED'); }
    return {submissionId:payload.submissionId,receivedAt:now,answeredCount:payload.answeredCount,duplicate:false};
  } finally {
    lock.releaseLock();
  }
}

function escape_(value) {
  return String(value).replace(/[&<>"']/g, function (character) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]; });
}

function page_(title, content) {
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape_(title) + '</title><style>body{margin:0;background:#f3f6f2;color:#213b32;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;padding:32px 18px}main{max-width:620px;margin:30px auto;padding:28px;background:white;border:1px solid #d8e3d9;border-radius:16px}h1{font-size:26px;line-height:1.25;margin:0 0 18px}p{margin:12px 0}a{color:#24564c}code{display:block;overflow-wrap:anywhere;background:#eff4ef;padding:12px;border-radius:8px;font-size:14px}.muted{color:#5c6f64;font-size:14px}</style></head><body><main>' + content + '</main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title).addMetaTag('viewport','width=device-width, initial-scale=1');
}

function doGet() {
  return page_('Приём ответов', '<h1>Приём ответов анкеты</h1><p>Отправка выполняется кнопкой «Закончить и отправить» в анкете.</p><p><a target="_top" rel="noopener" href="' + INTAKE.formUrl + '">Открыть анкету</a></p><p class="muted">Просмотр сохранённых ответов по этому адресу недоступен.</p>');
}

function doPost(event) {
  try {
    const result = storeSubmission_(validate_(event));
    return page_('Ответы сохранены', '<h1>Ответы сохранены</h1><p>Владелец анкеты может открыть их в своей закрытой таблице. Пересылать файл дополнительно не нужно.</p><p>Получено ответов: ' + result.answeredCount + '.</p><p>Номер отправки:</p><code>' + escape_(result.submissionId) + '</code><p class="muted">' + escape_(Utilities.formatDate(result.receivedAt, 'Asia/Yekaterinburg', 'dd.MM.yyyy HH:mm:ss')) + ' · Екатеринбург</p>' + (result.duplicate ? '<p>Эта отправка уже была сохранена ранее. Повторная запись не создана.</p>' : '') + '<p>Можно закрыть эту вкладку. Исходная анкета осталась открытой.</p>');
  } catch (error) {
    console.error('INTAKE_SUBMISSION_FAILED', error.publicMessage ? 'VALIDATION_OR_STORAGE' : 'UNEXPECTED_ERROR');
    const message = error.publicMessage || 'Приёмник не смог подтвердить сохранение. Вернись во вкладку с анкетой и повтори отправку. При повторной ошибке сохрани ответы в файл и передай владельцу анкеты.';
    return page_('Сохранение не подтверждено', '<h1>Сохранение не подтверждено</h1><p>' + escape_(message) + '</p><p class="muted">Не закрывай исходную анкету, пока не сохранишь ответы или не получишь подтверждение.</p>');
  }
}
