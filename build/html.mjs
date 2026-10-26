/** build/html.mjs — HTML / JSON-LD 转义与文本工具 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 文本节点与属性值统一转义 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** 显式标记「这段是可信 HTML」，避免模板里到处写裸字符串 */
export function raw(value) {
  return { __raw: String(value ?? '') };
}

export function join(parts) {
  return parts
    .flat(Infinity)
    .filter((p) => p !== null && p !== undefined && p !== false && p !== '')
    .map((p) => (typeof p === 'object' && p.__raw !== undefined ? p.__raw : p))
    .join('');
}

/** JSON-LD：转义 < > & 防 </script> 提前闭合 */
export function jsonld(obj) {
  return JSON.stringify(obj).replace(/[<>&]/g, (c) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[c]);
}

/** 去标签取纯文本（用于摘要、搜索索引、字数统计） */
export function stripTags(htmlText) {
  return String(htmlText)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 中英混排字数：CJK 逐字计，拉丁按词计 */
export function countWords(text) {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  return cjk + latin;
}

/** 截断到 n 个字符（不切代理对） */
export function clip(text, n) {
  const chars = Array.from(String(text));
  return chars.length <= n ? chars.join('') : chars.slice(0, n).join('');
}
