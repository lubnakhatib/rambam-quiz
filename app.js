(function () {
  'use strict';

  var API_URL = (window.QUIZ_CONFIG && window.QUIZ_CONFIG.API_URL || '').trim();
  var DEMO = !API_URL;
  var TOKEN_KEY = 'rmcQuizToken';

  var $app = document.getElementById('app');
  var state = { token: store('get', TOKEN_KEY), user: null, isAdmin: false, config: null, quiz: null, pendingEmail: '', verifyMode: 'verify' };

  /* ============================ API ============================ */

  function api(action, data) {
    var body = Object.assign({ action: action, token: state.token }, data || {});
    var p = DEMO ? demoApi(body) : fetch(API_URL, {
      method: 'POST',
      // text/plain כדי להימנע מ-preflight של CORS מול Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
    return p.then(function (res) {
      if (!res.ok) {
        var err = new Error(res.error || 'שגיאה');
        err.code = res.code;
        if (res.code === 'AUTH') { setToken(null); render('login'); }
        throw err;
      }
      return res;
    }, function () { throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.'); });
  }

  function store(op, key, val) {
    try {
      if (op === 'get') return localStorage.getItem(key);
      if (op === 'set') localStorage.setItem(key, val);
      if (op === 'del') localStorage.removeItem(key);
    } catch (e) { return null; }
  }

  function setToken(t) {
    state.token = t;
    store(t ? 'set' : 'del', TOKEN_KEY, t);
  }

  /* ============================ UI helpers ============================ */

  function tpl(id) {
    var node = document.getElementById('tpl-' + id).content.cloneNode(true);
    return node;
  }

  function mount(node) {
    $app.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'fade-in';
    wrap.appendChild(node);
    $app.appendChild(wrap);
    wrap.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { render(b.dataset.go); });
    });
    window.scrollTo({ top: 0 });
    return wrap;
  }

  function loading() {
    $app.innerHTML = '<div class="loader"><div class="spinner" aria-label="טוען"></div></div>';
  }

  var toastTimer;
  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 5000 : 3000);
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('loading', on);
    btn.disabled = on;
  }

  function formData(form) {
    var o = {};
    new FormData(form).forEach(function (v, k) { o[k] = String(v).trim(); });
    return o;
  }

  function onSubmit(form, handler) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[type=submit]');
      busy(btn, true);
      Promise.resolve().then(function () { return handler(formData(form)); })
        .catch(function (err) { toast(err.message, true); })
        .then(function () { busy(btn, false); });
    });
  }

  function text(root, sel, value) {
    root.querySelectorAll(sel).forEach(function (el) { el.textContent = value; });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function validPassword(p) { return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p); }

  function updateHeader() {
    var box = document.getElementById('userbox');
    box.hidden = !state.user;
    if (state.user) document.getElementById('userName').textContent = state.user.firstName + ' ' + state.user.lastName;
    document.getElementById('btnAdmin').hidden = !state.isAdmin;
  }

  function afterAuth(res) {
    setToken(res.token);
    state.user = res.user;
    state.isAdmin = res.isAdmin;
    updateHeader();
    render(landing());
  }

  function landing() { return state.user && !state.user.department ? 'dept' : 'home'; }

  /* ============================ screens ============================ */

  var screens = {};

  screens.login = function () {
    var w = mount(tpl('login'));
    var f = w.querySelector('#formLogin');
    if (state.pendingEmail) f.email.value = state.pendingEmail;
    onSubmit(f, function (d) {
      return api('login', { email: d.email, password: d.password }).then(afterAuth, function (err) {
        if (err.code === 'NOT_VERIFIED') {
          state.pendingEmail = d.email.toLowerCase();
          state.verifyMode = 'verify';
          render('verify');
        }
        throw err;
      });
    });
  };

  screens.register = function () {
    var w = mount(tpl('register'));
    var cfg = state.config || { domain: 'rmc.gov.il', departments: [] };
    text(w, '.domain', '@' + cfg.domain);
    var f = w.querySelector('#formRegister');
    f.email.placeholder = 'name@' + cfg.domain;

    onSubmit(f, function (d) {
      if (!d.firstName || !d.lastName) throw new Error('יש למלא את כל השדות');
      // בדיקת הדומיין נעשית בשרת (מנהלים מורשים להירשם גם מחוץ לדומיין)
      if (!validPassword(d.password)) throw new Error('הסיסמה חייבת להכיל לפחות 8 תווים, כולל אות באנגלית וספרה');
      if (d.password !== d.password2) throw new Error('הסיסמאות אינן תואמות');
      return api('register', d).then(function (res) {
        state.pendingEmail = d.email.toLowerCase();
        state.verifyMode = 'verify';
        toast(res.message);
        render('verify');
      });
    });
  };

  screens.verify = function () {
    var w = mount(tpl('verify'));
    var reset = state.verifyMode === 'reset';
    text(w, '.v-email', state.pendingEmail);
    text(w, '.v-title', reset ? 'איפוס סיסמה' : 'אימות כתובת מייל');
    w.querySelector('.reset-only').hidden = !reset;
    var f = w.querySelector('#formVerify');
    f.code.focus();
    onSubmit(f, function (d) {
      if (!/^\d{6}$/.test(d.code)) throw new Error('יש להזין קוד בן 6 ספרות');
      if (reset) {
        if (!validPassword(d.password)) throw new Error('הסיסמה חייבת להכיל לפחות 8 תווים, כולל אות באנגלית וספרה');
        if (d.password !== d.password2) throw new Error('הסיסמאות אינן תואמות');
        return api('resetPassword', { email: state.pendingEmail, code: d.code, password: d.password }).then(function (res) {
          toast('הסיסמה עודכנה');
          afterAuth(res);
        });
      }
      return api('verify', { email: state.pendingEmail, code: d.code }).then(function (res) {
        toast('ההרשמה אומתה בהצלחה');
        afterAuth(res);
      });
    });
    w.querySelector('#btnResend').addEventListener('click', function (e) {
      busy(e.target, true);
      api('resendCode', { email: state.pendingEmail, purpose: state.verifyMode })
        .then(function (res) { toast(res.message); }, function (err) { toast(err.message, true); })
        .then(function () { busy(e.target, false); });
    });
  };

  screens.forgot = function () {
    var w = mount(tpl('forgot'));
    var f = w.querySelector('#formForgot');
    onSubmit(f, function (d) {
      return api('forgot', { email: d.email }).then(function (res) {
        state.pendingEmail = d.email.toLowerCase();
        state.verifyMode = 'reset';
        toast(res.message);
        render('verify');
      });
    });
  };

  /** בחירת מחלקה מרשימה סגורה – מוצג פעם אחת, אחרי אימות המייל */
  screens.dept = function () {
    loading();
    api('departments').then(function (res) {
      var w = mount(tpl('dept'));
      text(w, '.d-name', state.user.firstName);
      var wingSel = w.querySelector('select[name=wing]');
      var sel = w.querySelector('select[name=department]');
      if (!res.departments.length) {
        w.querySelector('form').hidden = true;
        w.querySelector('.d-empty').hidden = false;
        return;
      }
      var wings = [];
      res.departments.forEach(function (d) { if (wings.indexOf(d.wing) < 0) wings.push(d.wing); });
      wings.forEach(function (x) { var o = document.createElement('option'); o.textContent = x; wingSel.appendChild(o); });
      function fillDepts() {
        sel.innerHTML = '<option value="">' + (wingSel.value ? 'בחרו מחלקה…' : 'קודם בחרו אגף') + '</option>';
        sel.disabled = !wingSel.value;
        res.departments.filter(function (d) { return d.wing === wingSel.value; }).forEach(function (d) {
          var o = document.createElement('option');
          o.textContent = d.name;
          sel.appendChild(o);
        });
      }
      wingSel.addEventListener('change', fillDepts);
      if (wings.length === 1) wingSel.value = wings[0];
      fillDepts();
      onSubmit(w.querySelector('form'), function (d) {
        if (!d.wing) throw new Error('יש לבחור אגף');
        if (!d.department) throw new Error('יש לבחור מחלקה מהרשימה');
        return api('setDepartment', { department: d.department }).then(function (r) {
          state.user = r.user;
          toast('המחלקה נשמרה');
          render('home');
        });
      });
    }, function (err) { toast(err.message, true); });
  };

  screens.home = function () {
    var w = mount(tpl('home'));
    text(w, '.h-name', state.user.firstName);
    w.querySelector('#btnStart').addEventListener('click', startQuiz);
  };

  function startQuiz() {
    loading();
    api('start').then(function (res) {
      state.quiz = res;
      showQuestion();
    }, function (err) {
      toast(err.message, true);
      render(err.code === 'NEED_DEPT' ? 'dept' : 'home');
    });
  }

  function showQuestion() {
    var qz = state.quiz;
    var q = qz.question;
    var w = mount(tpl('quiz'));
    text(w, '.q-counter', 'שאלה ' + (qz.index + 1) + ' מתוך ' + qz.total);
    text(w, '.q-correct', qz.index ? 'נכונות עד כה: ' + qz.correctSoFar : '');
    var bar = w.querySelector('.progress');
    bar.setAttribute('aria-valuemax', qz.total);
    bar.setAttribute('aria-valuenow', qz.index);
    setTimeout(function () { w.querySelector('.progress-bar').style.width = (qz.index / qz.total * 100) + '%'; }, 30);

    if (q.context) {
      w.querySelector('.context').hidden = false;
      text(w, '.context-text', q.context);
    }
    text(w, '.q-text', q.text);

    // איור לפי נושא השאלה
    w.querySelector('.q-illus').innerHTML = illus(topicOf(q));

    var letters = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
    var opts = w.querySelector('.options');
    var selected = -1;
    var btnNext = w.querySelector('#btnNext');
    var timer = activeTimer();

    q.answers.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.innerHTML = '<span class="mark">' + letters[i] + '</span><span class="opt-text"></span>';
      b.querySelector('.opt-text').textContent = a;
      b.addEventListener('click', function () {
        selected = i;
        opts.querySelectorAll('.option').forEach(function (o, j) {
          o.classList.toggle('selected', j === i);
          o.setAttribute('aria-checked', j === i ? 'true' : 'false');
        });
        btnNext.disabled = false;
      });
      opts.appendChild(b);
    });

    // "המשך": בודק את התשובה, מציג את התשובה הנכונה 3 שניות ועובר אוטומטית
    btnNext.addEventListener('click', function () {
      if (selected < 0) return;
      var activeMs = timer.stop();
      busy(btnNext, true);
      opts.querySelectorAll('.option').forEach(function (o) { o.disabled = true; });
      api('answer', { attemptId: qz.attemptId, index: qz.index, choice: selected, activeMs: activeMs }).then(function (res) {
        opts.querySelectorAll('.option').forEach(function (o, j) {
          o.classList.remove('selected');
          if (j === res.correctIndex) o.classList.add('is-correct');
          else if (j === selected) o.classList.add('is-wrong');
          else o.classList.add('dim');
        });
        var fb = w.querySelector('.feedback');
        fb.hidden = false;
        if (res.correct) {
          fb.className = 'feedback ok';
          fb.innerHTML = '<span>✔</span><span>תשובה נכונה!</span>';
        } else {
          fb.className = 'feedback bad';
          fb.innerHTML = '<span>✘</span><span>התשובה שגויה.<span class="fb-detail"></span></span>';
          fb.querySelector('.fb-detail').textContent = 'התשובה הנכונה: ' + q.answers[res.correctIndex];
        }
        if (res.explanation) {
          var ex = document.createElement('div');
          ex.className = 'explain';
          ex.innerHTML = '<h3>הסבר</h3><p></p>';
          ex.querySelector('p').textContent = res.explanation;
          fb.after(ex);
        }
        w.querySelector('.progress-bar').style.width = ((qz.index + 1) / qz.total * 100) + '%';
        fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        function go() {
          if (res.finished) {
            showResult(res.report);
          } else {
            state.quiz = { attemptId: qz.attemptId, index: qz.index + 1, total: qz.total, correctSoFar: res.correctSoFar, question: res.next };
            showQuestion();
          }
        }

        // ספירה לאחור של 3 שניות, עם אפשרות לעצור כדי לקרוא
        btnNext.hidden = true;
        var auto = w.querySelector('.auto-next');
        auto.hidden = false;
        var label = auto.querySelector('.auto-label');
        var hold = auto.querySelector('.auto-hold');
        var bar = auto.querySelector('.auto-bar i');
        var nextText = res.finished ? 'לסיכום ולציון' : 'לשאלה הבאה';
        label.textContent = 'ממשיכים ' + nextText + ' בעוד ' + (REVEAL_MS / 1000) + ' שניות…';
        requestAnimationFrame(function () { bar.style.transition = 'width ' + REVEAL_MS + 'ms linear'; bar.style.width = '100%'; });
        var left = REVEAL_MS / 1000;
        var tick = setInterval(function () {
          left--;
          if (left > 0) label.textContent = 'ממשיכים ' + nextText + ' בעוד ' + left + ' שניות…';
        }, 1000);
        var t = setTimeout(function () { clearInterval(tick); go(); }, REVEAL_MS);
        hold.addEventListener('click', function () {
          if (hold.dataset.held) { go(); return; }
          clearTimeout(t);
          clearInterval(tick);
          hold.dataset.held = '1';
          bar.style.transition = 'none';
          label.textContent = 'הזמן נעצר – אפשר לקרוא בנחת.';
          hold.textContent = nextText + ' ←';
          hold.classList.add('primary');
        });
      }, function (err) {
        busy(btnNext, false);
        opts.querySelectorAll('.option').forEach(function (o) { o.disabled = false; });
        timer = activeTimer(activeMs);
        toast(err.message, true);
        if (err.code === 'OUT_OF_ORDER' || err.code === 'NO_ATTEMPT') startQuiz();
      });
    });
  }

  var REVEAL_MS = 3000;
  var IDLE_MS = 90 * 1000; // אחרי 90 שניות בלי עכבר/מקלדת/מגע/גלילה – הזמן לא נספר

  /** מודד זמן פעיל בלבד: לא סופר כשהלשונית מוסתרת או כשאין פעילות של המשתמש */
  function activeTimer(startMs) {
    var active = startMs || 0;
    var last = Date.now();
    var lastAct = last;
    var evs = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    function act() { lastAct = Date.now(); }
    function tick() {
      var now = Date.now();
      var dt = now - last;
      last = now;
      if (document.visibilityState === 'visible' && now - lastAct < IDLE_MS) active += Math.min(dt, 2000);
    }
    evs.forEach(function (e) { window.addEventListener(e, act, { passive: true }); });
    document.addEventListener('visibilitychange', tick);
    var iv = setInterval(tick, 1000);
    return {
      stop: function () {
        tick();
        clearInterval(iv);
        evs.forEach(function (e) { window.removeEventListener(e, act); });
        document.removeEventListener('visibilitychange', tick);
        return Math.round(active);
      }
    };
  }

  /* ---------- איורים ---------- */
  function illus(name, cls) {
    return '<svg class="ill ' + (cls || '') + '" aria-hidden="true" focusable="false"><use href="#ill-' + name + '"/></svg>';
  }

  var TOPICS = [
    ['culture', /תרבית|בקבוק/],
    ['ivbag', /TPN|שקית|הזנה|פילטר|צנרת|הסט/],
    ['mask', /מסכה/],
    ['field', /שדה סטרילי|משטח|עגלה/],
    ['gloves', /כפפ/],
    ['hands', /היגיינ|הגיינ|ידיים/],
    ['catheter', /צנתר|חבישה|HUB|Needleless|לומן|חיטוי/]
  ];
  // נושא לפי נוסח השאלה, ואם אין התאמה – לפי התשובות ואז לפי התרחיש
  function topicOf(q) {
    var texts = [q.text, (q.answers || []).join(' '), q.context || ''];
    for (var t = 0; t < texts.length; t++) {
      for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i][1].test(texts[t])) return TOPICS[i][0];
    }
    return 'shield';
  }

  function showResult(rep) {
    var w = mount(tpl('result'));
    var score = Number(rep.score) || 0;
    text(w, '.r-score', score + '%');
    text(w, '.r-title', score >= 80 ? 'כל הכבוד, סיימת את הלומדה!' : 'סיימת את הלומדה');
    text(w, '.r-sub', 'ענית נכון על ' + rep.correct + ' מתוך ' + rep.total + ' שאלות');
    w.querySelector('.r-illus').innerHTML = illus(score >= 80 ? 'trophy' : 'shield', 'lg');
    setTimeout(function () {
      w.querySelector('.ring-fg').style.strokeDashoffset = String(326.7 * (1 - score / 100));
    });
    w.querySelector('.report-slot').appendChild(renderReport(rep));
    w.querySelector('#btnPrint').addEventListener('click', function () { window.print(); });
    w.querySelector('#btnAgain').addEventListener('click', function () { render('home'); });
  }

  /** דוח דו-טורי: פרטי העובד | רשימת השאלות ונכון/לא נכון */
  function renderReport(rep) {
    var node = tpl('report');
    var u = rep.user;
    text(node, '.rp-name', u.firstName + ' ' + u.lastName);
    text(node, '.rp-dept', u.department);
    text(node, '.rp-email', u.email);
    text(node, '.rp-date', fmtDate(rep.end || rep.start));
    text(node, '.rp-count', rep.correct + ' מתוך ' + rep.total);
    text(node, '.rp-score', rep.score === '' || rep.score == null ? '—' : rep.score + '%');
    text(node, '.rp-time', fmtDur(rep.activeSec));
    var list = node.querySelector('.rp-list');
    rep.items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = it.isCorrect ? 'ok' : 'bad';
      li.innerHTML = '<span class="n"></span><span><span class="qt"></span><span class="ans"></span></span><span class="badge"></span>';
      li.querySelector('.n').textContent = it.num;
      li.querySelector('.qt').textContent = it.question;
      li.querySelector('.ans').textContent = it.isCorrect ? '' : 'נבחר: ' + it.chosen + ' | נכון: ' + it.correctAnswer;
      li.querySelector('.badge').textContent = (it.isCorrect ? '✔ נכון' : '✘ לא נכון') + (it.sec != null && state.isAdmin ? ' · ' + fmtDur(it.sec) : '');
      list.appendChild(li);
    });
    return node;
  }

  /* ============================ דוחות – חישובים ============================ */

  function avgOf(arr) { return arr.length ? Math.round(arr.reduce(function (x, y) { return x + y; }, 0) / arr.length) : null; }

  // מספרים עם סימן/טווח בתוך טקסט עברי: עוטפים בבידוד LTR (U+2066…U+2069) כדי שיוצגו "+9" ולא "9+"
  function ltr(v) { return '⁦' + v + '⁩'; }
  function signed(n) { return n == null ? '—' : ltr((n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n)); }
  function range(d) { return d.avg == null ? '—' : ltr(d.min + '–' + d.max + '%'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : null; }

  /* ---------- זמני מענה ---------- */
  var TIMING = { fastRatio: 0.35, fastMinSec: 3, fastEmployeeShare: 0.4, wordsPerSec: 3 };
  function fmtDur(sec) {
    if (sec == null || sec === '') return '—';
    sec = Math.round(Number(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m ? m + ':' + (s < 10 ? '0' : '') + s + ' דק׳' : s + ' שנ׳';
  }
  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function expectedSec(q) {
    if (q.expectedSec) return q.expectedSec;
    var words = [q.context, q.text].concat(q.answers).join(' ').split(/\s+/).filter(String).length;
    return Math.max(4, Math.round(words / TIMING.wordsPerSec));
  }
  function isFast(sec, expected) { return sec != null && sec < Math.max(TIMING.fastMinSec, expected * TIMING.fastRatio); }
  /** עובד/ניסיון שמסומן כ"ענה בלי לקרוא" */
  function fastFlag(a) { return a.timed >= 5 && a.fast / a.timed >= TIMING.fastEmployeeShare; }


  function wingMap() {
    var m = {};
    (state.adminDepts || []).forEach(function (d) { m[d.name] = d.wing; });
    return m;
  }

  /** ציון מחלקתי: לכל עובד נספר הניסיון האחרון שהושלם */
  function deptStats(attempts, departments) {
    var latest = {};
    attempts.forEach(function (a) { // הניסיונות מגיעים מהחדש לישן
      if (a.status === 'הושלם' && a.score !== '' && !latest[a.email]) latest[a.email] = a;
    });
    var by = {};
    (departments || []).forEach(function (d) { by[d.name] = { name: d.name, wing: d.wing || '', registered: d.registered, scores: [] }; });
    Object.keys(latest).forEach(function (e) {
      var a = latest[e];
      var d = by[a.department] = by[a.department] || { name: a.department, wing: 'לא ברשימה', registered: 0, scores: [] };
      d.scores.push(Number(a.score));
    });
    var all = [];
    var list = Object.keys(by).map(function (k) {
      var d = by[k];
      all = all.concat(d.scores);
      d.done = d.scores.length;
      d.avg = avgOf(d.scores);
      d.min = d.done ? Math.min.apply(null, d.scores) : null;
      d.max = d.done ? Math.max.apply(null, d.scores) : null;
      d.registered = Math.max(d.registered, d.done);
      d.rate = pct(d.done, d.registered);
      return d;
    });
    var overall = avgOf(all);
    list.sort(function (x, y) {
      if (x.avg == null) return y.avg == null ? x.name.localeCompare(y.name, 'he') : 1;
      if (y.avg == null) return -1;
      return y.avg - x.avg || x.name.localeCompare(y.name, 'he');
    });
    var rank = 0;
    list.forEach(function (d) {
      d.rank = d.avg == null ? null : ++rank;
      d.diff = d.avg == null || overall == null ? null : d.avg - overall;
    });
    var wings = {};
    list.forEach(function (d) {
      var g = wings[d.wing] = wings[d.wing] || { name: d.wing, scores: [], registered: 0 };
      g.scores = g.scores.concat(d.scores);
      g.registered += d.registered;
    });
    var wingList = Object.keys(wings).sort(function (x, y) { return x.localeCompare(y, 'he'); }).map(function (k) {
      var g = wings[k];
      g.done = g.scores.length;
      g.avg = avgOf(g.scores);
      g.rate = pct(g.done, g.registered);
      g.diff = g.avg == null || overall == null ? null : g.avg - overall;
      return g;
    });
    var totalReg = list.reduce(function (x, d) { return x + d.registered; }, 0);
    return { list: list, wings: wingList, overall: overall, overallRate: pct(all.length, totalReg), ranked: rank, employees: all.length };
  }

  /**
   * ניתוח שאלות: לכל עובד נספר הניסיון האחרון שיש בו תשובות.
   * scope = { wing, dept } לסינון.
   */
  function questionStats(data, scope) {
    var wm = wingMap();
    var seen = {};
    var attempts = data.attempts.filter(function (a) {
      if (seen[a.email] || !Object.keys(a.answers || {}).length) return false;
      seen[a.email] = true;
      return true;
    }).filter(function (a) {
      if (scope.dept && a.department !== scope.dept) return false;
      if (scope.wing && (wm[a.department] || '') !== scope.wing) return false;
      return true;
    });
    var keyed = data.questions.filter(function (q) { return q.correct >= 0; });
    var totalAns = 0, totalWrong = 0;
    var qs = keyed.map(function (q) {
      var st = { q: q, n: 0, wrong: 0, dist: q.answers.map(function () { return 0; }), other: 0, byDept: {}, secs: [], fastN: 0, expected: expectedSec(q) };
      attempts.forEach(function (a) {
        var x = a.answers[q.num];
        if (!x) return;
        st.n++;
        if (!x.ok) st.wrong++;
        if (x.sec != null) {
          st.secs.push(x.sec);
          if (isFast(x.sec, st.expected)) st.fastN++;
        }
        var i = q.answers.indexOf(String(x.chosen).trim());
        if (i >= 0) st.dist[i]++; else st.other++;
        var d = st.byDept[a.department] = st.byDept[a.department] || { name: a.department, wing: wm[a.department] || '', n: 0, wrong: 0 };
        d.n++;
        if (!x.ok) d.wrong++;
      });
      st.err = pct(st.wrong, st.n);
      st.medSec = median(st.secs);
      st.ratio = st.medSec == null ? null : st.medSec / st.expected;
      var wrongOpts = st.dist.map(function (c, i) { return { i: i, c: c }; }).filter(function (o) { return o.i !== q.correct && o.c > 0; })
        .sort(function (x, y) { return y.c - x.c; });
      st.topWrong = wrongOpts[0] || null;
      totalAns += st.n;
      totalWrong += st.wrong;
      return st;
    });
    var ranked = qs.filter(function (s) { return s.n; }).sort(function (x, y) { return y.err - x.err || x.q.num - y.q.num; });
    // זמן מענה חריג: חציון הזמן ביחס לזמן הקריאה המשוער, גבוה משמעותית משאר השאלות
    var medRatio = median(qs.filter(function (s) { return s.secs.length >= 3; }).map(function (s) { return s.ratio; }));
    qs.forEach(function (s) { s.slow = s.secs.length >= 3 && medRatio != null && s.ratio >= Math.max(1.5, medRatio * 1.6); });
    return { attempts: attempts, questions: qs, ranked: ranked, accuracy: totalAns ? 100 - pct(totalWrong, totalAns) : null, answers: totalAns };
  }

  /** המלצות לשיפור – מחושבות מהנתונים בלבד (בלי תוכן קליני שלא הוזן ע"י הצוות) */
  function recommendations(st, overallErr) {
    var r = [];
    var q = st.q;
    if (st.n < 5) r.push({ level: 'info', text: 'מספר העונים קטן (' + st.n + '). כדאי להתייחס לנתונים בזהירות עד שיצטברו עוד תשובות.' });
    if (st.err >= 50) r.push({ level: 'high', text: 'שיעור טעויות גבוה מאוד (' + st.err + '%). מומלץ להגדיר את הנושא כנושא מרכזי בהדרכה הקרובה, בשילוב תרגול מעשי או הדגמה ליד המיטה.' });
    else if (st.err >= 30) r.push({ level: 'mid', text: 'שיעור טעויות גבוה (' + st.err + '%). מומלץ לחדד את הנושא בהדרכה ובתדריך מחלקתי.' });
    else if (st.n) r.push({ level: 'ok', text: 'רמת הידע בשאלה זו טובה (' + (100 - st.err) + '% ענו נכון).' });
    if (st.topWrong && st.n && st.topWrong.c / st.n >= 0.25) {
      r.push({ level: 'mid', text: 'טעות חוזרת: ' + pct(st.topWrong.c, st.n) + '% בחרו ב"' + q.answers[st.topWrong.i] + '". זה מצביע על תפיסה שגויה משותפת. כדאי להתייחס אליה במפורש בהדרכה ולהסביר מדוע היא שגויה.' });
    }
    var weak = Object.keys(st.byDept).map(function (k) { return st.byDept[k]; })
      .filter(function (d) { return d.n >= 2 && pct(d.wrong, d.n) >= Math.max(40, (st.err || 0) + 15); })
      .sort(function (x, y) { return pct(y.wrong, y.n) - pct(x.wrong, x.n); });
    if (weak.length) {
      r.push({ level: 'mid', text: 'מחלקות לחיזוק ממוקד: ' + weak.map(function (d) { return d.name + ' (' + pct(d.wrong, d.n) + '% טעויות)'; }).join(', ') +
        '. מומלץ לקיים הדרכה ממוקדת, למשל ביקור של אחות מניעת זיהומים או סימולציה.' });
    }
    if (st.slow) {
      r.push({ level: 'mid', text: 'זמן מענה ארוך במיוחד: החציון הוא ' + fmtDur(st.medSec) + ', לעומת כ-' + fmtDur(st.expected) +
        ' קריאה משוערת. זה עשוי להצביע על ניסוח לא ברור, תשובות דומות מדי או נושא קשה. כדאי לבדוק את נוסח השאלה והתשובות.' });
    }
    if (st.secs.length >= 3 && st.fastN / st.secs.length >= 0.3) {
      r.push({ level: 'info', text: pct(st.fastN, st.secs.length) + '% מהעונים ענו מהר מאוד (פחות מ-' + fmtDur(Math.max(TIMING.fastMinSec, Math.round(st.expected * TIMING.fastRatio))) +
        '), כנראה בלי לקרוא את השאלה עד הסוף.' });
    }
    if (!q.explanation) {
      r.push({ level: 'info', text: 'לשאלה אין עדיין הסבר. אפשר להוסיף הסבר והפניה לנוהל בגיליון "שאלות" (עמודה I), וכל עובד יראה אותו מיד אחרי שיענה.' });
    }
    return r;
  }

  /* ============================ דוחות – גרפים ============================ */

  // טולטיפ משותף לגרף: נצמד לעכבר, או לאלמנט כשמגיעים במקלדת
  function attachTip(host, el, lines) {
    var tip = host.querySelector('.ctip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'ctip';
      tip.setAttribute('role', 'tooltip');
      tip.hidden = true;
      host.appendChild(tip);
    }
    function show(e) {
      tip.innerHTML = '';
      lines().forEach(function (l, i) {
        var s = document.createElement(i ? 'span' : 'b');
        s.textContent = l;
        tip.appendChild(s);
      });
      tip.hidden = false;
      var hr = host.getBoundingClientRect();
      var x, y;
      if (e && e.clientX != null) { x = e.clientX - hr.left; y = e.clientY - hr.top; }
      else { var r = el.getBoundingClientRect(); x = r.left - hr.left + r.width / 2; y = r.top - hr.top; }
      var tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(hr.width - tw, x - tw / 2)) + 'px';
      tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px';
    }
    function hide() { tip.hidden = true; }
    el.addEventListener('mousemove', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', function () { show(null); });
    el.addEventListener('blur', hide);
  }

  /**
   * עמודות אנכיות (סדרה אחת). items: {label, sub, value, display, focus, dim, tip(), onClick}
   * opts: {mean, meanLabel}
   */
  function columnChart(host, items, opts) {
    host.innerHTML = '';
    if (!items.length) { host.innerHTML = '<p class="muted">אין עדיין נתונים להצגה.</p>'; return; }
    var plot = document.createElement('div');
    plot.className = 'vplot';
    plot.innerHTML = '<div class="vgrid"><span style="bottom:100%"><i>100%</i></span><span style="bottom:50%"><i>50%</i></span><span style="bottom:0"><i>0%</i></span></div>';
    var cols = document.createElement('div');
    cols.className = 'vcols';
    items.forEach(function (it) {
      var c = document.createElement('div');
      c.className = 'vcol' + (it.focus ? ' focus' : '') + (it.dim ? ' dim' : '');
      c.tabIndex = 0;
      c.setAttribute('role', it.onClick ? 'button' : 'img');
      c.setAttribute('aria-label', it.label + ': ' + it.display);
      c.innerHTML = '<span class="vval"></span><span class="vbar"></span>';
      c.querySelector('.vval').textContent = it.display;
      c.querySelector('.vbar').style.height = Math.max(it.value, 0.5) + '%';
      c.querySelector('.vval').style.bottom = 'calc(' + it.value + '% + 4px)';
      if (it.onClick) {
        c.addEventListener('click', it.onClick);
        c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.onClick(); } });
      }
      if (it.tip) attachTip(host, c, it.tip);
      cols.appendChild(c);
    });
    plot.appendChild(cols);
    if (opts.mean != null) {
      var m = document.createElement('div');
      m.className = 'vmean';
      m.style.bottom = opts.mean + '%';
      m.innerHTML = '<span></span>';
      m.firstChild.textContent = opts.meanLabel;
      plot.appendChild(m);
    }
    var labels = document.createElement('div');
    labels.className = 'vlabels';
    items.forEach(function (it) {
      var l = document.createElement('div');
      l.className = 'vlabel' + (it.focus ? ' focus' : '');
      l.innerHTML = '<span></span><small></small>';
      l.firstChild.textContent = it.label;
      l.lastChild.textContent = it.sub || '';
      labels.appendChild(l);
    });
    var wrap = document.createElement('div');
    wrap.className = 'vscroll';
    wrap.style.setProperty('--n', items.length);
    wrap.appendChild(plot);
    wrap.appendChild(labels);
    host.appendChild(wrap);
  }

  /** עמודות אופקיות (סדרה אחת). items: {label, sub, value, display, focus, dim, badge, tip(), onClick} */
  function barList(host, items) {
    host.innerHTML = '';
    if (!items.length) { host.innerHTML = '<p class="muted">אין עדיין נתונים להצגה.</p>'; return; }
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'hrow' + (it.focus ? ' focus' : '') + (it.dim ? ' dim' : '') + (it.onClick ? ' clickable' : '');
      row.tabIndex = 0;
      row.setAttribute('role', it.onClick ? 'button' : 'img');
      row.setAttribute('aria-label', it.label + ': ' + it.display);
      row.innerHTML = '<span class="hname"><span></span><small></small></span><span class="htrack"><span class="hbar"></span></span><span class="hval"></span>';
      row.querySelector('.hname span').textContent = it.label;
      row.querySelector('.hname small').textContent = it.sub || '';
      if (it.badge) {
        var b = document.createElement('em');
        b.className = 'badge-ok';
        b.textContent = it.badge;
        row.querySelector('.hname span').appendChild(b);
      }
      row.querySelector('.hbar').style.width = Math.max(it.value, 0.5) + '%';
      row.querySelector('.hval').textContent = it.display;
      if (it.onClick) {
        row.addEventListener('click', it.onClick);
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.onClick(); } });
      }
      if (it.tip) attachTip(host, row, it.tip);
      host.appendChild(row);
    });
  }

  /* ============================ מסך דוחות ============================ */

  screens.admin = function () {
    loading();
    state.exportData = null;
    api('adminList').then(function (res) {
      var w = mount(tpl('admin'));
      var all = res.attempts;
      state.adminDepts = res.departments || [];
      if (res.timing) TIMING = res.timing;
      var wm = wingMap();
      if (res.missingKeys && res.missingKeys.length) {
        var warn = document.createElement('p');
        warn.className = 'warn';
        warn.textContent = 'שימו לב: ' + res.missingKeys.length + ' שאלות עדיין בלי תשובה נכונה ולכן לא מוצגות לעובדים (שאלות ' + res.missingKeys.join(', ') + ').';
        w.querySelector('.admin-head').after(warn);
      }

      function fillSelect(sel, values) {
        values.forEach(function (v) { var o = document.createElement('option'); o.textContent = v; sel.appendChild(o); });
      }
      var wingNames = [];
      state.adminDepts.forEach(function (d) { if (wingNames.indexOf(d.wing) < 0) wingNames.push(d.wing); });
      var deptNames = state.adminDepts.map(function (d) { return d.name; });
      all.forEach(function (a) { if (a.department && deptNames.indexOf(a.department) < 0) deptNames.push(a.department); });

      // ---- לשוניות
      var tabs = w.querySelectorAll('.tab');
      var onTab = {};
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          tabs.forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
          w.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== t.dataset.tab; });
          store('set', 'rmcQuizAdminTab', t.dataset.tab);
          if (onTab[t.dataset.tab]) onTab[t.dataset.tab]();
        });
      });

      /* ---------- עובדים ---------- */
      var tbody = w.querySelector('.panel[data-panel=people] tbody');
      var search = w.querySelector('#adminSearch');
      var status = w.querySelector('#adminStatus');
      var deptSel = w.querySelector('#adminDept');
      fillSelect(deptSel, deptNames);

      function filtered() {
        var s = search.value.trim().toLowerCase();
        return all.filter(function (a) {
          if (status.value === 'fast') { if (!fastFlag(a)) return false; }
          else if (status.value && a.status !== status.value) return false;
          if (deptSel.value && a.department !== deptSel.value) return false;
          return !s || [a.firstName, a.lastName, a.department, a.email].join(' ').toLowerCase().indexOf(s) >= 0;
        });
      }

      function drawPeople() {
        var rows = filtered();
        var done = rows.filter(function (a) { return a.status === 'הושלם'; });
        var avg = avgOf(done.map(function (a) { return Number(a.score); }));
        var people = {};
        rows.forEach(function (a) { people[a.email] = 1; });
        w.querySelector('.panel[data-panel=people] .stats').innerHTML =
          stat(Object.keys(people).length, 'עובדים') + stat(done.length, 'שאלונים שהושלמו') +
          stat(rows.length - done.length, 'בתהליך') + stat(avg == null ? '—' : avg + '%', 'ציון ממוצע') +
          stat(fmtDur(median(done.filter(function (a) { return a.activeSec; }).map(function (a) { return a.activeSec; }))), 'זמן פעיל חציוני לשאלון') +
          stat(rows.filter(fastFlag).length, '⚡ מסומנים כמענה מהיר');
        tbody.innerHTML = '';
        if (!rows.length) tbody.innerHTML = '<tr><td colspan="7" class="muted">אין נתונים</td></tr>';
        rows.forEach(function (a) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td><span class="pill"></span></td><td></td><td></td><td><button class="link">צפייה בדוח</button></td>';
          var td = tr.children;
          td[0].textContent = fmtDate(a.end || a.start);
          td[1].textContent = a.firstName + ' ' + a.lastName;
          td[2].textContent = a.department;
          td[3].firstChild.textContent = a.status === 'הושלם' ? 'הושלם' : 'בתהליך (' + a.answered + '/' + a.total + ')';
          if (a.status === 'הושלם') td[3].firstChild.classList.add('done');
          td[4].textContent = a.score === '' ? '—' : a.score + '%';
          td[5].textContent = fmtDur(a.activeSec);
          if (fastFlag(a)) {
            var fl = document.createElement('span');
            fl.className = 'flag-fast';
            fl.textContent = '⚡ ' + pct(a.fast, a.timed) + '% מהיר';
            fl.title = 'ענה מהר מאוד על ' + a.fast + ' מתוך ' + a.timed + ' שאלות, כנראה בלי לקרוא';
            td[5].appendChild(fl);
          }
          td[6].firstChild.addEventListener('click', function () { openReport(a.id); });
          tbody.appendChild(tr);
        });
      }
      search.addEventListener('input', drawPeople);
      status.addEventListener('change', drawPeople);
      deptSel.addEventListener('change', drawPeople);
      drawPeople();

      /* ---------- השוואת מחלקות ---------- */
      var ds = deptStats(all, state.adminDepts);
      var focus = w.querySelector('#deptFocus');
      var wingF = w.querySelector('#wingFilter');
      var metric = store('get', 'rmcQuizDeptMetric') === 'rate' ? 'rate' : 'avg';
      fillSelect(wingF, ds.wings.map(function (g) { return g.name; }));
      function fillFocus() {
        var keep = focus.value;
        focus.innerHTML = '<option value="">ללא</option>';
        fillSelect(focus, ds.list.filter(function (d) { return !wingF.value || d.wing === wingF.value; }).map(function (d) { return d.name; }));
        focus.value = keep;
        if (focus.value !== keep) focus.value = '';
      }
      fillFocus();
      var savedFocus = store('get', 'rmcQuizDeptFocus');
      if (savedFocus && ds.list.some(function (d) { return d.name === savedFocus; })) focus.value = savedFocus;
      wingF.addEventListener('change', function () { fillFocus(); store('set', 'rmcQuizDeptFocus', focus.value); drawDepts(); });
      focus.addEventListener('change', function () { store('set', 'rmcQuizDeptFocus', focus.value); drawDepts(); });
      w.querySelectorAll('.seg [data-metric]').forEach(function (b) {
        b.setAttribute('aria-checked', b.dataset.metric === metric ? 'true' : 'false');
        b.addEventListener('click', function () {
          metric = b.dataset.metric;
          store('set', 'rmcQuizDeptMetric', metric);
          w.querySelectorAll('.seg [data-metric]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
          drawDepts();
        });
      });
      function pickDept(name) {
        if (focus.value === name) name = '';
        var d = ds.list.filter(function (x) { return x.name === name; })[0];
        if (d && wingF.value && d.wing !== wingF.value) { wingF.value = ''; fillFocus(); }
        focus.value = name;
        store('set', 'rmcQuizDeptFocus', name);
        drawDepts();
      }

      function drawDepts() {
        var f = ds.list.filter(function (d) { return d.name === focus.value; })[0];
        var box = w.querySelector('.dept-stats');
        var inWing = function (d) { return !wingF.value || d.wing === wingF.value; };
        if (f) {
          var fw = ds.wings.filter(function (g) { return g.name === f.wing; })[0];
          box.innerHTML = stat(f.avg == null ? '—' : f.avg + '%', 'ציון ממוצע – ' + esc(f.name)) +
            stat(ds.overall == null ? '—' : ds.overall + '%', 'ממוצע בית החולים') +
            stat(signed(f.diff), 'הפרש מהממוצע (נקודות)') +
            stat(f.rank ? f.rank + ' מתוך ' + ds.ranked : '—', 'דירוג בין המחלקות') +
            stat(f.done + ' מתוך ' + f.registered, 'השלימו מתוך הרשומים') +
            (fw ? stat(fw.avg == null ? '—' : fw.avg + '%', 'ממוצע ' + esc(fw.name)) : '');
        } else {
          box.innerHTML = stat(ds.overall == null ? '—' : ds.overall + '%', 'ממוצע בית החולים') +
            ds.wings.filter(function (g) { return !wingF.value || g.name === wingF.value; }).map(function (g) {
              return stat(g.avg == null ? '—' : g.avg + '%', 'ממוצע ' + esc(g.name) + (g.diff == null ? '' : ' (' + signed(g.diff) + ')'));
            }).join('') + stat(ds.employees, 'עובדים שהשלימו');
        }

        var isAvg = metric === 'avg';
        w.querySelector('.dchart-title').textContent = isAvg ? 'ציון ממוצע לפי מחלקה' : 'שיעור השלמה לפי מחלקה';
        w.querySelector('.dchart-note').textContent = (isAvg
          ? 'לכל עובד נספר הניסיון האחרון שהושלם'
          : 'עובדים שהשלימו מתוך העובדים הרשומים במחלקה') + ' · הקו המקווקו מסמן את ממוצע בית החולים · לחצו על עמודה כדי להדגיש מחלקה';
        var chartItems = ds.list.filter(inWing).filter(function (d) { return isAvg ? d.avg != null : d.rate != null; })
          .sort(function (x, y) { return isAvg ? 0 : y.rate - x.rate; })
          .map(function (d) {
            var v = isAvg ? d.avg : d.rate;
            return {
              label: d.name, sub: d.wing, value: v, display: v + '%',
              focus: d.name === focus.value, dim: !!focus.value && d.name !== focus.value,
              onClick: function () { pickDept(d.name); },
              tip: function () {
                return [d.name + ' · ' + d.wing,
                  'ציון ממוצע: ' + (d.avg == null ? '—' : d.avg + '% (' + signed(d.diff) + ' מהממוצע)'),
                  'השלימו: ' + d.done + ' מתוך ' + d.registered + ' רשומים (' + (d.rate == null ? '—' : d.rate + '%') + ')',
                  d.avg == null ? '' : 'טווח: ' + range(d) + ' · דירוג ' + d.rank + ' מתוך ' + ds.ranked].filter(String);
              }
            };
          });
        var mean = isAvg ? ds.overall : ds.overallRate;
        columnChart(w.querySelector('#deptChart'), chartItems, { mean: mean, meanLabel: mean == null ? '' : 'ממוצע ' + mean + '%' });

        var tb = w.querySelector('.dept-table tbody');
        tb.innerHTML = '';
        if (!ds.list.length) tb.innerHTML = '<tr><td colspan="9" class="muted">לא הוגדרו מחלקות</td></tr>';
        ds.list.filter(inWing).forEach(function (d) {
          var tr = document.createElement('tr');
          if (d.name === focus.value) tr.className = 'focus';
          [d.rank || '—', d.name, d.wing, d.avg == null ? '—' : d.avg + '%', signed(d.diff), d.done, d.registered,
            d.rate == null ? '—' : d.rate + '%', range(d)].forEach(function (v) {
            var td = document.createElement('td');
            td.textContent = v;
            tr.appendChild(td);
          });
          tb.appendChild(tr);
        });
      }
      onTab.depts = drawDepts;

      /* ---------- ניתוח שאלות (דריל-דאון) ---------- */
      var qWing = w.querySelector('#qWing');
      var qDept = w.querySelector('#qDept');
      var openQ = null;
      fillSelect(qWing, wingNames);
      function fillQDept() {
        var keep = qDept.value;
        qDept.innerHTML = '<option value="">כל המחלקות</option>';
        fillSelect(qDept, state.adminDepts.filter(function (d) { return !qWing.value || d.wing === qWing.value; }).map(function (d) { return d.name; }));
        qDept.value = keep;
        if (qDept.value !== keep) qDept.value = '';
      }
      fillQDept();
      var qMetric = store('get', 'rmcQuizQMetric') === 'time' ? 'time' : 'err';
      w.querySelectorAll('#qMetric [data-metric]').forEach(function (b) {
        b.setAttribute('aria-checked', b.dataset.metric === qMetric ? 'true' : 'false');
        b.addEventListener('click', function () {
          qMetric = b.dataset.metric;
          store('set', 'rmcQuizQMetric', qMetric);
          w.querySelectorAll('#qMetric [data-metric]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
          drawQuestions();
        });
      });
      qWing.addEventListener('change', function () { fillQDept(); drawQuestions(); });
      qDept.addEventListener('change', drawQuestions);

      function drawQuestions() {
        var chart = w.querySelector('#qChart');
        if (!state.exportData) {
          chart.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
          loadExportData().then(drawQuestions, function (err) { chart.innerHTML = ''; toast(err.message, true); });
          return;
        }
        var scope = { wing: qWing.value, dept: qDept.value };
        var qs = questionStats(state.exportData, scope);
        var worst = qs.ranked.slice(0, 3);
        w.querySelector('.q-stats').innerHTML =
          stat(qs.attempts.length, 'עובדים בניתוח') +
          stat(qs.accuracy == null ? '—' : qs.accuracy + '%', 'תשובות נכונות (מכל התשובות)') +
          stat(qs.ranked.filter(function (s) { return s.err >= 30; }).length, 'שאלות עם 30% טעויות ומעלה') +
          stat(worst.length ? 'שאלה ' + worst[0].q.num : '—', 'השאלה שטעו בה הכי הרבה') +
          stat(qs.questions.filter(function (s) { return s.slow; }).length, '⏱ שאלות עם זמן מענה חריג');

        var recs = w.querySelector('.q-recs');
        var hard = qs.ranked.filter(function (s) { return s.err >= 30; }).slice(0, 5);
        if (!qs.ranked.length) {
          recs.innerHTML = '';
        } else if (hard.length) {
          recs.innerHTML = '<h3>נושאים לחיזוק בהדרכה</h3><ol></ol><p class="muted small">לחצו על שאלה בגרף לניתוח מלא: התפלגות התשובות, פילוח לפי מחלקות והמלצות.</p>';
          hard.forEach(function (s) {
            var li = document.createElement('li');
            var b = document.createElement('button');
            b.className = 'link';
            b.textContent = 'שאלה ' + s.q.num + ': ' + s.q.text;
            b.addEventListener('click', function () { openDrill(s.q.num); });
            li.appendChild(b);
            var m = document.createElement('span');
            m.className = 'muted';
            m.textContent = s.err + '% טעויות (' + s.wrong + ' מתוך ' + s.n + ' עונים)';
            li.appendChild(m);
            recs.querySelector('ol').appendChild(li);
          });
        } else {
          recs.innerHTML = '<p class="ok-note">אין שאלה עם 30% טעויות או יותר. רמת הידע טובה בכל השאלות.</p>';
        }
        var slow = qs.questions.filter(function (s) { return s.slow; }).sort(function (x, y) { return y.ratio - x.ratio; });
        if (slow.length) {
          var sb = document.createElement('div');
          sb.innerHTML = '<h3>⏱ שאלות עם זמן מענה ארוך. כדאי לבדוק את הניסוח.</h3><ol></ol>';
          slow.forEach(function (s) {
            var li = document.createElement('li');
            var b = document.createElement('button');
            b.className = 'link';
            b.textContent = 'שאלה ' + s.q.num + ': ' + s.q.text;
            b.addEventListener('click', function () { openDrill(s.q.num); });
            li.appendChild(b);
            var m = document.createElement('span');
            m.className = 'muted';
            m.textContent = 'זמן חציוני ' + fmtDur(s.medSec) + ', לעומת כ-' + fmtDur(s.expected) + ' קריאה משוערת';
            li.appendChild(m);
            sb.querySelector('ol').appendChild(li);
          });
          recs.appendChild(sb);
        }

        var isTime = qMetric === 'time';
        w.querySelector('.qchart-title').textContent = isTime ? 'זמן מענה חציוני לפי שאלה' : 'שיעור טעויות לפי שאלה';
        w.querySelector('.qchart-note').textContent = isTime
          ? 'זמן פעיל בלבד, בלי זמן חוסר פעילות · ממוין לפי היחס לזמן הקריאה המשוער · ⏱ = זמן חריג · לחצו על שאלה לניתוח מעמיק'
          : 'ממוין מהשאלה שטעו בה הכי הרבה · לכל עובד נספר הניסיון האחרון · לחצו על שאלה לניתוח מעמיק';
        var timed = qs.questions.filter(function (s) { return s.medSec != null; }).sort(function (x, y) { return y.ratio - x.ratio; });
        var maxSec = Math.max.apply(null, timed.map(function (s) { return s.medSec; }).concat([1]));
        barList(chart, (isTime ? timed : qs.ranked).map(function (s) {
          if (isTime) {
            return {
              label: 'שאלה ' + s.q.num + (s.slow ? ' ⏱' : ''), sub: s.q.text, value: s.medSec / maxSec * 100, display: fmtDur(s.medSec),
              focus: s.slow || openQ === s.q.num, dim: false,
              onClick: function () { openDrill(s.q.num); },
              tip: function () {
                return ['שאלה ' + s.q.num + (s.slow ? ' · זמן מענה חריג' : ''), 'זמן מענה חציוני: ' + fmtDur(s.medSec),
                  'זמן קריאה משוער: ' + fmtDur(s.expected), 'ענו מהר מדי: ' + s.fastN + ' מתוך ' + s.secs.length];
              }
            };
          }
          return {
            label: 'שאלה ' + s.q.num + (s.slow ? ' ⏱' : ''), sub: s.q.text, value: s.err, display: s.err + '%',
            focus: openQ === s.q.num, dim: openQ != null && openQ !== s.q.num,
            onClick: function () { openDrill(s.q.num); },
            tip: function () {
              return ['שאלה ' + s.q.num, s.err + '% טעויות · ' + s.wrong + ' מתוך ' + s.n + ' עונים',
                s.topWrong ? 'הטעות הנפוצה: ' + s.q.answers[s.topWrong.i] : 'אין טעות חוזרת'];
            }
          };
        }));

        if (openQ != null) renderDrill(qs, openQ); else w.querySelector('#qDrill').hidden = true;
      }

      function openDrill(num) {
        openQ = num;
        drawQuestions();
        var d = w.querySelector('#qDrill');
        if (!d.hidden) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function renderDrill(qs, num) {
        var host = w.querySelector('#qDrill');
        var st = qs.questions.filter(function (s) { return s.q.num === num; })[0];
        if (!st) { host.hidden = true; return; }
        var q = st.q;
        host.hidden = false;
        host.innerHTML =
          '<div class="drill-head"><h2></h2><button class="btn ghost" type="button">סגירה</button></div>' +
          '<div class="context" hidden><span class="context-tag">תרחיש</span><p class="context-text"></p></div>' +
          '<p class="drill-q"></p>' +
          '<div class="stats d-stats"></div>' +
          '<div class="drill-grid">' +
          '<figure class="chart-card"><figcaption><b>מה ענו העובדים</b><span class="muted small">אחוז העונים שבחרו בכל תשובה · ✓ = התשובה הנכונה</span></figcaption><div class="hbars d-dist"></div></figure>' +
          '<figure class="chart-card"><figcaption><b>שיעור טעויות לפי מחלקה</b><span class="muted small">בשאלה זו בלבד · הקו המקווקו = שיעור הטעויות הכללי בשאלה</span></figcaption><div class="vchart d-depts"></div></figure>' +
          '</div>' +
          '<div class="recs d-recs"><h3>המלצות לשיפור רמת הידע</h3><ul></ul></div>' +
          '<div class="explain" hidden><h3>הסבר / הפניה לנוהל</h3><p></p></div>';
        host.querySelector('h2').textContent = 'ניתוח שאלה ' + q.num;
        host.querySelector('.drill-head button').addEventListener('click', function () { openQ = null; drawQuestions(); });
        if (q.context) {
          host.querySelector('.context').hidden = false;
          host.querySelector('.context-text').textContent = q.context;
        }
        host.querySelector('.drill-q').textContent = q.text;
        host.querySelector('.d-stats').innerHTML =
          stat(st.n, 'עונים') + stat(st.err == null ? '—' : st.err + '%', 'שיעור טעויות') +
          stat(st.n ? 100 - st.err + '%' : '—', 'ענו נכון') +
          stat(qs.ranked.indexOf(st) >= 0 ? (qs.ranked.indexOf(st) + 1) + ' מתוך ' + qs.ranked.length : '—', 'דירוג קושי') +
          stat(fmtDur(st.medSec) + (st.slow ? ' ⏱' : ''), 'זמן מענה חציוני (קריאה משוערת ' + fmtDur(st.expected) + ')') +
          stat(st.secs.length ? pct(st.fastN, st.secs.length) + '%' : '—', 'ענו מהר מדי');

        barList(host.querySelector('.d-dist'), q.answers.map(function (a, i) {
          var c = st.dist[i];
          var p = pct(c, st.n) || 0;
          return {
            label: a, value: p, display: p + '%', badge: i === q.correct ? '✓ נכונה' : '',
            focus: i === q.correct, dim: false,
            tip: function () { return [i === q.correct ? 'התשובה הנכונה' : 'תשובה שגויה', c + ' מתוך ' + st.n + ' עונים (' + p + '%)']; }
          };
        }));

        var deptItems = Object.keys(st.byDept).map(function (k) { return st.byDept[k]; })
          .sort(function (x, y) { return pct(y.wrong, y.n) - pct(x.wrong, x.n) || x.name.localeCompare(y.name, 'he'); })
          .map(function (d) {
            var e = pct(d.wrong, d.n);
            return {
              label: d.name, sub: d.wing + ' · n=' + d.n, value: e, display: e + '%',
              tip: function () { return [d.name, e + '% טעויות · ' + d.wrong + ' מתוך ' + d.n + ' עונים']; }
            };
          });
        columnChart(host.querySelector('.d-depts'), deptItems, { mean: st.err, meanLabel: st.err == null ? '' : 'כללי ' + st.err + '%' });

        var ul = host.querySelector('.d-recs ul');
        recommendations(st).forEach(function (r) {
          var li = document.createElement('li');
          li.className = 'rec-' + r.level;
          li.textContent = r.text;
          ul.appendChild(li);
        });
        if (q.explanation) {
          host.querySelector('.explain').hidden = false;
          host.querySelector('.explain p').textContent = q.explanation;
        }
      }
      onTab.questions = drawQuestions;

      var savedTab = store('get', 'rmcQuizAdminTab');
      var startTab = savedTab && w.querySelector('.tab[data-tab="' + savedTab + '"]');
      if (startTab) startTab.click();

      w.querySelector('#btnBackHome').addEventListener('click', function () { render('home'); });
      w.querySelector('#btnXlsx').addEventListener('click', function () {
        var ids = {};
        filtered().forEach(function (a) { ids[a.id] = 1; });
        openExportDialog(function (a) { return ids[a.id]; });
      });
    }, function (err) { toast(err.message, true); render('home'); });
  };

  function loadExportData() {
    if (state.exportData) return Promise.resolve(state.exportData);
    return api('adminExport').then(function (d) { state.exportData = d; return d; });
  }

  function stat(v, label) { return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>'; }

  function openReport(id) {
    var dlg = document.getElementById('reportDialog');
    var body = dlg.querySelector('.dialog-body');
    body.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
    dlg.showModal();
    var xbtn = document.getElementById('dlgXlsx');
    xbtn.disabled = true;
    api('adminReport', { attemptId: id }).then(function (res) {
      body.innerHTML = '';
      body.appendChild(renderReport(res.report));
      xbtn.disabled = false;
      xbtn.onclick = function () { exportOneExcel(res.report, xbtn); };
    }, function (err) { dlg.close(); toast(err.message, true); });
  }

  /* ---------- ייצוא לאקסל (xlsx, גיליונות מימין לשמאל) ---------- */

  var xlsxLoading;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    xlsxLoading = xlsxLoading || new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.mini.min.js';
      s.onload = ok;
      s.onerror = function () { xlsxLoading = null; fail(new Error('טעינת רכיב האקסל נכשלה')); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  function sheet(rows, widths) {
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(function (w) { return { wch: w }; });
    return ws;
  }

  function saveWorkbook(wb, name) {
    wb.Workbook = { Views: [{ RTL: true }] }; // כל הגיליונות בכיוון ימין-לשמאל
    XLSX.writeFile(wb, name + '.xlsx', { compression: true });
  }

  function stamp() { return new Date().toISOString().slice(0, 10); }

  /** חלון בחירת גיליונות לייצוא. הבחירה נשמרת לפעם הבאה. */
  function openExportDialog(filter) {
    var dlg = document.getElementById('exportDialog');
    var form = dlg.querySelector('form');
    var saved = {};
    try { saved = JSON.parse(store('get', 'rmcQuizExportOpts') || '{}') || {}; } catch (e) { saved = {}; }
    Object.keys(saved).forEach(function (k) { if (form.elements[k]) form.elements[k].checked = !!saved[k]; });
    var sub = form.elements.matrixChosen;
    function syncSub() { sub.disabled = !form.elements.matrix.checked; }
    form.elements.matrix.onchange = syncSub;
    syncSub();
    // מטפלים ב-submit (ולא באירוע close של הדיאלוג, שלא תמיד נורה בכל הדפדפנים)
    form.onsubmit = function (e) {
      if (!e.submitter || e.submitter.value !== 'ok') return;
      var opts = {};
      ['summary', 'depts', 'answers', 'matrix', 'matrixChosen', 'analysis', 'questions'].forEach(function (k) { opts[k] = form.elements[k].checked; });
      store('set', 'rmcQuizExportOpts', JSON.stringify(opts));
      if (!opts.summary && !opts.depts && !opts.answers && !opts.matrix && !opts.analysis && !opts.questions) {
        toast('לא נבחר אף גיליון', true);
        return;
      }
      exportExcel(filter, opts, document.getElementById('btnXlsx'));
    };
    dlg.showModal();
  }

  /** קובץ אקסל לפי הגיליונות שנבחרו */
  function exportExcel(filter, opts, btn) {
    busy(btn, true);
    Promise.all([loadXlsx(), loadExportData()]).then(function (r) {
      var data = r[1];
      if (data.timing) TIMING = data.timing;
      var wm = wingMap();
      var rows = data.attempts.filter(filter);
      var id = function (a) { return [fmtDate(a.end || a.start), a.firstName, a.lastName, wm[a.department] || '', a.department, a.email]; };
      var idHead = ['תאריך', 'שם פרטי', 'שם משפחה', 'אגף', 'מחלקה', 'אימייל'];
      var idW = [16, 12, 14, 12, 18, 28];
      var keyed = data.questions.filter(function (q) { return q.correct >= 0; });
      var wb = XLSX.utils.book_new();

      if (opts.summary) {
        var timingOf = function (a) {
          var n = 0, f = 0;
          data.questions.forEach(function (q) {
            var x = a.answers[q.num];
            if (x && x.sec != null) { n++; if (isFast(x.sec, expectedSec(q))) f++; }
          });
          return { timed: n, fast: f };
        };
        var summary = [idHead.concat(['סטטוס', 'נענו', 'תשובות נכונות', 'סה"כ שאלות', 'ציון %', 'זמן פעיל (דקות)', 'תשובות מהירות מדי %', 'סימון'])].concat(rows.map(function (a) {
          var t = timingOf(a);
          return id(a).concat([a.status, a.answered, a.correct, a.total, a.score === '' ? '' : Number(a.score),
            a.activeSec == null ? '' : Math.round(a.activeSec / 6) / 10, t.timed ? pct(t.fast, t.timed) : '',
            fastFlag(t) ? 'מענה מהיר חשוד' : '']);
        }));
        XLSX.utils.book_append_sheet(wb, sheet(summary, idW.concat([10, 7, 13, 11, 8, 14, 18, 16])), 'סיכום');
      }

      if (opts.depts) {
        var ds = deptStats(data.attempts, state.adminDepts);
        var deptRows = [['דירוג', 'מחלקה', 'אגף', 'ציון ממוצע %', 'הפרש מממוצע בית החולים', 'השלימו', 'רשומים', 'שיעור השלמה %', 'ציון מינימלי', 'ציון מקסימלי']]
          .concat(ds.list.map(function (d) {
            return [d.rank || '', d.name, d.wing, d.avg == null ? '' : d.avg, d.diff == null ? '' : d.diff, d.done, d.registered,
              d.rate == null ? '' : d.rate, d.min == null ? '' : d.min, d.max == null ? '' : d.max];
          }))
          .concat([[], ['', 'אגף', '', 'ציון ממוצע %', 'הפרש מממוצע בית החולים', 'השלימו', 'רשומים', 'שיעור השלמה %']])
          .concat(ds.wings.map(function (g) {
            return ['', g.name, '', g.avg == null ? '' : g.avg, g.diff == null ? '' : g.diff, g.done, g.registered, g.rate == null ? '' : g.rate];
          }))
          .concat([[], ['', 'ממוצע בית החולים', '', ds.overall == null ? '' : ds.overall], ['', 'לכל עובד נספר הניסיון האחרון שהושלם. ההשוואה כוללת את כל העובדים (לא רק המסוננים).']]);
        XLSX.utils.book_append_sheet(wb, sheet(deptRows, [7, 26, 14, 13, 22, 9, 9, 15, 12, 12]), 'השוואת מחלקות');
      }

      if (opts.answers) {
        var long = [idHead.concat(['סטטוס הניסיון', 'ציון הניסיון %', 'מס׳ שאלה', 'שאלה', 'התשובה שנבחרה', 'התשובה הנכונה', 'תוצאה', 'זמן מענה (שניות)', 'מהיר מדי?'])];
        rows.forEach(function (a) {
          data.questions.forEach(function (q) {
            var x = a.answers[q.num];
            if (!x) return;
            long.push(id(a).concat([a.status, a.score === '' ? '' : Number(a.score), q.num, q.text, x.chosen, x.correct, x.ok ? 'נכון' : 'לא נכון',
              x.sec == null ? '' : x.sec, x.sec == null ? '' : (isFast(x.sec, expectedSec(q)) ? 'כן' : '')]));
          });
        });
        XLSX.utils.book_append_sheet(wb, sheet(long, idW.concat([12, 12, 8, 60, 45, 45, 9, 14, 10])), 'כל התשובות');
      }

      if (opts.matrix) {
        var matrix = [idHead.concat(['ציון %'], keyed.map(function (q) { return 'שאלה ' + q.num; }))].concat(rows.map(function (a) {
          return id(a).concat([a.score === '' ? '' : Number(a.score)], keyed.map(function (q) {
            var x = a.answers[q.num];
            if (!x) return '';
            return opts.matrixChosen ? (x.ok ? '✓ ' : '✗ ') + x.chosen : (x.ok ? 'נכון' : 'לא נכון');
          }));
        }));
        XLSX.utils.book_append_sheet(wb, sheet(matrix, idW.concat([8], keyed.map(function () { return opts.matrixChosen ? 30 : 9; }))), 'עובדים × שאלות');
      }

      if (opts.analysis) {
        var qs = questionStats({ questions: data.questions, attempts: rows }, {});
        var maxOpts = Math.max.apply(null, keyed.map(function (q) { return q.answers.length; }).concat([4]));
        var head = ['דירוג קושי', 'מס׳ שאלה', 'שאלה', 'עונים', 'טעויות', 'שיעור טעויות %', 'התשובה הנכונה', 'הטעות הנפוצה', '% שבחרו בטעות הנפוצה',
          'זמן מענה חציוני (שניות)', 'זמן קריאה משוער (שניות)', 'זמן מענה חריג?', 'ענו מהר מדי %'];
        for (var i = 0; i < maxOpts; i++) head.push('% שבחרו בתשובה ' + (i + 1));
        var an = [head].concat(qs.ranked.map(function (s, k) {
          var row = [k + 1, s.q.num, s.q.text, s.n, s.wrong, s.err, s.q.answers[s.q.correct],
            s.topWrong ? s.q.answers[s.topWrong.i] : '', s.topWrong ? pct(s.topWrong.c, s.n) : '',
            s.medSec == null ? '' : Math.round(s.medSec), s.expected, s.slow ? 'כן – לבדוק ניסוח' : '', s.secs.length ? pct(s.fastN, s.secs.length) : ''];
          for (var j = 0; j < maxOpts; j++) row.push(j < s.dist.length ? pct(s.dist[j], s.n) : '');
          return row;
        }));
        an.push([], ['', '', 'לכל עובד נספר הניסיון האחרון שיש בו תשובות, מתוך העובדים המסוננים.'],
          ['', '', 'זמן מענה = זמן פעיל בלבד (בלי זמן שבו הלשונית מוסתרת או שאין פעילות 90 שניות). זמן קריאה משוער = מספר המילים חלקי ' + TIMING.wordsPerSec + ' מילים לשנייה.'],
          ['', '', 'זמן חריג = חציון הזמן ביחס לזמן הקריאה גבוה פי 1.6 ומעלה מהיחס החציוני של כל השאלות. מהיר מדי = פחות מ-' + Math.round(TIMING.fastRatio * 100) + '% מזמן הקריאה.']);
        var aw = [9, 8, 60, 7, 7, 13, 40, 40, 14, 14, 14, 16, 12];
        for (var t = 0; t < maxOpts; t++) aw.push(12);
        XLSX.utils.book_append_sheet(wb, sheet(an, aw), 'ניתוח שאלות');
      }

      if (opts.questions) {
        var qrows = [['מס׳', 'רקע / תרחיש', 'שאלה', 'תשובה 1', 'תשובה 2', 'תשובה 3', 'תשובה 4', 'התשובה הנכונה', 'הסבר / הפניה לנוהל']]
          .concat(data.questions.map(function (q) {
            return [q.num, q.context, q.text, q.answers[0] || '', q.answers[1] || '', q.answers[2] || '', q.answers[3] || '',
              q.correct >= 0 ? q.answers[q.correct] : '(לא סומנה)', q.explanation || ''];
          }));
        XLSX.utils.book_append_sheet(wb, sheet(qrows, [6, 50, 60, 35, 35, 35, 35, 35, 50]), 'שאלות');
      }

      saveWorkbook(wb, 'דוח לומדה ' + stamp());
    }).catch(function (err) { toast(err.message, true); }).then(function () { busy(btn, false); });
  }

  /** דוח דו-טורי של עובד אחד */
  function exportOneExcel(rep, btn) {
    busy(btn, true);
    loadXlsx().then(function () {
      var u = rep.user;
      var rows = [
        ['דוח לומדה – מניעת זיהומים'], [],
        ['שם', u.firstName + ' ' + u.lastName],
        ['מחלקה', u.department],
        ['אימייל', u.email],
        ['תאריך', fmtDate(rep.end || rep.start)],
        ['תשובות נכונות', rep.correct + ' מתוך ' + rep.total],
        ['ציון %', rep.score === '' ? '' : Number(rep.score)],
        [],
        ['מס׳', 'שאלה', 'תוצאה', 'תשובה שנבחרה', 'תשובה נכונה']
      ].concat(rep.items.map(function (it) {
        return [it.num, it.question, it.isCorrect ? 'נכון' : 'לא נכון', it.chosen, it.correctAnswer];
      }));
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet(rows, [14, 70, 10, 45, 45]), 'דוח עובד');
      saveWorkbook(wb, 'דוח ' + u.firstName + ' ' + u.lastName + ' ' + stamp());
    }).catch(function (err) { toast(err.message, true); }).then(function () { busy(btn, false); });
  }

  function render(name) {
    (screens[name] || screens.login)();
  }

  /* ============================ init ============================ */

  document.getElementById('btnLogout').addEventListener('click', function () {
    api('logout').catch(function () {});
    setToken(null);
    state.user = null;
    state.isAdmin = false;
    updateHeader();
    render('login');
  });
  document.getElementById('btnAdmin').addEventListener('click', function () { render('admin'); });
  document.getElementById('dlgClose').addEventListener('click', function () { document.getElementById('reportDialog').close(); });
  document.getElementById('dlgPrint').addEventListener('click', function () { window.print(); });

  function init() {
    loading();
    api('config').then(function (cfg) {
      state.config = cfg;
      if (cfg.title) document.getElementById('appTitle').textContent = cfg.title;
    }).catch(function () {}).then(function () {
      if (!state.token) return render('login');
      api('me').then(function (res) {
        state.user = res.user;
        state.isAdmin = res.isAdmin;
        updateHeader();
        render(landing());
      }, function () { setToken(null); render('login'); });
    });
  }

  if (DEMO) {
    document.getElementById('demoBanner').hidden = false;
    var s = document.createElement('script');
    s.src = 'demo-data.js';
    s.onload = init;
    document.body.appendChild(s);
  } else {
    init();
  }

  /* ============================ מצב הדגמה (ללא שרת) ============================ */

  function demoApi(req) {
    var db;
    try { db = JSON.parse(localStorage.getItem('rmcQuizDemo')) || {}; } catch (e) { db = {}; }
    db.users = db.users || {};
    db.attempts = db.attempts || [];
    var DEMO_DEPTS = [
      { name: 'טיפול נמרץ ילדים', wing: 'אגף ילדים' }, { name: 'טיפול נמרץ פגים', wing: 'אגף ילדים' },
      { name: 'טיפול נמרץ כללי', wing: 'אגף כללי' }, { name: "פנימית א'", wing: 'אגף כללי' },
      { name: "פנימית ב'", wing: 'אגף כללי' }, { name: "פנימית ג'", wing: 'אגף כללי' }
    ];
    var Q = (window.DEMO_QUESTIONS || []).filter(function (q) { return q.correct != null; });
    function pub(q) { return { num: q.num, context: q.context, text: q.text, answers: q.answers }; }
    function save() { try { localStorage.setItem('rmcQuizDemo', JSON.stringify(db)); } catch (e) {} }
    function err(m, c) { return { ok: false, error: m, code: c }; }
    function me() { return db.session && db.session === req.token ? db.users[db.sessionEmail] : null; }
    function report(a) {
      return { attemptId: a.id, user: a.user, start: a.start, end: a.end, status: a.status, correct: a.correct, total: Q.length, score: a.score, items: a.items, activeSec: a.activeSec };
    }
    var res = (function () {
      switch (req.action) {
        case 'config': return { ok: true, domain: 'rmc.gov.il', departments: [], title: '' };
        case 'register':
          db.users[req.email.toLowerCase()] = { email: req.email.toLowerCase(), firstName: req.firstName, lastName: req.lastName, department: '', password: req.password };
          return { ok: true, message: 'הדגמה: קוד האימות הוא 123456' };
        case 'verify': case 'resetPassword':
          if (req.code !== '123456') return err('קוד שגוי (בהדגמה: 123456)');
          if (req.password) db.users[req.email].password = req.password;
          db.session = 'demo-' + Date.now(); db.sessionEmail = req.email;
          return { ok: true, token: db.session, user: db.users[req.email], isAdmin: true };
        case 'resendCode': case 'forgot': return { ok: true, message: 'הדגמה: הקוד הוא 123456' };
        case 'login':
          var u = db.users[String(req.email).toLowerCase()];
          if (!u || u.password !== req.password) return err('אימייל או סיסמה שגויים');
          db.session = 'demo-' + Date.now(); db.sessionEmail = u.email;
          return { ok: true, token: db.session, user: u, isAdmin: true };
        case 'logout': db.session = null; return { ok: true };
        case 'me': return me() ? { ok: true, user: me(), isAdmin: true } : err('פג תוקף', 'AUTH');
        case 'departments': return me() ? { ok: true, departments: DEMO_DEPTS } : err('פג תוקף', 'AUTH');
        case 'setDepartment':
          if (!me()) return err('פג תוקף', 'AUTH');
          if (!DEMO_DEPTS.some(function (d) { return d.name === req.department; })) return err('יש לבחור מחלקה מהרשימה');
          me().department = req.department;
          return { ok: true, user: me() };
      }
      var user = me();
      if (!user) return err('פג תוקף ההתחברות', 'AUTH');
      var open = db.attempts.filter(function (a) { return a.user.email === user.email && a.status === 'בתהליך'; })[0];
      switch (req.action) {
        case 'start':
          if (!open) { open = { id: 'demo-' + Date.now(), user: user, start: new Date().toISOString(), status: 'בתהליך', answered: 0, correct: 0, items: [] }; db.attempts.push(open); }
          return { ok: true, attemptId: open.id, index: open.answered, total: Q.length, correctSoFar: open.correct, question: pub(Q[open.answered]) };
        case 'answer':
          if (!open || req.index !== open.answered) return err('השאלה כבר נענתה', 'OUT_OF_ORDER');
          var q = Q[req.index], ok = req.choice === q.correct, sec = Math.round((req.activeMs || 0) / 1000);
          open.items.push({ num: q.num, question: q.text, chosen: q.answers[req.choice], correctAnswer: q.answers[q.correct], isCorrect: ok, sec: sec });
          open.activeSec = (open.activeSec || 0) + sec;
          open.answered++; if (ok) open.correct++;
          var r = { ok: true, correct: ok, correctIndex: q.correct, explanation: q.num === 1 ? 'הדגמה: הגיינת ידיים היא הפעולה הראשונה לפני כל מגע במטופל.' : '', correctSoFar: open.correct };
          if (open.answered >= Q.length) {
            open.status = 'הושלם'; open.end = new Date().toISOString(); open.score = Math.round(open.correct / Q.length * 100);
            r.finished = true; r.score = open.score; r.report = report(open);
          } else r.next = pub(Q[open.answered]);
          return r;
        case 'adminList':
          return { ok: true, departments: DEMO_DEPTS.map(function (d) {
            return { name: d.name, wing: d.wing, registered: Object.keys(db.users).filter(function (e) { return db.users[e].department === d.name; }).length };
          }), missingKeys: (window.DEMO_QUESTIONS || []).filter(function (q) { return q.correct == null; }).map(function (q) { return q.num; }), attempts: db.attempts.slice().reverse().map(function (a) {
            return { id: a.id, email: a.user.email, firstName: a.user.firstName, lastName: a.user.lastName, department: a.user.department,
              start: a.start, end: a.end, status: a.status, answered: a.answered, correct: a.correct, total: Q.length, score: a.score == null ? '' : a.score,
              activeSec: a.activeSec == null ? null : a.activeSec,
              timed: a.items.filter(function (it) { return it.sec != null; }).length,
              fast: a.items.filter(function (it) { var q = Q.filter(function (x) { return x.num === it.num; })[0]; return it.sec != null && q && isFast(it.sec, expectedSec(q)); }).length };
          }) };
        case 'adminExport':
          return { ok: true, questions: (window.DEMO_QUESTIONS || []).map(function (q) { return { num: q.num, context: q.context, text: q.text, answers: q.answers, correct: q.correct == null ? -1 : q.correct, explanation: q.num === 1 ? 'הדגמה: הגיינת ידיים היא הפעולה הראשונה לפני כל מגע במטופל (5 הרגעים של WHO).' : '' }; }), attempts: db.attempts.slice().reverse().map(function (a) {
            var ans = {};
            a.items.forEach(function (it) { ans[it.num] = { ok: it.isCorrect, chosen: it.chosen, correct: it.correctAnswer, sec: it.sec == null ? null : it.sec }; });
            return { id: a.id, email: a.user.email, firstName: a.user.firstName, lastName: a.user.lastName, department: a.user.department,
              start: a.start, end: a.end, status: a.status, answered: a.answered, correct: a.correct, total: Q.length, score: a.score == null ? '' : a.score, activeSec: a.activeSec == null ? null : a.activeSec, answers: ans };
          }) };
        case 'adminReport':
          return { ok: true, report: report(db.attempts.filter(function (a) { return a.id === req.attemptId; })[0]) };
      }
      return err('פעולה לא מוכרת');
    })();
    save();
    return new Promise(function (ok) { setTimeout(function () { ok(res); }, 250); });
  }
})();
