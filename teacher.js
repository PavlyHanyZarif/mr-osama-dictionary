/*
=================================================================
  Mr. Osama - Teacher JavaScript (Fixed & Improved)
=================================================================

  *** SQL SETUP - Run this ONCE in Supabase SQL Editor ***

  CREATE TABLE IF NOT EXISTS teacher_auth (
    id serial PRIMARY KEY,
    password_hash text NOT NULL
  );

  CREATE TABLE IF NOT EXISTS student_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text UNIQUE NOT NULL,
    grades integer[] NOT NULL,
    created_at timestamptz DEFAULT now(),
    is_used boolean DEFAULT false,
    device_id text,
    used_at timestamptz,
    is_active boolean DEFAULT true
  );

  CREATE TABLE IF NOT EXISTS vocabulary (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grade integer NOT NULL,
    lesson integer NOT NULL,
    english text NOT NULL,
    arabic text NOT NULL,
    word_type text DEFAULT 'vocab',
    sort_order integer DEFAULT 0,
    emoji text DEFAULT '',
    created_at timestamptz DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS student_progress (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id uuid REFERENCES student_codes(id) ON DELETE CASCADE,
    grade integer NOT NULL,
    lesson integer NOT NULL,
    words_heard integer DEFAULT 0,
    total_words integer DEFAULT 0,
    completed boolean DEFAULT false,
    completed_at timestamptz,
    heard_ids text DEFAULT '[]',
    UNIQUE(code_id, grade, lesson)
  );

  ALTER TABLE teacher_auth ENABLE ROW LEVEL SECURITY;
  ALTER TABLE student_codes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;
  ALTER TABLE student_progress ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "allow_all" ON teacher_auth FOR ALL TO anon USING (true) WITH CHECK (true);
  CREATE POLICY "allow_all" ON student_codes FOR ALL TO anon USING (true) WITH CHECK (true);
  CREATE POLICY "allow_all" ON vocabulary FOR ALL TO anon USING (true) WITH CHECK (true);
  CREATE POLICY "allow_all" ON student_progress FOR ALL TO anon USING (true) WITH CHECK (true);

  INSERT INTO teacher_auth (password_hash)
  VALUES ('03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4')
  ON CONFLICT DO NOTHING;

=================================================================
*/

const SUPABASE_URL = 'https://gmqjlpqsbhrlqxcnkiet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-fAc2QUuPsWFPjS7cunk5g_Fge-oj3c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const GRADES = [
  { id: 1, name: 'أول ابتدائي',  short: '١ ابتدائي', icon: '🌱' },
  { id: 2, name: 'تاني ابتدائي', short: '٢ ابتدائي', icon: '🌿' },
  { id: 3, name: 'تالت ابتدائي', short: '٣ ابتدائي', icon: '🌳' },
  { id: 4, name: 'رابع ابتدائي', short: '٤ ابتدائي', icon: '📗' },
  { id: 5, name: 'خامس ابتدائي', short: '٥ ابتدائي', icon: '📘' },
  { id: 6, name: 'سادس ابتدائي', short: '٦ ابتدائي', icon: '📙' },
  { id: 7, name: 'أول إعدادي',   short: '١ إعدادي',  icon: '🏫' },
  { id: 8, name: 'تاني إعدادي',  short: '٢ إعدادي',  icon: '🏛'  },
  { id: 9, name: 'تالت إعدادي',  short: '٣ إعدادي',  icon: '🎓' },
];

let selectedGrades    = [];
let lastGeneratedCode = null;
let parsedWords       = [];
let editingCodeId     = null;
let editSelectedGrades = [];

// ---- THEME ---- (dark default)
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('mr_theme', isLight ? 'light' : 'dark');
  document.getElementById('themeBtn').textContent = isLight ? '🌙' : '☀️';
}
(function applyTheme() {
  if (localStorage.getItem('mr_theme') === 'light') {
    document.body.classList.add('light');
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = '🌙';
  }
})();

// ---- LOGIN OVERLAY ----
let teacherPin = '';
let showTeacherPin = false;

function buildLoginPad() {
  const pad = document.getElementById('teacherLoginPad');
  if (!pad) return;
  pad.innerHTML = '';
  [1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'pin-key' + (key === '⌫' ? ' delete' : '') + (key === 0 ? ' zero' : '');
    btn.textContent = key;
    btn.onclick = () => handleLoginKey(String(key));
    pad.appendChild(btn);
  });
}

function toggleTeacherShow() {
  showTeacherPin = !showTeacherPin;
  document.getElementById('teacherShowBtn').textContent = showTeacherPin ? '🙈 إخفاء' : '👁 إظهار';
  updateLoginDots(teacherPin);
}

function updateLoginDots(pin) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('td' + i);
    if (!el) continue;
    if (showTeacherPin && i < pin.length) {
      el.classList.add('filled');
      el.textContent = pin[i];
      el.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:1.1em;color:white;';
    } else if (!showTeacherPin && i < pin.length) {
      el.classList.add('filled');
      el.textContent = '';
      el.style.cssText = '';
    } else {
      el.classList.remove('filled');
      el.textContent = '';
      el.style.cssText = '';
    }
  }
}

async function handleLoginKey(key) {
  const errEl = document.getElementById('teacherLoginError');
  errEl.classList.remove('show');
  if (key === '⌫') { teacherPin = teacherPin.slice(0,-1); updateLoginDots(teacherPin); return; }
  if (key === '✓') { if (teacherPin.length === 4) await doTeacherLogin(); return; }
  if (teacherPin.length >= 4) return;
  teacherPin += key;
  updateLoginDots(teacherPin);
  if (teacherPin.length === 4) await doTeacherLogin();
}

async function doTeacherLogin() {
  const errEl = document.getElementById('teacherLoginError');
  showLoading(true);
  try {
    const hash = await sha256(teacherPin);
    const DEFAULT_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
    let authenticated = false;
    try {
      const { data, error } = await sb.from('teacher_auth').select('id').eq('password_hash', hash);
      if (!error && data && data.length > 0) {
        authenticated = true;
      } else if (!error && data && data.length === 0) {
        const { data: allRows } = await sb.from('teacher_auth').select('id').limit(1);
        if (!allRows || allRows.length === 0) {
          if (hash === DEFAULT_HASH) {
            await sb.from('teacher_auth').insert({ password_hash: DEFAULT_HASH });
            authenticated = true;
          }
        }
      }
    } catch(e) {
      if (hash === DEFAULT_HASH) authenticated = true;
    }

    if (authenticated) {
      sessionStorage.setItem('mr_teacher_auth', '1');
      hideLoginOverlay();
      initTeacher();
    } else {
      errEl.textContent = '❌ كلمة السر غلط! الافتراضي: 1234';
      errEl.classList.add('show');
      teacherPin = '';
      updateLoginDots('');
    }
  } catch(e) {
    errEl.textContent = '⚠️ خطأ في الاتصال';
    errEl.classList.add('show');
    teacherPin = '';
    updateLoginDots('');
  } finally {
    showLoading(false);
  }
}

function hideLoginOverlay() {
  const overlay = document.getElementById('teacherLoginOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ---- PREVIEW AS STUDENT ----
function previewAsStudent() {
  // Clear any existing student session first
  ['mr_student_code_id','mr_student_grades','mr_student_code','mr_preview_mode','mr_session_ok'].forEach(k => localStorage.removeItem(k));
  // Set preview session
  localStorage.setItem('mr_preview_mode', '1');
  localStorage.setItem('mr_student_code_id', 'preview_teacher');
  localStorage.setItem('mr_student_grades', JSON.stringify([1,2,3,4,5,6,7,8,9]));
  localStorage.setItem('mr_student_code', '----');
  window.location.href = 'student.html';
}

// ---- INIT ----
function initTeacher() {
  buildGradeCheckGrid('gradeCheckGrid', selectedGrades, g => { selectedGrades = g; });
  populateGradeSelects();
  loadCodes();
  loadProgress();

  window.addEventListener('online', () => {
    document.getElementById('offlineBanner').classList.remove('show');
    loadCodes(); loadProgress();
  });
  window.addEventListener('offline', () => document.getElementById('offlineBanner').classList.add('show'));
  if (!navigator.onLine) document.getElementById('offlineBanner').classList.add('show');
}

window.addEventListener('DOMContentLoaded', () => {
  buildLoginPad();
  if (sessionStorage.getItem('mr_teacher_auth')) {
    hideLoginOverlay();
    initTeacher();
  }
});

// ---- TABS ----
let currentTab = 'generate';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  const tabMap = ['generate','codes','vocab','progress','settings'];
  const idx = tabMap.indexOf(tab);
  const btns = document.querySelectorAll('.tab-btn');
  if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');
  if (tab === 'codes') loadCodes();
  if (tab === 'progress') loadProgress();
}

// ---- GRADE GRID ----
function buildGradeCheckGrid(containerId, selectedArr, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  GRADES.forEach(g => {
    const div = document.createElement('div');
    div.className = 'grade-check-item' + (selectedArr.includes(g.id) ? ' checked' : '');
    div.innerHTML = `<span class="icon">${g.icon}</span><div class="name">${g.short}</div>`;
    div.onclick = () => {
      const idx = selectedArr.indexOf(g.id);
      if (idx >= 0) selectedArr.splice(idx,1); else selectedArr.push(g.id);
      div.classList.toggle('checked', selectedArr.includes(g.id));
      onChange(selectedArr);
    };
    container.appendChild(div);
  });
}

function toggleAllGrades() {
  if (selectedGrades.length === GRADES.length) selectedGrades = [];
  else selectedGrades = GRADES.map(g => g.id);
  buildGradeCheckGrid('gradeCheckGrid', selectedGrades, g => { selectedGrades = g; });
}

// ---- SELECTS ----
function populateGradeSelects() {
  ['vocabGrade','manualGrade','delGrade'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- اختر الصف --</option>';
    GRADES.forEach(g => { sel.innerHTML += `<option value="${g.id}">${g.name}</option>`; });
  });
}

// ---- SHA256 ----
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ---- AUTH ----
function teacherLogout() {
  sessionStorage.removeItem('mr_teacher_auth');
  window.location.href = 'index.html';
}

// ---- GENERATE CODE ----
async function generateCode() {
  if (selectedGrades.length === 0) { alert('⚠️ اختر صف واحد على الأقل!'); return; }
  showLoading(true);
  try {
    let code, exists = true, attempts = 0;
    while (exists && attempts < 20) {
      code = String(Math.floor(1000 + Math.random() * 9000));
      const { data } = await sb.from('student_codes').select('id').eq('code', code);
      exists = data && data.length > 0;
      attempts++;
    }
    if (exists) { alert('حاول تاني - مش لاقي كود متاح'); return; }
    const { error } = await sb.from('student_codes').insert({
      code, grades: selectedGrades.sort((a,b)=>a-b), is_used: false, is_active: true
    });
    if (error) throw error;
    lastGeneratedCode = { code, grades: [...selectedGrades] };
    document.getElementById('displayCode').textContent = code;
    document.getElementById('displayGrades').textContent = selectedGrades.sort((a,b)=>a-b).map(id => GRADES.find(g=>g.id===id)?.short || id).join(' - ');
    document.getElementById('generatedCodeBox').style.display = 'block';
    document.getElementById('generatedCodeBox').scrollIntoView({ behavior:'smooth', block:'center' });
  } catch(e) { alert('❌ خطأ: ' + e.message); }
  finally { showLoading(false); }
}

function shareWhatsApp() {
  if (!lastGeneratedCode) return;
  const gradeNames = lastGeneratedCode.grades.map(id => GRADES.find(g=>g.id===id)?.name || id).join(', ');
  const appLink = window.location.origin + window.location.pathname.replace('teacher.html','index.html');
  const msg = `مرحباً! 👋\n\nكود دخول القاموس الناطق: *${lastGeneratedCode.code}*\n📚 الصفوف: ${gradeNames}\n\nرابط التطبيق:\n${appLink}\n\nمن: Mr. Osama 📖`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

function copyCode() {
  if (!lastGeneratedCode) return;
  navigator.clipboard.writeText(lastGeneratedCode.code)
    .then(() => alert('✅ تم نسخ الكود: ' + lastGeneratedCode.code))
    .catch(() => alert('الكود: ' + lastGeneratedCode.code));
}

// ---- LOAD CODES ----
async function loadCodes() {
  const container = document.getElementById('codesContainer');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner" style="margin:0 auto 14px;width:38px;height:38px;"></div><p>جاري التحميل...</p></div>';
  try {
    const { data, error } = await sb.from('student_codes').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>مفيش أكواد لحد دلوقتي</p></div>';
      return;
    }
    let html = `<div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>الكود</th><th>الصفوف</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th></tr></thead><tbody>`;
    data.forEach(row => {
      const gradeNames  = row.grades.sort((a,b)=>a-b).map(id => GRADES.find(g=>g.id===id)?.short || id);
      const statusBadge = !row.is_active
        ? '<span class="badge badge-danger">محذوف</span>'
        : row.is_used
          ? '<span class="badge badge-warning">مستخدم</span>'
          : '<span class="badge badge-success">متاح</span>';
      const date = new Date(row.created_at).toLocaleDateString('ar-EG');
      const gradesPills = gradeNames.map(n => `<span class="grade-pill">${n}</span>`).join('');
      const transferBtn = row.is_active && row.is_used
        ? `<button class="btn btn-warning btn-sm" onclick="teacherTransferDevice('${row.id}','${row.code}')">📱 نقل</button>`
        : '';
      html += `<tr>
        <td><strong style="font-size:1.15em;color:var(--primary);letter-spacing:3px;">${row.code}</strong></td>
        <td><div class="code-row-grades">${gradesPills}</div></td>
        <td>${statusBadge}</td>
        <td style="white-space:nowrap;font-size:0.8em;">${date}</td>
        <td><div class="actions">
          ${row.is_active ? `
            <button class="btn btn-secondary btn-sm" onclick="openEditModal('${row.id}','${row.code}',${JSON.stringify(row.grades)})">✏️ تعديل</button>
            <button class="btn btn-whatsapp btn-sm" onclick="reshareCode('${row.code}',${JSON.stringify(row.grades)})">💬</button>
            ${transferBtn}
            <button class="btn btn-danger btn-sm" onclick="deleteCode('${row.id}')">🗑️</button>
          ` : '<span style="color:var(--muted);font-size:0.82em;">محذوف</span>'}
        </div></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<div class="alert alert-error">❌ خطأ: ${e.message}</div>`;
  }
}

function reshareCode(code, grades) { lastGeneratedCode = { code, grades }; shareWhatsApp(); }

// ---- TRANSFER DEVICE (from teacher panel) ----
async function teacherTransferDevice(codeId, code) {
  if (!confirm(`📱 نقل الجهاز للكود: ${code}\n\nهتعمل reset للكود ده وتقدر تدخله على جهاز جديد.\nالجهاز القديم هيتقفل.`)) return;
  showLoading(true);
  try {
    const { error } = await sb.from('student_codes')
      .update({ is_used: false, device_id: null, used_at: null })
      .eq('id', codeId);
    if (error) throw error;
    alert(`✅ تم!\n\nالكود: ${code}\n\nيقدر يتفتح دلوقتي على جهاز جديد.`);
    await loadCodes();
  } catch(e) {
    alert('❌ خطأ: ' + e.message);
  } finally {
    showLoading(false);
  }
}

// ---- EDIT MODAL ----
function openEditModal(id, code, grades) {
  editingCodeId = id;
  editSelectedGrades = [...grades];
  document.getElementById('editCodeDisplay').textContent = code;
  buildGradeCheckGrid('editGradeGrid', editSelectedGrades, g => { editSelectedGrades = g; });
  document.getElementById('editModal').classList.remove('hidden');
}
function closeEditModal() {
  editingCodeId = null; editSelectedGrades = [];
  document.getElementById('editModal').classList.add('hidden');
}

async function saveEditCode() {
  if (editSelectedGrades.length === 0) { alert('⚠️ اختر صف واحد على الأقل!'); return; }
  showLoading(true);
  try {
    const { error } = await sb.from('student_codes')
      .update({ grades: editSelectedGrades.sort((a,b)=>a-b) })
      .eq('id', editingCodeId);
    if (error) throw error;
    closeEditModal();
    await loadCodes();
    alert('✅ تم تعديل الكود - التغيير يظهر للطالب فوراً');
  } catch(e) { alert('❌ خطأ: ' + e.message); }
  finally { showLoading(false); }
}

async function deleteCode(id) {
  if (!confirm('⚠️ هتحذف الكود ده؟ الطالب مش هيقدر يدخل التطبيق تاني!')) return;
  showLoading(true);
  try {
    const { error } = await sb.from('student_codes').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    loadCodes();
  } catch(e) { alert('❌ خطأ: ' + e.message); }
  finally { showLoading(false); }
}

// ---- PARSE CODE ----
function parseCode() {
  const code = document.getElementById('pasteCode').value.trim();
  if (!code) { alert('⚠️ الصق الكود الأول!'); return; }
  parsedWords = [];
  try {
    const enArRe = /\{\s*(?:en\s*:\s*["']([^"']+)["'][^}]*?ar\s*:\s*["']([^"']+)["']|ar\s*:\s*["']([^"']+)["'][^}]*?en\s*:\s*["']([^"']+)["'])\s*(?:,\s*emoji\s*:\s*["']([^"']*)["'])?\s*\}/g;
    let m;
    const seenEn = new Set();
    while ((m = enArRe.exec(code)) !== null) {
      const en = (m[1] || m[4] || '').trim();
      const ar = (m[2] || m[3] || '').trim();
      if (en && ar && !seenEn.has(en.toLowerCase())) {
        seenEn.add(en.toLowerCase());
        parsedWords.push({ english: en, arabic: ar, word_type: 'vocab', emoji: m[5] || '' });
      }
    }
    const verbRe = /\{\s*pres\s*:\s*["']([^"']+)["'][^}]*?past\s*:\s*["']([^"']+)["'][^}]*?ar\s*:\s*["']([^"']+)["']\s*\}/g;
    while ((m = verbRe.exec(code)) !== null) {
      const en = `${m[1].trim()} / ${m[2].trim()}`;
      if (!seenEn.has(en.toLowerCase())) {
        seenEn.add(en.toLowerCase());
        parsedWords.push({ english: en, arabic: m[3].trim(), word_type: 'verb' });
      }
    }
    const defRe = /\{\s*word\s*:\s*["']([^"']+)["'][^}]*?def\s*:\s*["']([^"']+)["'][^}]*?ar\s*:\s*["']([^"']+)["']\s*\}/g;
    while ((m = defRe.exec(code)) !== null) {
      const en = `${m[1].trim()}: ${m[2].trim()}`;
      if (!seenEn.has(en.toLowerCase())) {
        seenEn.add(en.toLowerCase());
        parsedWords.push({ english: en, arabic: m[3].trim(), word_type: 'definition' });
      }
    }
    const storyRe = /\{\s*speaker\s*:\s*["']([^"']*)['"]\s*,\s*en\s*:\s*["']([^"']+)["']\s*,\s*ar\s*:\s*["']([^"']+)["']\s*\}/g;
    while ((m = storyRe.exec(code)) !== null) {
      if (m[2] && m[3] && !seenEn.has(m[2].toLowerCase())) {
        seenEn.add(m[2].toLowerCase());
        parsedWords.push({ english: (m[1] ? m[1]+': ' : '') + m[2].trim(), arabic: m[3].trim(), word_type: m[1] ? 'story' : 'expression' });
      }
    }
  } catch(e) {}
  showParsedWords();
}

function showParsedWords() {
  const resultsDiv = document.getElementById('parsedResults');
  const alertEl    = document.getElementById('parseAlert');
  const container  = document.getElementById('parsedWordsContainer');
  if (parsedWords.length === 0) {
    alertEl.className = 'alert alert-error';
    alertEl.textContent = '❌ مش لاقي كلمات. تأكد من صيغة الكود.';
    container.innerHTML = '';
    resultsDiv.classList.remove('hidden');
    return;
  }
  alertEl.className = 'alert alert-success';
  alertEl.textContent = `✅ تم استخراج ${parsedWords.length} كلمة`;
  let html = `<table class="parsed-words-table"><thead><tr><th>#</th><th>الإنجليزية</th><th>العربية</th><th>النوع</th></tr></thead><tbody>`;
  parsedWords.forEach((w,i) => {
    html += `<tr><td>${i+1}</td><td dir="ltr">${w.english}</td><td>${w.arabic}</td><td><span class="badge badge-info">${w.word_type}</span></td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  resultsDiv.classList.remove('hidden');
}

// ---- SAVE VOCABULARY ----
async function saveVocabulary() {
  const grade  = parseInt(document.getElementById('vocabGrade').value);
  const lesson = parseInt(document.getElementById('vocabLesson').value);
  if (!grade || !lesson) { alert('⚠️ اختر الصف ورقم الدرس!'); return; }
  if (parsedWords.length === 0) { alert('⚠️ مفيش كلمات!'); return; }
  showLoading(true);
  try {
    const rows = parsedWords.map((w,i) => ({
      grade, lesson, english: w.english, arabic: w.arabic,
      word_type: w.word_type || 'vocab', sort_order: i+1, emoji: w.emoji || ''
    }));
    const { error } = await sb.from('vocabulary').insert(rows);
    if (error) throw error;
    alert(`✅ تم حفظ ${rows.length} كلمة للصف ${grade} درس ${lesson}`);
    document.getElementById('pasteCode').value = '';
    document.getElementById('parsedResults').classList.add('hidden');
    parsedWords = [];
  } catch(e) { alert('❌ خطأ: ' + e.message); }
  finally { showLoading(false); }
}

// ---- MANUAL WORD ----
async function saveManualWord() {
  const en     = document.getElementById('manualEn').value.trim();
  const ar     = document.getElementById('manualAr').value.trim();
  const grade  = parseInt(document.getElementById('manualGrade').value);
  const lesson = parseInt(document.getElementById('manualLesson').value);
  const type   = document.getElementById('manualType').value;
  if (!en || !ar || !grade || !lesson) { alert('⚠️ اكمل كل الحقول!'); return; }
  showLoading(true);
  try {
    const { data: existing } = await sb.from('vocabulary').select('sort_order').eq('grade',grade).eq('lesson',lesson).order('sort_order',{ascending:false}).limit(1);
    const nextOrder = (existing && existing[0]) ? existing[0].sort_order + 1 : 1;
    const { error } = await sb.from('vocabulary').insert({ grade, lesson, english: en, arabic: ar, word_type: type, sort_order: nextOrder });
    if (error) throw error;
    alert('✅ تمت إضافة الكلمة');
    document.getElementById('manualEn').value = '';
    document.getElementById('manualAr').value = '';
    document.getElementById('manualLesson').value = '';
  } catch(e) { alert('❌ خطأ: ' + e.message); }
  finally { showLoading(false); }
}

// ---- LOAD PROGRESS ----
async function loadProgress() {
  const container = document.getElementById('progressContainer');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner" style="margin:0 auto 14px;width:38px;height:38px;"></div><p>جاري التحميل...</p></div>';
  try {
    const { data: codes, error: ce } = await sb.from('student_codes')
      .select('id,code,grades,is_used,is_active').eq('is_active',true).eq('is_used',true);
    if (ce) throw ce;
    if (!codes || codes.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>مفيش طلاب دخلوا لحد دلوقتي</p></div>';
      return;
    }
    const codeIds = codes.map(c => c.id);
    const { data: progress } = await sb.from('student_progress')
      .select('code_id,grade,lesson,completed,words_heard,total_words').in('code_id', codeIds);
    const progMap = {};
    (progress || []).forEach(p => {
      if (!progMap[p.code_id]) progMap[p.code_id] = { total:0, completed:0 };
      progMap[p.code_id].total++;
      if (p.completed) progMap[p.code_id].completed++;
    });
    let html = '';
    codes.forEach(c => {
      const prog = progMap[c.id] || { total:0, completed:0 };
      const pct  = prog.total > 0 ? Math.round(prog.completed/prog.total*100) : 0;
      const gradeNames = c.grades.sort((a,b)=>a-b).map(id => GRADES.find(g=>g.id===id)?.short||id).join(', ');
      html += `<div class="card" style="margin-bottom:11px;padding:15px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <strong style="font-size:1.25em;color:var(--primary);letter-spacing:2px;">${c.code}</strong>
            <div style="font-size:0.78em;color:var(--muted);margin-top:2px;">${gradeNames}</div>
          </div>
          <div style="text-align:left;">
            <div style="font-weight:bold;font-size:1.1em;color:var(--secondary);">${pct}%</div>
            <div style="font-size:0.76em;color:var(--muted);">${prog.completed} / ${prog.total} درس</div>
          </div>
        </div>
        <div class="progress-bar-wrap" style="margin-top:9px;">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
    });
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<div class="alert alert-error">❌ خطأ: ${e.message}</div>`;
  }
}

// ---- CHANGE PASSWORD ----
async function changePassword() {
  const newPass = document.getElementById('newPass').value.trim();
  const msgEl   = document.getElementById('passMsg');
  if (!/^\d{4}$/.test(newPass)) { msgEl.innerHTML = '<div class="alert alert-error">❌ لازم تكون 4 أرقام بالظبط</div>'; return; }
  showLoading(true);
  try {
    const hash = await sha256(newPass);
    const { data: existing } = await sb.from('teacher_auth').select('id').limit(1);
    if (existing && existing.length > 0) {
      await sb.from('teacher_auth').update({ password_hash: hash }).eq('id', existing[0].id);
    } else {
      await sb.from('teacher_auth').insert({ password_hash: hash });
    }
    msgEl.innerHTML = '<div class="alert alert-success">✅ تم تغيير كلمة السر بنجاح</div>';
    document.getElementById('newPass').value = '';
  } catch(e) { msgEl.innerHTML = `<div class="alert alert-error">❌ خطأ: ${e.message}</div>`; }
  finally { showLoading(false); }
}

// ---- DELETE LESSON ----
async function deleteLesson() {
  const grade  = document.getElementById('delGrade').value;
  const lesson = document.getElementById('delLesson').value;
  if (!grade || !lesson) { alert('⚠️ اختر الصف والدرس!'); return; }
  if (!confirm(`⚠️ هتحذف كل كلمات الصف ${grade} درس ${lesson}؟`)) return;
  showLoading(true);
  try {
    const { error } = await sb.from('vocabulary').delete().eq('grade', parseInt(grade)).eq('lesson', parseInt(lesson));
    if (error) throw error;
    alert('✅ تم حذف الدرس');
  } catch(e) { alert('❌ خطأ: ' + e.message); }
  finally { showLoading(false); }
}

// ---- LOADING ----
function showLoading(v) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !v);
}
