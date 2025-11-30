// ---------- 暗色模式切换 ----------
const toggle = document.getElementById("darkToggle");
const htmlEl = document.documentElement;
if (localStorage.getItem("darkMode") === "true") { htmlEl.classList.add("dark"); toggle.checked = true; }
toggle.addEventListener("change", () => {
  htmlEl.classList.toggle("dark", toggle.checked);
  localStorage.setItem("darkMode", toggle.checked ? "true" : "false");
});

// ---------- 弹窗 ----------
const openBtn = document.getElementById("openPopupBtn");
const closeBtn = document.getElementById("closePopupBtn");
const overlay = document.getElementById("popupOverlay");
const popupBox = document.getElementById("popupBox");

openBtn.addEventListener("click", () => { overlay.style.display = "flex"; setTimeout(()=>popupBox.classList.add("show"),10); });
const closePopup = () => { popupBox.classList.remove("show"); popupBox.classList.add("hide"); setTimeout(()=>{overlay.style.display="none"; popupBox.classList.remove("hide");},250); };
closeBtn.addEventListener("click", closePopup);
overlay.addEventListener("click",(e)=>{if(e.target===overlay)closePopup();});

// ---------- Footer 动画 ----------
const author = document.querySelector(".author-name");
new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){author.classList.add("animate");}})}, {threshold:0.5}).observe(author);

// ---------- 运行时间 ----------
const startTime = new Date("2025/11/29 10:11:45");
const lastDeployTime = new Date("2025/11/29 22:07:00");
const formatDiff = diff=>{const d=Math.floor(diff/86400); diff%=86400; const h=Math.floor(diff/3600); diff%=3600; const m=Math.floor(diff/60); const s=diff%60; return `${d}天 ${h}小时 ${m}分钟 ${s}秒`;};
const updateInfo = ()=>{const now=new Date(); document.getElementById("runtime").textContent=`本站已运行 ${formatDiff(Math.floor((now-startTime)/1000))}`; document.getElementById("lastUpdate").textContent=`距上一次更新 ${formatDiff(Math.floor((now-lastDeployTime)/1000))}`;};
setInterval(updateInfo,1000); updateInfo();

// ---------- Ripple ----------
document.querySelectorAll('.m3-button-filled, .m3-button-tonal').forEach(btn=>{
  btn.addEventListener('click',function(e){
    const circle=document.createElement('span'); circle.classList.add('ripple'); this.appendChild(circle);
    const rect=this.getBoundingClientRect();
    circle.style.width=circle.style.height=Math.max(rect.width,rect.height)+'px';
    circle.style.left=e.clientX-rect.left-circle.offsetWidth/2+'px';
    circle.style.top=e.clientY-rect.top-circle.offsetHeight/2+'px';
    circle.addEventListener('animationend',()=>circle.remove());
  });
});
