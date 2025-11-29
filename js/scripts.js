// 弹窗操作
const openBtn = document.getElementById("openPopupBtn");
const closeBtn = document.getElementById("closePopupBtn");
const overlay = document.getElementById("popupOverlay");
const popupBox = document.getElementById("popupBox");

// 打开弹窗
openBtn.addEventListener("click", () => {
  overlay.style.display = "flex";
  setTimeout(() => {
    popupBox.classList.add("show");
    popupBox.classList.remove("hide");
  }, 10);
});

// 关闭弹窗的函数
const closePopup = () => {
  popupBox.classList.remove("show");
  popupBox.classList.add("hide");
  setTimeout(() => {
    overlay.style.display = "none";
  }, 300); // 等待动画结束
};

closeBtn.addEventListener("click", closePopup);

// 点击遮罩关闭弹窗
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) {
    closePopup();
  }
});

// 监听 footer 出现时触发动画
const author = document.querySelector(".author-name");
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      author.classList.add("animate");
      observer.unobserve(author); // 只触发一次
    }
  });
}, { threshold: 0.5 });

observer.observe(author);

// 网站运行时间与最后更新时间显示
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

  // 计算网站运行时间
  const diffRun = Math.floor((now - startTime) / 1000);
  document.getElementById("runtime").textContent = `本站已运行 ${formatDiff(diffRun)}`;

  // 计算最后更新时间
  const diffDeploy = Math.floor((now - lastDeployTime) / 1000);
  document.getElementById("lastUpdate").textContent = `距上一次更新 ${formatDiff(diffDeploy)}`;
};

// 每秒更新
setInterval(updateInfo, 1000);
updateInfo();
