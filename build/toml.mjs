/**
 * build/toml.mjs — 最小 TOML 解析器（builder 自用）
 *
 * 只覆盖 data/*.toml 实际用到的语法子集：
 *   [table] / [[array-of-tables]] / key = "str" | 'str' | true | false | 123 | 1.5 | [ ... ]
 * 支持多行数组、行内注释、基本字符串转义（\" \\ \n \t \uXXXX）。
 * 遇到不支持的语法直接抛错 —— 构建失败优于静默产出错数据。
 */

function fail(file, line, msg) {
  throw new Error(`[toml] ${file}:${line} ${msg}`);
}

/** 去掉字符串外的注释（返回 {text, inString} 状态由调用方维护） */
function stripComment(text, file, lineNo) {
  let out = '';
  let quote = null;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (quote === '"') {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '#') break;
    out += c;
  }
  if (quote) fail(file, lineNo, '字符串未闭合');
  return out;
}

/** 统计字符串外的 [ ] 深度，用于判断多行数组是否结束 */
function bracketDelta(text) {
  let depth = 0;
  let quote = null;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"') {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth;
}

function unescapeBasic(raw, file, lineNo) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') { out += c; continue; }
    const n = raw[++i];
    if (n === undefined) fail(file, lineNo, '转义不完整');
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'r') out += '\r';
    else if (n === '"') out += '"';
    else if (n === '\\') out += '\\';
    else if (n === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(file, lineNo, '非法 \\u 转义');
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else fail(file, lineNo, `未知转义 \\${n}`);
  }
  return out;
}

/** 把一段值文本切成顶层逗号分隔的片段 */
function splitTopLevel(raw) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      buf += c;
      if (quote === '"') {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '[') { depth++; buf += c; continue; }
    if (c === ']') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '') parts.push(buf);
  return parts;
}

function parseValue(raw, file, lineNo) {
  const v = raw.trim();
  if (v === '') fail(file, lineNo, '缺少值');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v[0] === '"' && v.endsWith('"')) return unescapeBasic(v.slice(1, -1), file, lineNo);
  if (v[0] === "'" && v.endsWith("'")) return v.slice(1, -1);
  if (v[0] === '[') {
    if (!v.endsWith(']')) fail(file, lineNo, '数组未闭合');
    const inner = v.slice(1, -1);
    return splitTopLevel(inner)
      .map((p) => p.trim())
      .filter((p) => p !== '')
      .map((p) => parseValue(p, file, lineNo));
  }
  if (/^[+-]?\d+$/.test(v)) return parseInt(v, 10);
  if (/^[+-]?(\d+\.\d+|\d+e[+-]?\d+)$/i.test(v)) return parseFloat(v);
  fail(file, lineNo, `无法解析的值: ${v.slice(0, 40)}`);
}

/** 按点号取/建嵌套表 */
function ensureTable(root, keys, file, lineNo) {
  let node = root;
  for (const k of keys) {
    if (node[k] === undefined) node[k] = {};
    if (Array.isArray(node[k])) node = node[k][node[k].length - 1];
    else if (typeof node[k] === 'object' && node[k] !== null) node = node[k];
    else fail(file, lineNo, `键 ${k} 不是表`);
  }
  return node;
}

export function parseToml(source, file = '<toml>') {
  const root = {};
  let current = root;
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let text = stripComment(lines[i], file, lineNo).trim();
    if (text === '') continue;

    // [table] / [[array of tables]]
    if (text[0] === '[') {
      const isArray = text.startsWith('[[');
      const close = isArray ? ']]' : ']';
      if (!text.endsWith(close)) fail(file, lineNo, '表头未闭合');
      const pathStr = text.slice(isArray ? 2 : 1, text.length - close.length).trim();
      const keys = pathStr.split('.').map((s) => s.trim());
      if (keys.some((k) => k === '')) fail(file, lineNo, '表头路径为空');
      if (isArray) {
        const parent = ensureTable(root, keys.slice(0, -1), file, lineNo);
        const last = keys[keys.length - 1];
        if (parent[last] === undefined) parent[last] = [];
        if (!Array.isArray(parent[last])) fail(file, lineNo, `${pathStr} 已存在且不是数组`);
        const entry = {};
        parent[last].push(entry);
        current = entry;
      } else {
        current = ensureTable(root, keys, file, lineNo);
      }
      continue;
    }

    // key = value（值可能是多行数组）
    const eq = text.indexOf('=');
    if (eq < 0) fail(file, lineNo, '缺少 =');
    const key = text.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) fail(file, lineNo, `非法键名: ${key}`);
    let valueText = text.slice(eq + 1).trim();

    if (valueText.startsWith('[') && bracketDelta(valueText) > 0) {
      while (bracketDelta(valueText) > 0) {
        i++;
        if (i >= lines.length) fail(file, lineNo, '数组未闭合');
        valueText += ' ' + stripComment(lines[i], file, i + 1).trim();
      }
    }

    if (Object.prototype.hasOwnProperty.call(current, key)) {
      fail(file, lineNo, `重复键: ${key}`);
    }
    current[key] = parseValue(valueText, file, lineNo);
  }

  return root;
}
