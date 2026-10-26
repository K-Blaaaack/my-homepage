/**
 * 移植自 layouts/partials/head/loader.html
 * 冷却机制从「cookie 5 分钟」改为「sessionStorage boot:seen 每会话一次」（31 号规格 §9）。
 * 命中时趁 <body> 未解析先给 <html> 打 prts-skip，由 CSS 直接隐藏 loader，避免黑遮罩闪烁。
 */
export function loaderCooldown() {
  return `<script>
(function(){
  try{
    if(sessionStorage.getItem('boot:seen')){document.documentElement.classList.add("prts-skip");}
  }catch(e){}
})();
</script>`;
}
