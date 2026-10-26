/**
 * 移植自 layouts/partials/loader.html
 * 与旧版的差别：不再预置 17 个空 .loader-line —— 行由运行时内核按真实检查点生成
 * （31 号规格 §5：行数 = resolve 的 stage 数）。容器与类名保持不变。
 */
export function loaderPartial() {
  return `<div class="loader" id="loader">
  <div class="loader-terminal">
    <div class="loader-term-bar">
      <div class="loader-term-dot"></div>
      <div class="loader-term-dot"></div>
      <div class="loader-term-dot"></div>
      <div class="loader-term-title">P.R.T.S. TERMINAL v4.12.06</div>
    </div>
    <div class="loader-term-body" id="termBody"></div>
    <div class="loader-progress">
      <div class="loader-pbar"><div class="loader-pbar-fill" id="pFill"></div></div>
      <div class="loader-ptxt" id="pTxt">0%</div>
    </div>
  </div>
</div>`;
}
