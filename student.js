/*=================================================================
  Mr. Osama - Student JavaScript
  KEY FIX: navigator.onLine is unreliable in WebView/APK.
  Strategy: ALWAYS try network first, fall back to cache on error.
=================================================================*/

const SUPABASE_URL = 'https://gmqjlpqsbhrlqxcnkiet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-fAc2QUuPsWFPjS7cunk5g_Fge-oj3c';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const GRADES = [
  { id:1, name:'الصف الأول الابتدائي',   short:'١ ابتدائي', icon:'🌱', color:'#4CAF50' },
  { id:2, name:'الصف الثاني الابتدائي',  short:'٢ ابتدائي', icon:'🌿', color:'#8BC34A' },
  { id:3, name:'الصف الثالث الابتدائي',  short:'٣ ابتدائي', icon:'🌳', color:'#CDDC39' },
  { id:4, name:'الصف الرابع الابتدائي',  short:'٤ ابتدائي', icon:'📗', color:'#009688' },
  { id:5, name:'الصف الخامس الابتدائي',  short:'٥ ابتدائي', icon:'📘', color:'#2196F3' },
  { id:6, name:'الصف السادس الابتدائي',  short:'٦ ابتدائي', icon:'📙', color:'#3F51B5' },
  { id:7, name:'الصف الأول الإعدادي',    short:'١ إعدادي',  icon:'🏫', color:'#9C27B0' },
  { id:8, name:'الصف الثاني الإعدادي',   short:'٢ إعدادي',  icon:'🏛',  color:'#E91E63' },
  { id:9, name:'الصف الثالث الإعدادي',   short:'٣ إعدادي',  icon:'🎓', color:'#FF5722' },
];

const TYPE_LABELS = {
  vocab:'📚 مفردات أساسية', extra:'➕ مفردات إضافية',
  verb:'🔄 أفعال', expression:'💬 تعبيرات',
  definition:'📖 تعريفات', story:'📝 النص',
};

// ---- State ----
let studentCodeId = null;
let studentGrades = [];
let currentGrade  = null;
let currentLesson = null;
let vocabData     = [];
let heardWords    = new Set();
let voices        = [];
let isPlaying     = false;
let stopRequested = false;
let isPreviewMode = false;
let isOnline      = true; // optimistic — always try network first

const synth = window.speechSynthesis;

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

// ---- NETWORK helper ----
// Always try the fetch; mark offline only on actual failure
async function tryFetch(queryFn) {
  try {
    const result = await queryFn();
    isOnline = true;
    hideBanner();
    return result;
  } catch(e) {
    isOnline = false;
    showBanner();
    return { data: null, error: e };
  }
}

function showBanner() {
  const b = document.getElementById('offlineBanner');
  if (b) b.classList.add('show');
}
function hideBanner() {
  const b = document.getElementById('offlineBanner');
  if (b) b.classList.remove('show');
}

// ---- AUTH CHECK ----
function checkStudentAuth() {
  isPreviewMode = localStorage.getItem('mr_preview_mode') === '1';
  studentCodeId = localStorage.getItem('mr_student_code_id');
  const gradesRaw = localStorage.getItem('mr_student_grades');

  if (!studentCodeId || !gradesRaw) {
    localStorage.removeItem('mr_session_ok');
    window.location.replace('index.html');
    return false;
  }
  try {
    const parsed = JSON.parse(gradesRaw);
    studentGrades = Array.isArray(parsed)
      ? parsed.map(Number).filter(n => !isNaN(n) && n > 0).sort((a,b) => a-b)
      : [];
  } catch(e) {
    localStorage.removeItem('mr_session_ok');
    window.location.replace('index.html');
    return false;
  }
  if (studentGrades.length === 0 && !isPreviewMode) {
    localStorage.removeItem('mr_session_ok');
    window.location.replace('index.html');
    return false;
  }
  return true;
}

function studentLogout() {
  if (!confirm('هتخرج من الحساب؟')) return;
  clearStudentSession();
  window.location.replace('index.html');
}

function clearStudentSession() {
  ['mr_student_code_id','mr_student_grades','mr_student_code',
   'mr_preview_mode','mr_session_ok'].forEach(k => localStorage.removeItem(k));
}

function exitPreview() {
  clearStudentSession();
  window.location.replace('teacher.html');
}

// ---- BACK BUTTON ----
function pushHistory(state) { history.pushState(state, ''); }

window.addEventListener('popstate', (e) => {
  const s = e.state;
  if (!s) return;
  if (s.view === 'grades')  _showGradesView();
  else if (s.view === 'lessons' && s.gradeId) _showLessonsView(s.gradeId);
  else if (s.view === 'lesson'  && s.gradeId && s.lessonNum) showLessonView(s.gradeId, s.lessonNum);
});

// ---- INIT ----
window.addEventListener('DOMContentLoaded', () => {
  if (!checkStudentAuth()) return;

  if (isPreviewMode) {
    const b = document.getElementById('previewBanner');
    if (b) b.classList.add('show');
  }

  populateVoices();
  if (speechSynthesis.onvoiceschanged !== undefined)
    speechSynthesis.onvoiceschanged = populateVoices;

  history.replaceState({ view: 'grades' }, '');
  showGradesView();

  // Register SW for background sync
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'SYNC_NOW') syncWithServer();
    });
  }
});

function populateVoices() {
  voices = synth.getVoices().filter(v => v.lang.startsWith('en'));
  if (voices.length === 0) voices = synth.getVoices();
  const sel = document.getElementById('voiceSelect');
  if (!sel) return;
  sel.innerHTML = voices.map(v =>
    `<option value="${v.name}">${v.name.replace(/Microsoft |Google /, '')}</option>`
  ).join('');
  const preferred = voices.findIndex(v => v.lang === 'en-US' || v.lang === 'en-GB');
  if (preferred >= 0) sel.selectedIndex = preferred;
}

// ---- VIEWS ----
function showView(id) {
  ['view-grades','view-lessons','view-lesson'].forEach(v =>
    document.getElementById(v).classList.toggle('hidden', v !== id)
  );
}

function updateBreadcrumb(items) {
  document.getElementById('breadcrumb').innerHTML = items.map((item, i) =>
    i === items.length - 1
      ? `<span>${item.label}</span>`
      : `<span class="crumb" onclick="${item.onclick}">${item.label}</span><span class="sep">›</span>`
  ).join('');
}

// =========================================================
// GRADES VIEW
// =========================================================
function showGradesView() {
  pushHistory({ view: 'grades' });
  _showGradesView();
}

async function _showGradesView() {
  currentGrade = null; currentLesson = null;
  synth.cancel();
  showView('view-grades');
  updateBreadcrumb([{ label: '🏠 الصفوف' }]);

  const container = document.getElementById('gradesDisplay');
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner" style="margin:0 auto 12px;width:36px;height:36px;"></div><p>جاري التحميل...</p></div>';

  // Refresh grades from server (network-first, no onLine check)
  if (!isPreviewMode) {
    const { data: codeData } = await tryFetch(() =>
      sb.from('student_codes').select('grades,is_active').eq('id', studentCodeId).single()
    );
    if (codeData) {
      if (!codeData.is_active) {
        alert('⚠️ كودك اتلغى. اتصل بالمدرس.');
        studentLogout(); return;
      }
      studentGrades = (codeData.grades || []).map(Number)
        .filter(n => !isNaN(n) && n > 0).sort((a,b) => a-b);
      localStorage.setItem('mr_student_grades', JSON.stringify(studentGrades));
    } else {
      // Use cached grades if network failed
      const cached = localStorage.getItem('mr_student_grades');
      if (cached) {
        try { studentGrades = JSON.parse(cached).map(Number).filter(n => n > 0); } catch(e) {}
      }
    }
  }

  if (studentGrades.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>مفيش صفوف متاحة - اتصل بالمدرس</p></div>';
    return;
  }

  // Load progress (network-first)
  let progressByGrade = {};
  if (!isPreviewMode) {
    const { data: progData } = await tryFetch(() =>
      sb.from('student_progress').select('grade,lesson,completed').eq('code_id', studentCodeId)
    );
    if (progData) {
      progData.forEach(p => {
        if (!progressByGrade[p.grade]) progressByGrade[p.grade] = { total:0, completed:0 };
        progressByGrade[p.grade].total++;
        if (p.completed) progressByGrade[p.grade].completed++;
      });
      localStorage.setItem('mr_progress_all_' + studentCodeId, JSON.stringify(progressByGrade));
    } else {
      try {
        progressByGrade = JSON.parse(localStorage.getItem('mr_progress_all_' + studentCodeId) || '{}');
      } catch(e) {}
    }
  }

  container.innerHTML = '';
  studentGrades.forEach(gradeId => {
    const grade = GRADES.find(g => g.id === gradeId);
    if (!grade) return;
    const prog = progressByGrade[gradeId] || { total:0, completed:0 };
    const pct  = prog.total > 0 ? Math.round(prog.completed / prog.total * 100) : 0;

    const card = document.createElement('div');
    card.className = 'grade-hero-card';
    if (prog.completed > 0) card.style.borderColor = grade.color;
    card.innerHTML = `
      <span class="g-icon">${grade.icon}</span>
      <div class="g-name">${grade.short}</div>
      ${prog.total > 0 ? `
        <div class="progress-bar-wrap" style="margin:5px 0 2px;">
          <div class="progress-bar-fill" style="width:${pct}%;background:${grade.color};"></div>
        </div>
        <div class="g-progress">${prog.completed}/${prog.total} درس ✓</div>
      ` : '<div class="g-progress">ابدأ الآن!</div>'}
    `;
    card.onclick = () => showLessonsView(gradeId);
    container.appendChild(card);
  });
}

// =========================================================
// LESSONS VIEW
// =========================================================
function showLessonsView(gradeId) {
  pushHistory({ view: 'lessons', gradeId });
  _showLessonsView(gradeId);
}

async function _showLessonsView(gradeId) {
  currentGrade = gradeId; currentLesson = null;
  synth.cancel();
  showView('view-lessons');

  const grade = GRADES.find(g => g.id === gradeId);
  if (!grade) { showGradesView(); return; }
  document.getElementById('gradeTitle').textContent    = grade.icon + ' ' + grade.name;
  document.getElementById('gradeSubtitle').textContent = 'اختر الدرس اللي عايز تذاكره';
  updateBreadcrumb([
    { label: '🏠 الصفوف', onclick: 'showGradesView()' },
    { label: grade.short }
  ]);

  const container = document.getElementById('lessonsList');
  container.innerHTML = '<div class="empty-state"><div class="loading-spinner" style="margin:0 auto 12px;width:36px;height:36px;"></div><p>جاري التحميل...</p></div>';

  try {
    let lessons = [], progressMap = {};

    // Network-first (no onLine check — always try)
    const vocabRes = await tryFetch(() =>
      sb.from('vocabulary').select('lesson').eq('grade', gradeId)
    );

    if (vocabRes.data) {
      lessons = [...new Set(vocabRes.data.map(v => v.lesson))].sort((a,b) => a-b);
      localStorage.setItem(`mr_lessons_${gradeId}`, JSON.stringify(lessons));
    } else {
      // Offline fallback
      const cl = localStorage.getItem(`mr_lessons_${gradeId}`);
      if (cl) lessons = JSON.parse(cl);
    }

    if (!isPreviewMode) {
      const progressRes = await tryFetch(() =>
        sb.from('student_progress').select('*').eq('code_id', studentCodeId).eq('grade', gradeId)
      );
      if (progressRes.data) {
        progressRes.data.forEach(p => { progressMap[p.lesson] = p; });
        localStorage.setItem(`mr_progress_lessons_${studentCodeId}_${gradeId}`, JSON.stringify(progressMap));
      } else {
        const cp = localStorage.getItem(`mr_progress_lessons_${studentCodeId}_${gradeId}`);
        if (cp) progressMap = JSON.parse(cp);
      }
    }

    if (lessons.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>مفيش دروس متاحة لهذا الصف بعد</p></div>';
      return;
    }

    container.innerHTML = '';
    lessons.forEach((lessonNum, idx) => {
      const progress    = progressMap[lessonNum];
      const isCompleted = progress?.completed || false;
      const wordsHeard  = progress?.words_heard || 0;
      const totalWords  = progress?.total_words || 0;
      const isUnlocked  = isPreviewMode || idx === 0 ||
        progressMap[lessons[idx-1]]?.completed === true;

      const div = document.createElement('div');
      div.className = 'lesson-item' +
        (isCompleted ? ' completed' : '') +
        (!isUnlocked ? ' locked' : '');
      div.innerHTML = `
        <div class="lesson-icon">${isCompleted ? '🏆' : isUnlocked ? '📖' : '🔒'}</div>
        <div class="lesson-info">
          <div class="lesson-name">الدرس ${lessonNum}</div>
          ${isCompleted
            ? '<div class="lesson-progress" style="color:var(--success);">✅ مكتمل!</div>'
            : isUnlocked && totalWords > 0
              ? `<div class="lesson-progress">${wordsHeard} / ${totalWords} كلمة</div>
                 <div class="progress-bar-wrap" style="margin-top:4px;">
                   <div class="progress-bar-fill" style="width:${totalWords > 0 ? Math.round(wordsHeard/totalWords*100) : 0}%;"></div>
                 </div>`
              : isUnlocked
                ? '<div class="lesson-progress">ابدأ الآن!</div>'
                : '<div class="lesson-progress" style="color:#666;">أكمل الدرس السابق أولاً</div>'}
        </div>
        <div class="lesson-status">${isCompleted ? '✓' : isUnlocked ? '›' : '🔒'}</div>
      `;
      if (isUnlocked) div.onclick = () => showLessonView(gradeId, lessonNum);
      container.appendChild(div);
    });
  } catch(e) {
    container.innerHTML = `<div class="alert alert-error">❌ خطأ: ${e.message}</div>`;
  }
}

// =========================================================
// LESSON VIEW  (THE MAIN FIX IS HERE)
// =========================================================
async function showLessonView(gradeId, lessonNum) {
  pushHistory({ view: 'lesson', gradeId, lessonNum });
  currentGrade = gradeId; currentLesson = lessonNum;
  heardWords = new Set(); stopRequested = false;
  synth.cancel();
  showView('view-lesson');

  const grade = GRADES.find(g => g.id === gradeId);
  document.getElementById('lessonTitle').textContent    = `الدرس ${lessonNum}`;
  document.getElementById('lessonSubtitle').textContent = grade ? grade.name : '';
  updateBreadcrumb([
    { label:'🏠 الصفوف', onclick:'showGradesView()' },
    { label: grade ? grade.short : '?', onclick:`showLessonsView(${gradeId})` },
    { label: `الدرس ${lessonNum}` }
  ]);

  const sectionsDiv = document.getElementById('vocabSections');
  sectionsDiv.innerHTML = '<div class="empty-state"><div class="loading-spinner" style="margin:0 auto 12px;width:36px;height:36px;"></div><p>جاري تحميل الكلمات...</p></div>';
  updateCompletion();

  // ---- STEP 1: Load vocabulary (network-first, ALWAYS try) ----
  vocabData = [];
  let vocabLoaded = false;

  const vocabRes = await tryFetch(() =>
    sb.from('vocabulary')
      .select('*')
      .eq('grade', gradeId)
      .eq('lesson', lessonNum)
      .order('sort_order', { ascending: true })
  );

  if (vocabRes.data && vocabRes.data.length > 0) {
    vocabData = vocabRes.data;
    vocabLoaded = true;
    // Cache for offline
    localStorage.setItem(`mr_vocab_${gradeId}_${lessonNum}`, JSON.stringify(vocabData));
  } else if (vocabRes.error) {
    // Network failed — try cache
    const cached = localStorage.getItem(`mr_vocab_${gradeId}_${lessonNum}`);
    if (cached) {
      try { vocabData = JSON.parse(cached); vocabLoaded = true; } catch(e) {}
    }
  }

  if (!vocabLoaded || vocabData.length === 0) {
    const cached = localStorage.getItem(`mr_vocab_${gradeId}_${lessonNum}`);
    if (cached) {
      try { vocabData = JSON.parse(cached); vocabLoaded = true; } catch(e) {}
    }
  }

  if (vocabData.length === 0) {
    sectionsDiv.innerHTML = vocabRes.error
      ? '<div class="alert alert-warning">⚠️ لا يوجد اتصال ولا بيانات محفوظة لهذا الدرس<br><small>افتح الدرس لأول مرة مع النت</small></div>'
      : '<div class="empty-state"><div class="empty-icon">📭</div><p>مفيش كلمات في هذا الدرس بعد</p></div>';
    return;
  }

  // ---- STEP 2: Load progress (separate, non-blocking) ----
  if (!isPreviewMode && studentCodeId) {
    try {
      const progRes = await sb.from('student_progress')
        .select('words_heard,total_words,completed,heard_ids')
        .eq('code_id', studentCodeId)
        .eq('grade', gradeId)
        .eq('lesson', lessonNum)
        .maybeSingle();

      const prog = progRes.data;
      if (prog && prog.completed) {
        vocabData.forEach(w => heardWords.add(w.id));
      } else if (prog && prog.heard_ids) {
        try { JSON.parse(prog.heard_ids).forEach(id => heardWords.add(id)); } catch(e2) {}
      } else {
        restoreLocalProgress(gradeId, lessonNum);
      }
    } catch(pe) {
      // Progress failed — use local cache (don't block vocab display)
      restoreLocalProgress(gradeId, lessonNum);
    }
  } else {
    restoreLocalProgress(gradeId, lessonNum);
  }

  // ---- STEP 3: Render ----
  renderVocabSections();
  updateCompletion();

  // Init progress record (fire-and-forget)
  if (!isPreviewMode && studentCodeId && heardWords.size === 0) {
    sb.from('student_progress').upsert({
      code_id: studentCodeId, grade: currentGrade, lesson: currentLesson,
      words_heard: 0, total_words: vocabData.length, completed: false, heard_ids: '[]'
    }, { onConflict: 'code_id,grade,lesson', ignoreDuplicates: true })
      .then(() => {}).catch(() => {});
  }
}

// ---- RENDER VOCAB SECTIONS ----
function renderVocabSections() {
  const sectionsDiv = document.getElementById('vocabSections');
  sectionsDiv.innerHTML = '';

  const typeOrder = ['vocab','extra','verb','expression','definition','story'];
  const grouped   = {};
  typeOrder.forEach(t => grouped[t] = []);
  vocabData.forEach(w => {
    const t = w.word_type || 'vocab';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(w);
  });

  typeOrder.forEach(type => {
    const words = grouped[type];
    if (!words || words.length === 0) return;

    const header = document.createElement('div');
    header.className = 'section-divider';
    header.innerHTML = `
      <h4>${TYPE_LABELS[type] || type}</h4>
      <button class="play-all-btn" style="margin:0;padding:5px 12px;font-size:0.78em;"
        onclick="playSectionByType('${type}')">▶️ نطق الكل</button>
    `;
    sectionsDiv.appendChild(header);

    words.forEach(word => {
      const isHeard  = heardWords.has(word.id);
      const hasSplit = word.english.includes(' / ') || word.arabic.includes(' / ');
      if (hasSplit)          sectionsDiv.appendChild(buildSplitCard(word, isHeard));
      else if (type === 'story') sectionsDiv.appendChild(buildStoryCard(word, isHeard));
      else                   sectionsDiv.appendChild(buildWordCard(word, isHeard));
    });
  });
}

// ---- WORD CARDS ----
function buildWordCard(word, isHeard) {
  const card = document.createElement('div');
  card.className = 'word-card' + (isHeard ? ' heard' : '');
  card.id = 'word_' + word.id;
  card.innerHTML = `
    <div class="word-emoji">${word.emoji || getTypeEmoji(word.word_type)}</div>
    <div class="word-texts">
      <div class="word-en" dir="ltr">${word.english}</div>
      <div class="word-ar">${word.arabic}</div>
      <span class="word-type-label">${TYPE_LABELS[word.word_type] || word.word_type}</span>
    </div>
    <div class="speak-icon">🔊</div>
  `;
  card.onclick = () => speakSingle(word.id, word.english, card);
  return card;
}

function buildStoryCard(word, isHeard) {
  const parts   = word.english.split(': ');
  const speaker = parts.length > 1 ? parts[0] : '';
  const text    = parts.length > 1 ? parts.slice(1).join(': ') : word.english;
  const card    = document.createElement('div');
  card.className = 'story-card' + (isHeard ? ' heard' : '');
  card.id = 'word_' + word.id;
  card.innerHTML = `
    ${speaker ? `<div class="story-speaker">👤 ${speaker}</div>` : ''}
    <div class="story-en">${text}</div>
    <div class="story-ar">${word.arabic}</div>
  `;
  card.onclick = () => speakSingle(word.id, text, card);
  return card;
}

function buildSplitCard(word, isHeard) {
  const enParts = word.english.split(' / ');
  const arParts = word.arabic.split(' / ');
  const card    = document.createElement('div');
  card.className = 'word-card split-card' + (isHeard ? ' heard' : '');
  card.id = 'word_' + word.id;

  const header = document.createElement('div');
  header.className = 'split-card-header';
  header.innerHTML = `
    <div class="word-emoji">${word.emoji || getTypeEmoji(word.word_type)}</div>
    <span class="word-type-label">${TYPE_LABELS[word.word_type] || word.word_type}</span>
  `;
  card.appendChild(header);

  const cols = document.createElement('div');
  cols.className = 'split-cols';
  enParts.forEach((enP, i) => {
    const arP = (arParts[i] || '').trim();
    const col = document.createElement('div');
    col.className = 'split-col';
    col.id = `split_${word.id}_${i}`;
    col.innerHTML = `
      <div class="s-en" dir="ltr">${enP.trim()}</div>
      <div class="s-ar">${arP}</div>
      <div class="s-icon">🔊</div>
    `;
    col.onclick = () => speakPart(word.id, enP.trim(), col);
    cols.appendChild(col);
  });
  card.appendChild(cols);
  return card;
}

function getTypeEmoji(type) {
  return { vocab:'📚', extra:'➕', verb:'🔄', expression:'💬', definition:'📖', story:'📝' }[type] || '📝';
}

// ---- SPEECH ----
async function speakSingle(wordId, text, element) {
  stopRequested = false; synth.cancel();
  await speakPromise(text, element);
  markHeard(wordId);
}

async function speakPart(wordId, text, element) {
  stopRequested = false; synth.cancel();
  await speakPromise(text, element);
  markHeard(wordId);
}

function speakPromise(text, element) {
  return new Promise(resolve => {
    if (stopRequested) { resolve(); return; }
    synth.cancel();
    const cleanText = text.replace(/\(.+?\)/g,'').replace(/\[.+?\]/g,'').trim();
    const utter = new SpeechSynthesisUtterance(cleanText);
    const selName = document.getElementById('voiceSelect')?.value;
    if (selName) utter.voice = voices.find(v => v.name === selName) || null;
    utter.rate = parseFloat(document.getElementById('speedSlider')?.value || '0.8');
    utter.lang = 'en-US';
    utter.onstart = () => {
      element?.classList.add('speaking');
      element?.scrollIntoView({ behavior:'smooth', block:'center' });
    };
    utter.onend   = () => { element?.classList.remove('speaking'); resolve(); };
    utter.onerror = () => { element?.classList.remove('speaking'); resolve(); };
    synth.speak(utter);
  });
}

async function playAllWords() {
  if (isPlaying) { stopSpeaking(); return; }
  isPlaying = true; stopRequested = false;
  const btn = document.getElementById('playAllBtn');
  if (btn) btn.textContent = '⏸ إيقاف';

  for (const word of vocabData) {
    if (stopRequested) break;
    if (word.english.includes(' / ')) {
      const parts = word.english.split(' / ');
      for (let i = 0; i < parts.length; i++) {
        if (stopRequested) break;
        const colEl = document.getElementById(`split_${word.id}_${i}`);
        await speakPromise(parts[i].trim(), colEl);
        if (!stopRequested) await delay(350);
      }
    } else {
      const el = document.getElementById('word_' + word.id);
      await speakPromise(word.english, el);
    }
    if (!stopRequested) { markHeard(word.id); await delay(400); }
  }

  isPlaying = false;
  if (btn) btn.textContent = '▶️ نطق الكل';
  document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
}

async function playSectionByType(type) {
  stopRequested = false;
  for (const word of vocabData.filter(w => w.word_type === type)) {
    if (stopRequested) break;
    if (word.english.includes(' / ')) {
      const parts = word.english.split(' / ');
      for (let i = 0; i < parts.length; i++) {
        if (stopRequested) break;
        const colEl = document.getElementById(`split_${word.id}_${i}`);
        await speakPromise(parts[i].trim(), colEl);
        if (!stopRequested) await delay(350);
      }
    } else {
      const el = document.getElementById('word_' + word.id);
      await speakPromise(word.english, el);
    }
    if (!stopRequested) { markHeard(word.id); await delay(400); }
  }
}

function stopSpeaking() {
  stopRequested = true; isPlaying = false; synth.cancel();
  const btn = document.getElementById('playAllBtn');
  if (btn) btn.textContent = '▶️ نطق الكل';
  document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- MARK HEARD ----
function markHeard(wordId) {
  if (heardWords.has(wordId)) return;
  heardWords.add(wordId);
  const el = document.getElementById('word_' + wordId);
  if (el) el.classList.add('heard');
  updateCompletion();
  if (!isPreviewMode) saveProgressLocal();
}

function updateCompletion() {
  const total = vocabData.length, heard = heardWords.size;
  const pct   = total > 0 ? Math.round(heard / total * 100) : 0;
  const pctEl  = document.getElementById('completionPercent');
  const barEl  = document.getElementById('completionBar');
  const textEl = document.getElementById('completionText');
  const btnEl  = document.getElementById('completeLessonBtn');
  const secEl  = document.getElementById('completeSection');
  if (pctEl)  pctEl.textContent  = pct + '%';
  if (barEl)  barEl.style.width  = pct + '%';
  if (textEl) textEl.textContent = pct === 100
    ? '🎉 ممتاز! سمعت كل الكلمات!'
    : `اسمع ${total - heard} كلمة كمان`;
  if (btnEl)  btnEl.disabled = pct < 100;
  if (secEl)  secEl.classList.toggle('ready', pct === 100);
}

// ---- PROGRESS LOCAL ----
function restoreLocalProgress(gradeId, lessonNum) {
  const key   = `mr_local_progress_${studentCodeId}_${gradeId}_${lessonNum}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const { heard } = JSON.parse(saved);
      if (Array.isArray(heard)) heard.forEach(id => heardWords.add(id));
    } catch(e) {}
  }
}

function saveProgressLocal() {
  const key = `mr_local_progress_${studentCodeId}_${currentGrade}_${currentLesson}`;
  localStorage.setItem(key, JSON.stringify({ heard:[...heardWords], total:vocabData.length }));

  const gKey  = `mr_progress_lessons_${studentCodeId}_${currentGrade}`;
  let gCache  = {};
  try { gCache = JSON.parse(localStorage.getItem(gKey) || '{}'); } catch(e) {}
  if (!gCache[currentLesson]) gCache[currentLesson] = {};
  gCache[currentLesson].words_heard = heardWords.size;
  gCache[currentLesson].total_words = vocabData.length;
  localStorage.setItem(gKey, JSON.stringify(gCache));

  const payload = {
    code_id: studentCodeId, grade: currentGrade, lesson: currentLesson,
    words_heard: heardWords.size, total_words: vocabData.length,
    completed: false, heard_ids: JSON.stringify([...heardWords])
  };
  upsertProgress(payload); // always try, will silently fail if offline
}

async function upsertProgress(payload) {
  if (!studentCodeId) return;
  try {
    await sb.from('student_progress').upsert(payload, { onConflict: 'code_id,grade,lesson' });
  } catch(e) {
    queueOfflineProgress(payload);
  }
}

// ---- COMPLETE LESSON ----
async function completeLesson() {
  if (isPreviewMode) { alert('وضع المعاينة - التقدم لا يُحفظ'); return; }
  if (heardWords.size < vocabData.length) { alert('⚠️ لازم تسمع كل الكلمات الأول!'); return; }

  const btn = document.getElementById('completeLessonBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  const payload = {
    code_id: studentCodeId, grade: currentGrade, lesson: currentLesson,
    words_heard: vocabData.length, total_words: vocabData.length,
    completed: true, completed_at: new Date().toISOString(),
    heard_ids: JSON.stringify([...heardWords])
  };

  try {
    await sb.from('student_progress').upsert(payload, { onConflict: 'code_id,grade,lesson' });
  } catch(e) {
    queueOfflineProgress(payload);
  }

  localStorage.setItem(`mr_complete_${studentCodeId}_${currentGrade}_${currentLesson}`, '1');
  const gKey = `mr_progress_lessons_${studentCodeId}_${currentGrade}`;
  let gCache = {};
  try { gCache = JSON.parse(localStorage.getItem(gKey) || '{}'); } catch(e) {}
  gCache[currentLesson] = { completed:true, words_heard:vocabData.length, total_words:vocabData.length };
  localStorage.setItem(gKey, JSON.stringify(gCache));

  btn.textContent = '🏆 أحسنت! الدرس مكتمل!';
  btn.style.background = '#4CAF50';
  synth.cancel();
  const utter = new SpeechSynthesisUtterance('Excellent! Well done!');
  utter.rate = 0.9; synth.speak(utter);

  setTimeout(() => {
    alert('🏆 ممتاز! أكملت الدرس! يمكنك الانتقال للدرس التالي.');
    showLessonsView(currentGrade);
  }, 1500);
}

// ---- OFFLINE QUEUE ----
function queueOfflineProgress(payload) {
  const qKey = 'mr_offline_queue_' + studentCodeId;
  let queue  = [];
  try { queue = JSON.parse(localStorage.getItem(qKey) || '[]'); } catch(e) {}
  const idx = queue.findIndex(p => p.grade === payload.grade && p.lesson === payload.lesson);
  if (idx >= 0) queue[idx] = payload; else queue.push(payload);
  localStorage.setItem(qKey, JSON.stringify(queue));
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then(reg => reg.sync.register('mr-sync-progress'))
      .catch(() => {});
  }
}

// ---- SYNC ----
async function syncWithServer() {
  if (!studentCodeId || isPreviewMode) return;
  const qKey  = 'mr_offline_queue_' + studentCodeId;
  let queue   = [];
  try { queue = JSON.parse(localStorage.getItem(qKey) || '[]'); } catch(e) {}

  const failed = [];
  for (const payload of queue) {
    try {
      await sb.from('student_progress').upsert(payload, { onConflict: 'code_id,grade,lesson' });
    } catch(e) { failed.push(payload); }
  }
  if (failed.length === 0) localStorage.removeItem(qKey);
  else localStorage.setItem(qKey, JSON.stringify(failed));

  // Sync complete flags
  try {
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith('mr_complete_' + studentCodeId));
    for (const key of keys) {
      const parts  = key.split('_');
      const grade  = parseInt(parts[parts.length-2]);
      const lesson = parseInt(parts[parts.length-1]);
      if (!isNaN(grade) && !isNaN(lesson)) {
        await sb.from('student_progress').upsert({
          code_id: studentCodeId, grade, lesson,
          completed: true, completed_at: new Date().toISOString()
        }, { onConflict: 'code_id,grade,lesson' });
        localStorage.removeItem(key);
      }
    }
  } catch(e) {}
}
