/** 移植自 layouts/partials/head/js.html：运行时计时 + 入口模块 */
import { esc } from '../../../build/html.mjs';

export function jsScripts({ site, assets }) {
  return `<script>
(function(){
  var s=new Date("${esc(site.startTime)}"),dp=new Date("${esc(site.lastDeploy)}");
  function f(n){var day=Math.floor(n/86400);n%=86400;var h=Math.floor(n/3600);n%=3600;var m=Math.floor(n/60);var sec=n%60;return day+"天 "+h+"时 "+m+"分 "+sec+"秒"}
  function u(){var now=new Date();var r=document.getElementById("runtime");var up=document.getElementById("lastUpdate");if(r)r.textContent="已运行 "+f(Math.floor((now-s)/1000));if(up)up.textContent="上次更新 "+f(Math.floor((now-dp)/1000))}
  u();setInterval(u,1000);
})();
</script>
<script type="module" src="${esc(assets.js)}" onerror="document.documentElement.classList.replace('js','no-js')"></script>`;
}
