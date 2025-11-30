// ==============================
// Material Design 3 JS (Pixel 风格)
// ==============================

// ---------- 暗色模式切换 ----------
const toggle = document.getElementById("darkToggle");
const htmlEl = document.documentElement; // 改用 html

// 页面加载时读取存储
if (localStorage.getItem("darkMode") === "true") {
  htmlEl.classList.add("dark");
  toggle.checked = true;
}

// 切换事件
toggle.addEventListener("change", () => {
  htmlEl.classList.toggle("dark", toggle.checked);
  localStorage.setItem("darkMode", toggle.checked ? "true" : "false");
});


// ---------- 弹窗控制 ----------
const openBtn = document.getElementById("openPopupBtn");
const closeBtn = document.getElementById("closePopupBtn");
const overlay = document.getElementById("popupOverlay");
const popupBox = document.getElementById("popupBox");

openBtn.addEventListener("click", () => {
  overlay.style.display = "flex";
  setTimeout(() => popupBox.classList.add("show"), 10);
});

const closePopup = () => {
  popupBox.classList.remove("show");
  popupBox.classList.add("hide");
  setTimeout(() => {
    overlay.style.display = "none";
    popupBox.classList.remove("hide");
  }, 250);
};

closeBtn.addEventListener("click", closePopup);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closePopup();
});

// ---------- Footer 动画 ----------
const author = document.querySelector(".author-name");
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      author.classList.add("animate");
      observer.unobserve(author);
    }
  });
}, { threshold: 0.5 });
observer.observe(author);

// ---------- 网站运行时间与最后更新时间 ----------
const startTime = new Date("2025/11/29 10:11:45");
const lastDeployTime = new Date("2025/11/29 22:07:00");

const formatDiff = (diff) => {
  const days = Math.floor(diff / 86400);
  diff %= 86400;
  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  return `${days}天 ${hours}小时 ${minutes}分钟 ${seconds}秒`;
};

const updateInfo = () => {
  const now = new Date();
  const diffRun = Math.floor((now - startTime) / 1000);
  const diffDeploy = Math.floor((now - lastDeployTime) / 1000);

  document.getElementById("runtime").textContent = `本站已运行 ${formatDiff(diffRun)}`;
  document.getElementById("lastUpdate").textContent = `距上一次更新 ${formatDiff(diffDeploy)}`;
};

setInterval(updateInfo, 1000);
updateInfo();

// ---------- Ripple 动画效果 ----------
document.querySelectorAll('.m3-button-filled, .m3-button-tonal').forEach(btn => {
  btn.addEventListener('click', function(e) {
    const circle = document.createElement('span');
    circle.classList.add('ripple');
    this.appendChild(circle);

    const rect = this.getBoundingClientRect();
    circle.style.width = circle.style.height = Math.max(rect.width, rect.height) + 'px';
    circle.style.left = e.clientX - rect.left - circle.offsetWidth/2 + 'px';
    circle.style.top = e.clientY - rect.top - circle.offsetHeight/2 + 'px';

    circle.addEventListener('animationend', () => circle.remove());
  });
});
