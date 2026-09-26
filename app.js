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

    var letters = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
    var opts = w.querySelector('.options');
    var selected = -1;
    var btnCheck = w.querySelector('#btnCheck');
    var btnNext = w.querySelector('#btnNext');

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
        btnCheck.disabled = false;
      });
      opts.appendChild(b);
    });

    btnCheck.addEventListener('click', function () {
      if (selected < 0) return;
      busy(btnCheck, true);
      api('answer', { attemptId: qz.attemptId, index: qz.index, choice: selected }).then(function (res) {
        var all = opts.querySelectorAll('.option');
        all.forEach(function (o, j) {
          o.disabled = true;
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
        btnCheck.hidden = true;
        btnNext.hidden = false;
        btnNext.textContent = res.finished ? 'לסיכום ולציון' : 'לשאלה הבאה';
        btnNext.focus();
        w.querySelector('.progress-bar').style.width = ((qz.index + 1) / qz.total * 100) + '%';
        btnNext.addEventListener('click', function () {
          if (res.finished) {
            showResult(res.report);
          } else {
            state.quiz = { attemptId: qz.attemptId, index: qz.index + 1, total: qz.total, correctSoFar: res.correctSoFar, question: res.next };
            showQuestion();
          }
        });
      }, function (err) {
        busy(btnCheck, false);
        toast(err.message, true);
        if (err.code === 'OUT_OF_ORDER' || err.code === 'NO_ATTEMPT') startQuiz();
      });
    });
  }

  function showResult(rep) {
    var w = mount(tpl('result'));
    var score = Number(rep.score) || 0;
    text(w, '.r-score', score + '%');
    text(w, '.r-title', score >= 80 ? 'כל הכבוד, סיימת את הלומדה!' : 'סיימת את הלומדה');
    text(w, '.r-sub', 'ענית נכון על ' + rep.correct + ' מתוך ' + rep.total + ' שאלות');
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
    var list = node.querySelector('.rp-list');
    rep.items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = it.isCorrect ? 'ok' : 'bad';
      li.innerHTML = '<span class="n"></span><span><span class="qt"></span><span class="ans"></span></span><span class="badge"></span>';
      li.querySelector('.n').textContent = it.num;
      li.querySelector('.qt').textContent = it.question;
      li.querySelector('.ans').textContent = it.isCorrect ? '' : 'נבחר: ' + it.chosen + ' | נכון: ' + it.correctAnswer;
      li.querySelector('.badge').textContent = it.isCorrect ? '✔ נכון' : '✘ לא נכון';
      list.appendChild(li);
    });
    return node;
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
      d.avg = d.done ? Math.round(d.scores.reduce(function (x, y) { return x + y; }, 0) / d.done) : null;
      d.min = d.done ? Math.min.apply(null, d.scores) : null;
      d.max = d.done ? Math.max.apply(null, d.scores) : null;
      d.registered = Math.max(d.registered, d.done);
      d.rate = d.registered ? Math.round(d.done / d.registered * 100) : null;
      return d;
    });
    var overall = all.length ? Math.round(all.reduce(function (x, y) { return x + y; }, 0) / all.length) : null;
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
      g.avg = g.done ? Math.round(g.scores.reduce(function (x, y) { return x + y; }, 0) / g.done) : null;
      g.diff = g.avg == null || overall == null ? null : g.avg - overall;
      return g;
    });
    return { list: list, wings: wingList, overall: overall, ranked: rank, employees: all.length };
  }

  // מספרים עם סימן/טווח בתוך טקסט עברי: עוטפים בבידוד LTR (U+2066…U+2069) כדי שיוצגו "+9" ולא "9+"
  function ltr(v) { return '⁦' + v + '⁩'; }
  function signed(n) { return n == null ? '—' : ltr((n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n)); }
  function range(d) { return d.avg == null ? '—' : ltr(d.min + '–' + d.max + '%'); }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  screens.admin = function () {
    loading();
    api('adminList').then(function (res) {
      var w = mount(tpl('admin'));
      var all = res.attempts;
      state.adminDepts = res.departments || [];
      if (res.missingKeys && res.missingKeys.length) {
        var warn = document.createElement('p');
        warn.className = 'warn';
        warn.textContent = 'שימו לב: ' + res.missingKeys.length + ' שאלות עדיין בלי תשובה נכונה ולכן לא מוצגות לעובדים (שאלות ' + res.missingKeys.join(', ') + ').';
        w.querySelector('.admin-head').after(warn);
      }

      // ---- לשוניות
      var tabs = w.querySelectorAll('.tab');
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          tabs.forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
          w.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== t.dataset.tab; });
          store('set', 'rmcQuizAdminTab', t.dataset.tab);
        });
      });

      // ---- עובדים
      var tbody = w.querySelector('.panel[data-panel=people] tbody');
      var search = w.querySelector('#adminSearch');
      var status = w.querySelector('#adminStatus');
      var deptSel = w.querySelector('#adminDept');
      var deptNames = state.adminDepts.map(function (d) { return d.name; });
      all.forEach(function (a) { if (a.department && deptNames.indexOf(a.department) < 0) deptNames.push(a.department); });
      deptNames.forEach(function (n) { var o = document.createElement('option'); o.textContent = n; deptSel.appendChild(o); });

      function filtered() {
        var s = search.value.trim().toLowerCase();
        return all.filter(function (a) {
          if (status.value && a.status !== status.value) return false;
          if (deptSel.value && a.department !== deptSel.value) return false;
          return !s || [a.firstName, a.lastName, a.department, a.email].join(' ').toLowerCase().indexOf(s) >= 0;
        });
      }

      function draw() {
        var rows = filtered();
        var done = rows.filter(function (a) { return a.status === 'הושלם'; });
        var avg = done.length ? Math.round(done.reduce(function (s, a) { return s + Number(a.score); }, 0) / done.length) : 0;
        var people = {};
        rows.forEach(function (a) { people[a.email] = 1; });
        w.querySelector('.panel[data-panel=people] .stats').innerHTML =
          stat(Object.keys(people).length, 'עובדים') + stat(done.length, 'שאלונים שהושלמו') +
          stat(rows.length - done.length, 'בתהליך') + stat(done.length ? avg + '%' : '—', 'ציון ממוצע');
        tbody.innerHTML = '';
        if (!rows.length) tbody.innerHTML = '<tr><td colspan="6" class="muted">אין נתונים</td></tr>';
        rows.forEach(function (a) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td></td><td></td><td><span class="pill"></span></td><td></td><td><button class="link">צפייה בדוח</button></td>';
          var td = tr.children;
          td[0].textContent = fmtDate(a.end || a.start);
          td[1].textContent = a.firstName + ' ' + a.lastName;
          td[2].textContent = a.department;
          td[3].firstChild.textContent = a.status === 'הושלם' ? 'הושלם' : 'בתהליך (' + a.answered + '/' + a.total + ')';
          if (a.status === 'הושלם') td[3].firstChild.classList.add('done');
          td[4].textContent = a.score === '' ? '—' : a.score + '%';
          td[5].firstChild.addEventListener('click', function () { openReport(a.id); });
          tbody.appendChild(tr);
        });
      }
      search.addEventListener('input', draw);
      status.addEventListener('change', draw);
      deptSel.addEventListener('change', draw);
      draw();

      // ---- ציון מחלקתי
      var ds = deptStats(all, state.adminDepts);
      var focus = w.querySelector('#deptFocus');
      var wingF = w.querySelector('#wingFilter');
      ds.wings.forEach(function (g) { var o = document.createElement('option'); o.textContent = g.name; wingF.appendChild(o); });
      function fillFocus() {
        var keep = focus.value;
        focus.innerHTML = '<option value="">כל המחלקות</option>';
        ds.list.filter(function (d) { return !wingF.value || d.wing === wingF.value; }).forEach(function (d) {
          var o = document.createElement('option'); o.textContent = d.name; focus.appendChild(o);
        });
        focus.value = keep;
        if (focus.value !== keep) focus.value = '';
      }
      fillFocus();
      wingF.addEventListener('change', function () { fillFocus(); store('set', 'rmcQuizDeptFocus', focus.value); drawDepts(); });
      var savedFocus = store('get', 'rmcQuizDeptFocus');
      if (savedFocus && ds.list.some(function (d) { return d.name === savedFocus; })) focus.value = savedFocus;
      focus.addEventListener('change', function () { store('set', 'rmcQuizDeptFocus', focus.value); drawDepts(); });

      var tip = w.querySelector('.dtip');
      var fig = w.querySelector('.dchart');
      function showTip(e, d, el) {
        tip.innerHTML = '<b></b><span></span><span></span><span></span>';
        tip.children[0].textContent = d.name + ' · ' + d.wing;
        tip.children[1].textContent = 'ציון ממוצע: ' + d.avg + '% (' + signed(d.diff) + ' מהממוצע)';
        tip.children[2].textContent = 'השלימו: ' + d.done + ' מתוך ' + d.registered + ' רשומים';
        tip.children[3].textContent = 'טווח: ' + range(d) + ' · דירוג ' + d.rank + ' מתוך ' + ds.ranked;
        tip.hidden = false;
        var fr = fig.getBoundingClientRect();
        var x, y;
        if (e) { x = e.clientX - fr.left; y = e.clientY - fr.top; }
        else { var r = el.getBoundingClientRect(); x = r.left - fr.left + r.width / 2; y = r.top - fr.top; }
        var tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(fr.width - tw, x - tw / 2)) + 'px';
        tip.style.top = (y - tip.offsetHeight - 12) + 'px';
      }
      function hideTip() { tip.hidden = true; }

      function pick(name) { if (focus.value !== name) { wingF.value = ''; fillFocus(); } focus.value = name; store('set', 'rmcQuizDeptFocus', name); drawDepts(); }

      function drawDepts() {
        var f = ds.list.filter(function (d) { return d.name === focus.value; })[0];
        var box = w.querySelector('.dept-stats');
        if (f) {
          box.innerHTML = stat(f.avg == null ? '—' : f.avg + '%', 'ציון ממוצע – ' + esc(f.name)) +
            stat(ds.overall == null ? '—' : ds.overall + '%', 'ממוצע בית החולים') +
            stat(signed(f.diff), 'הפרש מהממוצע (נקודות)') +
            stat(f.rank ? f.rank + ' מתוך ' + ds.ranked : '—', 'דירוג בין המחלקות') +
            stat(f.done + ' מתוך ' + f.registered, 'השלימו מתוך הרשומים');
        } else {
          box.innerHTML = stat(ds.overall == null ? '—' : ds.overall + '%', 'ממוצע בית החולים') +
            ds.wings.filter(function (g) { return !wingF.value || g.name === wingF.value; }).map(function (g) {
              return stat(g.avg == null ? '—' : g.avg + '%', 'ממוצע ' + esc(g.name) + (g.diff == null ? '' : ' (' + signed(g.diff) + ')'));
            }).join('') +
            stat(ds.employees, 'עובדים שהשלימו');
        }
        if (f) {
          var fw = ds.wings.filter(function (g) { return g.name === f.wing; })[0];
          if (fw) box.innerHTML += stat(fw.avg == null ? '—' : fw.avg + '%', 'ממוצע ' + esc(fw.name));
        }

        var rowsEl = w.querySelector('.dchart-rows');
        rowsEl.innerHTML = '';
        var inWing = function (d) { return !wingF.value || d.wing === wingF.value; };
        var withData = ds.list.filter(function (d) { return d.avg != null && inWing(d); });
        w.querySelector('.dchart-axis').hidden = !withData.length;
        if (!withData.length) rowsEl.innerHTML = '<p class="muted">עדיין אין שאלונים שהושלמו.</p>';
        withData.forEach(function (d) {
          var row = document.createElement('div');
          row.className = 'drow' + (d.name === focus.value ? ' focus' : '') + (focus.value && d.name !== focus.value ? ' dim' : '');
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.innerHTML = '<span class="dname"></span><span class="dtrack"><span class="dbar"></span>' +
            (ds.overall != null ? '<span class="dmean" style="inset-inline-start:' + ds.overall + '%"></span>' : '') +
            '</span><span class="dval"></span>';
          row.querySelector('.dname').innerHTML = '<span></span><small></small>';
          row.querySelector('.dname span').textContent = d.name;
          row.querySelector('.dname small').textContent = d.wing;
          row.querySelector('.dbar').style.width = d.avg + '%';
          row.querySelector('.dval').textContent = d.avg + '%';
          row.setAttribute('aria-label', d.name + ': ציון ממוצע ' + d.avg + '%, ' + d.done + ' עובדים');
          row.addEventListener('click', function () { pick(d.name); });
          row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(d.name); } });
          row.addEventListener('mousemove', function (e) { showTip(e, d); });
          row.addEventListener('mouseleave', hideTip);
          row.addEventListener('focus', function () { showTip(null, d, row); });
          row.addEventListener('blur', hideTip);
          rowsEl.appendChild(row);
        });

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
      drawDepts();

      var savedTab = store('get', 'rmcQuizAdminTab');
      if (savedTab) { var st = w.querySelector('.tab[data-tab="' + savedTab + '"]'); if (st) st.click(); }

      w.querySelector('#btnBackHome').addEventListener('click', function () { render('home'); });
      w.querySelector('#btnXlsx').addEventListener('click', function (e) {
        var ids = {};
        filtered().forEach(function (a) { ids[a.id] = 1; });
        exportExcel(function (a) { return ids[a.id]; }, e.currentTarget);
      });
    }, function (err) { toast(err.message, true); render('home'); });
  };

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

  /** דוח מלא לכל העובדים: סיכום + פירוט נכון/לא נכון לכל שאלה + רשימת השאלות */
  function exportExcel(filter, btn) {
    busy(btn, true);
    Promise.all([loadXlsx(), api('adminExport')]).then(function (r) {
      var data = r[1];
      var rows = data.attempts.filter(filter);
      var wingOf = {};
      (state.adminDepts || []).forEach(function (d) { wingOf[d.name] = d.wing; });
      var id = function (a) { return [fmtDate(a.end || a.start), a.firstName, a.lastName, wingOf[a.department] || '', a.department, a.email]; };
      var idHead = ['תאריך', 'שם פרטי', 'שם משפחה', 'אגף', 'מחלקה', 'אימייל'];

      var summary = [idHead.concat(['סטטוס', 'נענו', 'תשובות נכונות', 'סה"כ שאלות', 'ציון %'])].concat(rows.map(function (a) {
        return id(a).concat([a.status, a.answered, a.correct, a.total, a.score === '' ? '' : Number(a.score)]);
      }));
      var detail = [idHead.concat(['ציון %'], data.questions.map(function (q) { return 'שאלה ' + q.num; }))].concat(rows.map(function (a) {
        return id(a).concat([a.score === '' ? '' : Number(a.score)], data.questions.map(function (q) {
          var x = a.answers[q.num];
          return x ? (x.ok ? 'נכון' : 'לא נכון') : '';
        }));
      }));
      var ds = deptStats(data.attempts, state.adminDepts);
      var deptRows = [['דירוג', 'מחלקה', 'אגף', 'ציון ממוצע %', 'הפרש מממוצע בית החולים', 'השלימו', 'רשומים', 'שיעור השלמה %', 'ציון מינימלי', 'ציון מקסימלי']]
        .concat(ds.list.map(function (d) {
          return [d.rank || '', d.name, d.wing, d.avg == null ? '' : d.avg, d.diff == null ? '' : d.diff, d.done, d.registered,
            d.rate == null ? '' : d.rate, d.min == null ? '' : d.min, d.max == null ? '' : d.max];
        }))
        .concat([[], ['', 'אגף', '', 'ציון ממוצע %', 'הפרש מממוצע בית החולים', 'השלימו', 'רשומים']])
        .concat(ds.wings.map(function (g) {
          return ['', g.name, '', g.avg == null ? '' : g.avg, g.diff == null ? '' : g.diff, g.done, g.registered];
        }))
        .concat([[], ['', 'ממוצע בית החולים', '', ds.overall == null ? '' : ds.overall], ['', 'לכל עובד נספר הניסיון האחרון שהושלם']]);
      var qs = [['מס׳', 'שאלה']].concat(data.questions.map(function (q) { return [q.num, q.text]; }));

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet(summary, [16, 12, 14, 12, 18, 28, 10, 7, 13, 11, 8]), 'סיכום');
      XLSX.utils.book_append_sheet(wb, sheet(detail, [16, 12, 14, 12, 18, 28, 8].concat(data.questions.map(function () { return 9; }))), 'פירוט לפי שאלה');
      XLSX.utils.book_append_sheet(wb, sheet(deptRows, [7, 26, 14, 13, 22, 9, 9, 15, 12, 12]), 'ציון מחלקתי');
      XLSX.utils.book_append_sheet(wb, sheet(qs, [6, 110]), 'שאלות');
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
      return { attemptId: a.id, user: a.user, start: a.start, end: a.end, status: a.status, correct: a.correct, total: Q.length, score: a.score, items: a.items };
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
          var q = Q[req.index], ok = req.choice === q.correct;
          open.items.push({ num: q.num, question: q.text, chosen: q.answers[req.choice], correctAnswer: q.answers[q.correct], isCorrect: ok });
          open.answered++; if (ok) open.correct++;
          var r = { ok: true, correct: ok, correctIndex: q.correct, correctSoFar: open.correct };
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
              start: a.start, end: a.end, status: a.status, answered: a.answered, correct: a.correct, total: Q.length, score: a.score == null ? '' : a.score };
          }) };
        case 'adminExport':
          return { ok: true, questions: Q.map(function (q) { return { num: q.num, text: q.text }; }), attempts: db.attempts.slice().reverse().map(function (a) {
            var ans = {};
            a.items.forEach(function (it) { ans[it.num] = { ok: it.isCorrect, chosen: it.chosen, correct: it.correctAnswer }; });
            return { id: a.id, email: a.user.email, firstName: a.user.firstName, lastName: a.user.lastName, department: a.user.department,
              start: a.start, end: a.end, status: a.status, answered: a.answered, correct: a.correct, total: Q.length, score: a.score == null ? '' : a.score, answers: ans };
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
