// ========== 粒子背景 ==========
(function initParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (8 + Math.random() * 12) + 's';
    p.style.animationDelay = Math.random() * 10 + 's';
    p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
    container.appendChild(p);
  }
})();

// ========== 打字效果 ==========
(function initTyped() {
  const el = document.getElementById('typedText');
  if (!el) return;
  const texts = [
    'Open Source Developer',
    'Linux Enthusiast',
    'ESP32 Maker',
    'Blue Archive Player'
  ];
  let ti = 0, ci = 0, deleting = false;

  function tick() {
    const current = texts[ti];
    if (!deleting) {
      el.textContent = current.slice(0, ci + 1);
      ci++;
      if (ci === current.length) {
        setTimeout(() => { deleting = true; tick(); }, 2000);
        return;
      }
      setTimeout(tick, 80);
    } else {
      el.textContent = current.slice(0, ci - 1);
      ci--;
      if (ci === 0) {
        deleting = false;
        ti = (ti + 1) % texts.length;
        setTimeout(tick, 400);
        return;
      }
      setTimeout(tick, 40);
    }
  }
  tick();
})();

// ========== 移动端菜单 ==========
(function initMenu() {
  const toggle = document.getElementById('menuToggle');
  const menu = document.getElementById('mobileMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    menu.classList.toggle('open');
    document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
  });

  menu.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('open');
      menu.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
})();

// ========== Tab 筛选 ==========
(function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const cards = document.querySelectorAll('.link-card');
  if (!tabs.length || !cards.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const cat = tab.dataset.tab;
      cards.forEach(card => {
        if (cat === 'all' || card.dataset.category === cat) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });
})();

// ========== 滚动动画 ==========
(function initReveal() {
  const sections = document.querySelectorAll('.section');
  sections.forEach(s => s.classList.add('reveal'));

  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  sections.forEach(s => observer.observe(s));
})();

// ========== 导航高亮 ==========
(function initNavHighlight() {
  const links = document.querySelectorAll('.nav-link');
  const sections = ['profile', 'links', 'about'];

  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 200) {
        current = id;
      }
    });
    links.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  });
})();

// ========== 运行时间 ==========
(function initRuntime() {
  const startTime = new Date('2025/11/29 10:11:45');
  const lastDeployTime = new Date('2025/11/29 22:07:00');

  function fmt(diff) {
    const d = Math.floor(diff / 86400); diff %= 86400;
    const h = Math.floor(diff / 3600); diff %= 3600;
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return d + '天 ' + h + '时 ' + m + '分 ' + s + '秒';
  }

  function update() {
    const now = new Date();
    const r = document.getElementById('runtime');
    const u = document.getElementById('lastUpdate');
    if (r) r.textContent = '已运行 ' + fmt(Math.floor((now - startTime) / 1000));
    if (u) u.textContent = '上次更新 ' + fmt(Math.floor((now - lastDeployTime) / 1000));
  }

  update();
  setInterval(update, 1000);
})();
