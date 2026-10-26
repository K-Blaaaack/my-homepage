/** 移植自 layouts/partials/head/css.html（指纹从 dist/css/manifest.json 读，不猜） */
import { esc } from '../../../build/html.mjs';

export function cssLink({ assets }) {
  return `<link rel="stylesheet" href="${esc(assets.css)}">`;
}
