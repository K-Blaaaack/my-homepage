/** 移植自 layouts/partials/head/js.html：运行时计时 + 入口模块 */
import { esc } from '../../../build/html.mjs';

/**
 * 慢网优化：解析阶段就发起下载（modulepreload 语义，不是 preload as=script）。
 * 只预载入口与 overlay；remote 由 boot 的 manifest 阶段 import，marked/hljs 严禁预载。
 */
export function modulePreloads({ assets }) {
  const lines = [`<link rel="modulepreload" href="${esc(assets.js)}">`];
  if (assets.overlay) lines.push(`<link rel="modulepreload" href="${esc(assets.overlay)}">`);
  return lines.join('\n');
}

/** 仅入口模块 + onerror 回退（404 / tag 页用，不带运行时计时） */
export function entryScript({ assets }) {
  return `<script type="module" src="${esc(assets.js)}" onerror="document.documentElement.classList.replace('js','no-js')"></script>`;
}

export function jsScripts({ site, assets }) {
  return `<script>
(function(){
  var s=new Date("${esc(site.startTime)}"),dp=new Date("${esc(site.lastDeploy)}");
  function f(n){var day=Math.floor(n/86400);n%=86400;var h=Math.floor(n/3600);n%=3600;var m=Math.floor(n/60);var sec=n%60;return day+"天 "+h+"时 "+m+"分 "+sec+"秒"}
  function u(){var now=new Date();var r=document.getElementById("runtime");var up=document.getElementById("lastUpdate");if(r)r.textContent="已运行 "+f(Math.floor((now-s)/1000));if(up)up.textContent="上次更新 "+f(Math.floor((now-dp)/1000))}
  u();setInterval(u,1000);
})();
</script>
${entryScript({ assets })}`;
}
