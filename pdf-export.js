// PDF export planning — pure, side-effect-free helpers shared by main.js and the
// verification harness. The cardinal rule: every exported page must use a bounded,
// standard-safe size so the result opens in Acrobat / Preview / Chrome / Outlook /
// Gmail / Drive with no oversized-page warnings.

const PX_PER_IN = 96;          // CSS px per inch
const SAFE_MAX_IN = 48;        // generous per-page bound; far below the limit → never warns
const HARD_MAX_IN = 200;       // absolute PDF page ceiling (Acrobat refuses beyond ~200in)
const in4 = (n) => +n.toFixed(4); // printToPDF pageSize is in inches (Electron ≥21)

// Runs inside the loaded deck. Classifies the content and reports slide geometry.
const DETECT_JS = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const cands = ['.reveal .slides > section','.slides > section','section.slide','div.slide','.slide','[data-slide]','.step','section'];
  const like = el => { const r = el.getBoundingClientRect(); return r.width >= vw * 0.5 && r.height >= vh * 0.55; };
  let best = null;
  for (const sel of cands) {
    let els; try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
    const slides = els.filter(like);
    if (slides.length && (!best || slides.length > best.n)) {
      best = { sel, n: slides.length, w: Math.round(slides[0].offsetWidth || vw), h: Math.round(slides[0].offsetHeight || vh) };
    }
  }
  let mode;
  if (best && best.n >= 2) mode = 'deck';            // multiple slide-like sections → a deck
  else if (docH <= vh * 1.3) { mode = 'deck'; if (!best) best = { sel: null, n: 1, w: vw, h: vh }; } // single screen
  else mode = 'document';                            // tall scrolling content → a document
  return { mode, sel: best ? best.sel : null, count: best ? best.n : 0,
           slideW: best ? best.w : vw, slideH: best ? best.h : vh, vw, vh, docH };
})()`;

// Measures full rendered content size (for Exact Capture).
const SIZE_JS = `(() => { const d = document.documentElement, b = document.body;
  return { w: Math.max(d.scrollWidth, b ? b.scrollWidth : 0, d.clientWidth),
           h: Math.max(d.scrollHeight, b ? b.scrollHeight : 0, d.clientHeight) }; })()`;

// Resolve the effective behaviour: Smart picks deck-vs-document from detection.
function decideMode(requested, det) {
  if (requested === 'smart') return det && det.mode === 'document' ? 'document' : 'deck';
  return requested; // 'deck' | 'document' | 'exact'
}

// Print CSS that forces ALL slides visible and puts each on its own page, while
// neutralising common framework tricks (active-only display, transforms, absolute
// positioning). `zoom` < 1 scales slides down only when clamping was needed.
function deckPrintCSS(sel, zoom) {
  const z = zoom && zoom < 1 ? `zoom:${zoom};` : '';
  const slideRules = sel ? `
    ${sel} {
      display:block!important; visibility:visible!important; opacity:1!important;
      position:relative!important; left:auto!important; top:auto!important; right:auto!important;
      transform:none!important; margin:0 auto!important; float:none!important;
      page-break-after:always; break-after:page; page-break-inside:avoid; break-inside:avoid; ${z}
    }
    ${sel}:last-child { page-break-after:auto; break-after:auto; }
    .reveal, .reveal .slides, .slides {
      position:static!important; transform:none!important; height:auto!important;
      width:auto!important; overflow:visible!important; left:auto!important; top:auto!important;
    }` : `html { ${z} }`;
  return `@media print {
    html, body {
      margin:0!important; padding:0!important; height:auto!important; width:auto!important;
      overflow:visible!important;
      -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important;
    }
    ${slideRules}
  }`;
}

// Build printToPDF options for a detected/declared deck.
function deckPlan(det) {
  let zoom = 1;
  let wIn = det.slideW / PX_PER_IN;
  let hIn = det.slideH / PX_PER_IN;
  const over = Math.max(wIn / SAFE_MAX_IN, hIn / SAFE_MAX_IN);
  if (over > 1) { zoom = +(1 / over).toFixed(4); wIn *= zoom; hIn *= zoom; } // clamp pathological sizes
  const sel = det.count >= 2 ? det.sel : null;
  return {
    css: deckPrintCSS(sel, zoom),
    options: {
      printBackground: true,
      preferCSSPageSize: false,
      pageSize: { width: in4(wIn), height: in4(hIn) }, // inches
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, // full-bleed slides (inches; modern API)
    },
  };
}

// Standard multi-page report pagination.
function documentPlan() {
  return {
    css: null,
    options: {
      printBackground: true,
      preferCSSPageSize: true, // honour a doc's own @page if present, else Letter
      pageSize: 'Letter',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }, // clean report margins (inches)
    },
  };
}

// Preserve rendered size as closely as possible, clamped to the hard PDF ceiling.
function exactPlan(size) {
  const wIn = Math.min(size.w / PX_PER_IN, HARD_MAX_IN);
  const hIn = Math.min(size.h / PX_PER_IN, HARD_MAX_IN);
  return {
    css: null,
    options: {
      printBackground: true,
      preferCSSPageSize: false,
      pageSize: { width: in4(wIn), height: in4(hIn) }, // inches
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    },
  };
}

function modeLabel(m) { return m === 'deck' ? 'Smart' : m === 'document' ? 'Document' : 'Exact'; }

module.exports = {
  PX_PER_IN, SAFE_MAX_IN, HARD_MAX_IN,
  DETECT_JS, SIZE_JS, decideMode, deckPrintCSS, deckPlan, documentPlan, exactPlan, modeLabel,
};
