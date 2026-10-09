'use strict';
// 个人知识库阅读器：读取静态服务器的目录列表来发现笔记，在浏览器里渲染 Markdown。
// 根目录（本文件所在目录的上一级）下的每个文件夹是一个知识模块，模块里的子文件夹是分类。
// 模块可放一个 _module.json 描述标题、简介、图标、排序；以 . 或 _ 开头的文件和文件夹不会出现。

const ROOT = new URL('../', location.href);
const NOTE_RE = /\.(md|markdown)$/i;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = rel => rel.split('/').map(encodeURIComponent).join('/');
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true });

const ICON = {
  doc: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
};

let tree = null;      // { dirs: [{name, rel, dirs, notes}], notes: [{rel, name}] }
let modules = [];     // tree.dirs，各自带 meta
let flat = [];        // 当前模块内按目录顺序展开的笔记（用于上一篇 / 下一篇）
const cache = new Map(); // rel -> { text, title, modified }

// ---------- 发现笔记：解析目录列表页里的链接 ----------
async function listDir(rel, depth = 0) {
  const node = { dirs: [], notes: [] };
  if (depth > 6) return node;
  let html;
  try {
    const res = await fetch(new URL(rel ? enc(rel) + '/' : '', ROOT), { cache: 'no-cache' });
    if (!res.ok) return node;
    html = await res.text();
  } catch { return node; }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^([a-z]+:|\/|\?|#|\.\.?\/?$)/i.test(href)) continue;
    let name;
    try { name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop()); } catch { continue; }
    if (!name || name.startsWith('.') || name.startsWith('_') || seen.has(name)) continue;
    seen.add(name);
    const childRel = rel ? `${rel}/${name}` : name;
    if (href.endsWith('/')) {
      const child = await listDir(childRel, depth + 1);
      if (child.dirs.length || child.notes.length) node.dirs.push({ name, rel: childRel, ...child });
    } else if (NOTE_RE.test(name)) {
      node.notes.push({ rel: childRel, name: name.replace(NOTE_RE, '') });
    }
  }
  node.dirs.sort((a, b) => collator.compare(a.name, b.name));
  node.notes.sort((a, b) => collator.compare(a.name, b.name));
  return node;
}
async function loadMeta(mod) {
  let meta = {};
  try {
    const res = await fetch(new URL(enc(mod.rel) + '/_module.json', ROOT), { cache: 'no-cache' });
    if (res.ok) meta = await res.json();
  } catch {}
  mod.meta = {
    title: meta.title || mod.name,
    description: meta.description || '',
    icon: meta.icon || '📚',
    order: Number.isFinite(meta.order) ? meta.order : 999,
  };
}
const moduleOf = rel => modules.find(m => rel === m.rel || rel.startsWith(m.rel + '/'));
const flatten = (n, out = []) => (n.notes.forEach(x => out.push(x)), n.dirs.forEach(d => flatten(d, out)), out);

async function loadNote(rel, fresh) {
  if (!fresh && cache.has(rel)) return cache.get(rel);
  const res = await fetch(new URL(enc(rel), ROOT), { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status);
  const text = await res.text();
  const m = text.match(/^#\s+(.+)$/m);
  const lm = res.headers.get('Last-Modified');
  const entry = { text, title: m ? m[1].trim() : rel.split('/').pop().replace(NOTE_RE, ''), modified: lm ? new Date(lm) : null };
  cache.set(rel, entry);
  return entry;
}
const titleOf = n => (cache.get(n.rel) || {}).title || n.name;

// ---------- 侧边栏 ----------
function treeHtml(node) {
  let s = '<ul>';
  for (const n of node.notes) {
    s += `<li><a class="note" href="#/${enc(n.rel)}" data-rel="${esc(n.rel)}">${ICON.doc}<span>${esc(titleOf(n))}</span></a></li>`;
  }
  for (const d of node.dirs) {
    s += `<li class="cat"><details open data-rel="${esc(d.rel)}"><summary>${ICON.chev}${ICON.folder}<span>${esc(d.name)}</span><em>${flatten(d).length}</em></summary>${treeHtml(d)}</details></li>`;
  }
  return s + '</ul>';
}
// 首页侧栏列出全部模块；进入模块后只显示该模块的目录
function renderTree() {
  const mod = moduleOf(currentRel());
  const nav = $('.tree');
  if (mod) {
    nav.innerHTML = `<a class="back" href="#/">${ICON.back}全部知识库</a>
      <a class="module-head" href="#/${enc(mod.rel)}"><span class="module-icon">${esc(mod.meta.icon)}</span><span>${esc(mod.meta.title)}</span></a>
      ${treeHtml(mod)}`;
  } else {
    nav.innerHTML = modules.length
      ? `<ul>${modules.map(m => `<li class="cat"><details data-rel="${esc(m.rel)}"><summary>${ICON.chev}<span class="module-icon sm">${esc(m.meta.icon)}</span><span>${esc(m.meta.title)}</span><em>${flatten(m).length}</em></summary>${treeHtml(m)}</details></li>`).join('')}</ul>`
      : '<p class="hint">还没有知识模块</p>';
  }
  nav.dataset.module = mod ? mod.rel : '';
  markActive();
  applySearch();
}
function markActive() {
  const rel = currentRel();
  document.querySelectorAll('.tree a.note').forEach(a => {
    const on = a.dataset.rel === rel;
    a.classList.toggle('active', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    if (on) {
      for (let p = a.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
      a.scrollIntoView({ block: 'nearest' });
    }
  });
}

// ---------- 搜索（标题 + 正文） ----------
function applySearch() {
  const q = $('.search input').value.trim().toLowerCase();
  let any = false;
  document.querySelectorAll('.tree a.note').forEach(a => {
    const c = cache.get(a.dataset.rel);
    const hay = (a.textContent + ' ' + a.dataset.rel + ' ' + (c ? c.text : '')).toLowerCase();
    const hit = !q || hay.includes(q);
    a.parentElement.hidden = !hit;
    any ||= hit;
  });
  document.querySelectorAll('.tree li.cat').forEach(li => {
    li.hidden = !!q && !li.querySelector('li:not(.cat):not([hidden])');
    if (q && !li.hidden) li.firstElementChild.open = true;
  });
  $('.empty-search').hidden = any || !document.querySelector('.tree a.note');
}

// ---------- Markdown 渲染 ----------
// 把高亮后的 HTML 按行切开；跨行的 <span>（如多行注释）在行尾闭合、下一行重新打开
function splitLines(html) {
  const out = [], open = [];
  let cur = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!part) continue;
    if (part === '\n') {
      out.push(cur + '</span>'.repeat(open.length));
      cur = open.join('');
    } else if (part.startsWith('<span')) { open.push(part); cur += part; }
    else if (part === '</span>') { open.pop(); cur += part; }
    else cur += part;
  }
  out.push(cur);
  return out;
}

function renderMarkdown(md, rel) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const toc = [], used = new Map();
  const slug = t => {
    let s = t.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section';
    const n = used.get(s) || 0;
    used.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
  const toPlain = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
  const resolve = href => {
    // 相对于当前笔记解析，结果是相对根目录的路径
    const u = new URL(href, new URL(enc(dir), 'http://n/'));
    return decodeURIComponent(u.pathname.slice(1)) + u.hash;
  };
  const marked = new window.marked.Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = toPlain(html);
        const id = slug(text);
        if (depth >= 2 && depth <= 4) toc.push({ depth, id, text });
        return `<h${depth} id="${esc(id)}"><a class="anchor" href="#${esc(id)}" aria-hidden="true" tabindex="-1">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const want = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        let body = esc(text), label = want || 'text';
        if (want && hljs.getLanguage(want)) body = hljs.highlight(text, { language: want, ignoreIllegals: true }).value;
        else if (!want && text.length < 20000) {
          const r = hljs.highlightAuto(text, ['java', 'sql', 'javascript', 'typescript', 'json', 'yaml', 'xml', 'bash', 'ini']);
          if (r.relevance >= 6) { body = r.value; label = r.language; }
        }
        const lines = splitLines(body.replace(/\n$/, ''));
        const rows = lines.map((l, i) => `<span class="ln-row"><span class="ln">${i + 1}</span><span class="lc">${l || ' '}</span></span>`).join('');
        return `<figure class="code-block" style="--ln-w:${String(lines.length).length + 1.6}em"><div class="code-tools"><span class="code-lang">${esc(label)}</span><button type="button" class="copy">复制</button></div><pre><code class="hljs">${rows}</code></pre></figure>\n`;
      },
      table(token) {
        return `<div class="table-wrap">${window.marked.Renderer.prototype.table.call(this, token)}</div>`;
      },
      image({ href, title, text }) {
        const src = /^([a-z]+:|\/)/i.test(href) ? href : new URL(enc(resolve(href).split('#')[0]), ROOT).href;
        return `<img src="${esc(src)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        let h = href, ext = false;
        if (/^https?:/i.test(h)) ext = true;
        else if (!/^(#|mailto:|\/)/i.test(h)) {
          const r = resolve(h);
          const [p, hash] = r.split('#');
          h = NOTE_RE.test(p) ? `#/${enc(p)}${hash ? '::' + hash : ''}` : new URL(enc(p), ROOT).href;
        } else if (h.startsWith('#')) h = `#/${enc(rel)}::${h.slice(1)}`;
        return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
      },
    },
  });
  return { html: marked.parse(md), toc };
}

// ---------- 路由：#/路径.md 或 #/路径.md::标题锚点 ----------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, anchor] = raw.split('::');
  let rel = '';
  try { rel = decodeURIComponent(p); } catch {}
  return { rel, anchor: anchor ? decodeURIComponent(anchor) : '' };
}
const currentRel = () => parseHash().rel;

const fmt = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
let spy = null; // 目录滚动高亮

async function route() {
  const { rel, anchor } = parseHash();
  closeDrawers();
  const mod = moduleOf(rel);
  if ($('.tree').dataset.module !== (mod ? mod.rel : '')) renderTree();
  markActive();
  flat = mod ? flatten(mod) : [];
  const main = $('.content');
  if (!rel) return renderHub();
  if (mod && rel === mod.rel) return renderModule(mod);
  // 页内锚点跳转：已在同一篇时只滚动
  if (main.dataset.rel === rel && anchor) return scrollToId(anchor);
  if (!mod || !NOTE_RE.test(rel) || rel.split('/').some(x => x === '..' || x.startsWith('.') || x.startsWith('_'))) return renderMissing();
  let note;
  try { note = await loadNote(rel, true); } catch { return renderMissing(); }
  // 第一个 H1 作为页面大标题，正文里不再重复
  const body = note.text.replace(/^﻿?\s*#\s+.+\n?/, '');
  const { html, toc } = renderMarkdown(body, rel);
  const idx = flat.findIndex(n => n.rel === rel);
  const prev = flat[idx - 1], next = flat[idx + 1];
  const folders = rel.split('/').slice(1, -1);
  const minutes = Math.max(1, Math.round(note.text.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, '').length / 400));
  const sections = toc.filter(t => t.depth === 2).length;
  let i = 0;
  const metaItem = (icon, text) => `<span style="--i:${i++}">${icon}${esc(text)}</span>`;
  main.dataset.rel = rel;
  main.dataset.view = 'note';
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  main.innerHTML = `
    <header class="post-head">
      <h1>${esc(note.title)}</h1>
      <div class="meta">
        ${note.modified ? metaItem(ICON.cal, fmt(note.modified)) : ''}
        ${metaItem(ICON.clock, `约 ${minutes} 分钟`)}
        ${sections ? metaItem(ICON.list, `${sections} 个章节`) : ''}
      </div>
      <div class="badges"><a class="badge primary" href="#/${enc(mod.rel)}" style="--i:${i++}">${esc(mod.meta.icon)} ${esc(mod.meta.title)}</a>${folders.map(f => `<span class="badge" style="--i:${i++}">${esc(f)}</span>`).join('')}</div>
      <div class="separator"></div>
    </header>
    <article class="prose">${html}</article>
    <nav class="pager">${prev ? `<a href="#/${enc(prev.rel)}"><small>上一篇</small><span>${esc(titleOf(prev))}</span></a>` : '<span></span>'}${next ? `<a class="next" href="#/${enc(next.rel)}"><small>下一篇</small><span>${esc(titleOf(next))}</span></a>` : ''}</nav>`;
  document.title = `${note.title} · ${mod.meta.title}`;
  renderToc(toc);
  if (anchor) scrollToId(anchor); else window.scrollTo(0, 0);
  // 侧边栏标题可能因为刚读到 H1 而变化
  const link = document.querySelector(`.tree a.note[data-rel="${CSS.escape(rel)}"] span`);
  if (link) link.textContent = note.title;
  main.focus({ preventScroll: true });
}

function enterAnim(main, view) {
  const animate = !main.classList.contains('enter') || main.dataset.view !== view;
  main.dataset.view = view;
  main.classList.remove('enter');
  if (animate) { void main.offsetWidth; main.classList.add('enter'); }
}
const latest = notes => notes.reduce((t, n) => Math.max(t, ((cache.get(n.rel) || {}).modified || 0) - 0), 0);
const excerptOf = c => c ? c.text.replace(/^#.*$/m, '').replace(/```[\s\S]*?```/g, '').replace(/[#>*`\-|_\[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) : '';

// 一级入口：全部知识模块
function renderHub() {
  const main = $('.content');
  main.dataset.rel = '';
  document.title = '学习空间';
  renderToc([]);
  enterAnim(main, 'hub');
  const total = modules.reduce((t, m) => t + flatten(m).length, 0);
  main.innerHTML = `<section class="home">
    <p class="eyebrow" style="--i:0">个人知识库</p>
    <h1 style="--i:1">学习空间</h1>
    <p class="lead" style="--i:2">${modules.length} 个知识模块 · ${total} 篇笔记，选择一个模块开始阅读。</p>
    <div class="cards" style="--i:3">${modules.map(m => {
      const notes = flatten(m), t = latest(notes);
      return `<a class="card module-card" href="#/${enc(m.rel)}">
        <span class="module-icon lg">${esc(m.meta.icon)}</span>
        <span class="card-title">${esc(m.meta.title)}</span>
        ${m.meta.description ? `<span class="card-excerpt">${esc(m.meta.description)}</span>` : ''}
        <span class="card-meta">${notes.length} 篇笔记${m.dirs.length ? ` · ${m.dirs.length} 个分类` : ''}${t ? ` · ${fmt(new Date(t))} 更新` : ''}</span>
      </a>`;
    }).join('') || '<p class="hint">在根目录新建一个文件夹并放入 .md 文件，刷新即可看到新模块。</p>'}</div>
  </section>`;
  window.scrollTo(0, 0);
}

// 二级入口：某个模块的笔记列表（按目录顺序，也就是学习顺序）
function renderModule(mod) {
  const main = $('.content');
  main.dataset.rel = mod.rel;
  document.title = `${mod.meta.title} · 学习空间`;
  renderToc([]);
  enterAnim(main, 'module:' + mod.rel);
  const notes = flatten(mod);
  main.innerHTML = `<section class="home">
    <p class="eyebrow" style="--i:0"><a href="#/">全部知识库</a> / 模块</p>
    <h1 style="--i:1"><span class="module-icon xl">${esc(mod.meta.icon)}</span>${esc(mod.meta.title)}</h1>
    <p class="lead" style="--i:2">${mod.meta.description ? esc(mod.meta.description) + '<br>' : ''}${notes.length} 篇笔记${mod.dirs.length ? ` · ${mod.dirs.length} 个分类` : ''}</p>
    <div class="cards" style="--i:3">${notes.map((n, k) => {
      const c = cache.get(n.rel);
      const folder = n.rel.split('/').slice(1, -1).join(' / ');
      const excerpt = excerptOf(c);
      return `<a class="card" href="#/${enc(n.rel)}">
        <span class="card-path"><b>${String(k + 1).padStart(2, '0')}</b>${folder ? `${ICON.folder}${esc(folder)}` : ''}</span>
        <span class="card-title">${esc(titleOf(n))}</span>
        ${excerpt ? `<span class="card-excerpt">${esc(excerpt)}…</span>` : ''}
        ${c && c.modified ? `<span class="card-meta">${fmt(c.modified)}</span>` : ''}
      </a>`;
    }).join('') || '<p class="hint">这个模块还没有笔记。</p>'}</div>
  </section>`;
  window.scrollTo(0, 0);
}

function renderMissing() {
  const main = $('.content');
  main.dataset.rel = '';
  main.dataset.view = 'missing';
  renderToc([]);
  main.innerHTML = '<section class="home"><p class="eyebrow">404</p><h1>找不到这篇笔记</h1><p class="lead">它可能被移动或改名了。<a href="#/">回到首页</a></p></section>';
}

// ---------- 目录（TOC）与滚动高亮 ----------
function renderToc(toc) {
  const nav = $('.toc');
  spy = null;
  document.body.classList.toggle('has-toc', toc.length > 0);
  $('.toc-btn').hidden = toc.length === 0;
  nav.hidden = toc.length === 0;
  if (!toc.length) return (nav.innerHTML = '');
  const rel = currentRel();
  nav.innerHTML = `<div class="toc-title">本页目录</div><ul>${toc.map(t => `<li class="d${t.depth}"><a href="#/${enc(rel)}::${encodeURIComponent(t.id)}" data-id="${esc(t.id)}">${esc(t.text)}</a></li>`).join('')}</ul>`;
  const links = new Map([...nav.querySelectorAll('a')].map(a => [a.dataset.id, a]));
  const heads = toc.map(t => document.getElementById(t.id)).filter(Boolean);
  let last = null;
  // 当前章节 = 顶部偏移线之上最后一个标题；到达页底时取最后一个
  spy = () => {
    let cur = heads[0];
    for (const h of heads) { if (h.getBoundingClientRect().top <= 140) cur = h; else break; }
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = heads[heads.length - 1];
    const id = cur && cur.id;
    if (id === last) return;
    last = id;
    links.forEach((a, k) => a.classList.toggle('active', k === id));
    const act = links.get(id);
    if (act && nav.scrollHeight > nav.clientHeight) nav.scrollTo({ top: act.offsetTop - nav.clientHeight / 2, behavior: 'smooth' });
  };
  spy();
}
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  closeDrawers();
}

// ---------- 交互 ----------
function closeDrawers() { document.body.classList.remove('nav-open', 'toc-open'); }
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-action], .copy, .anchor');
  if (!t) return;
  if (t.classList.contains('anchor')) {
    e.preventDefault();
    history.replaceState(null, '', `#/${enc(currentRel())}::${encodeURIComponent(t.parentElement.id)}`);
    return scrollToId(t.parentElement.id);
  }
  if (t.classList.contains('copy')) {
    const code = t.closest('figure').querySelector('code').innerText;
    try { await navigator.clipboard.writeText(code); } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: code });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    t.textContent = '已复制'; t.classList.add('done');
    setTimeout(() => { t.textContent = '复制'; t.classList.remove('done'); }, 1400);
    return;
  }
  const a = t.dataset.action;
  if (a === 'menu') document.body.classList.toggle('nav-open');
  if (a === 'toc') document.body.classList.toggle('toc-open');
  if (a === 'close') closeDrawers();
  if (a === 'theme') {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('reader-theme', root.dataset.theme); } catch {}
  }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    document.body.classList.add('nav-open');
    $('.search input').focus();
  }
  if (e.key === 'Escape') { closeDrawers(); if (document.activeElement === $('.search input')) $('.search input').blur(); }
});
$('.search input').addEventListener('input', applySearch);

// TOC 内点击：不改历史栈太多，直接滚动
$('.toc').addEventListener('click', e => {
  const a = e.target.closest('a[data-id]');
  if (!a) return;
  e.preventDefault();
  history.replaceState(null, '', a.getAttribute('href'));
  scrollToId(a.dataset.id);
});

// 阅读进度条
const bar = $('.progress span');
addEventListener('scroll', () => {
  const h = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  if (spy && !ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; spy && spy(); }); }
}, { passive: true });
let ticking = false;

addEventListener('hashchange', route);

// ---------- 启动 ----------
(async function init() {
  tree = await listDir('');
  modules = tree.dirs;
  await Promise.all(modules.map(loadMeta));
  modules.sort((a, b) => a.meta.order - b.meta.order || collator.compare(a.meta.title, b.meta.title));
  renderTree();
  await route();
  // 后台读取全部笔记：拿到 H1 标题、更新时间，并支持正文搜索
  await Promise.all(flatten(tree).map(n => loadNote(n.rel).catch(() => {})));
  renderTree();
  const rel = currentRel(), mod = moduleOf(rel);
  if (!rel) renderHub(); else if (mod && rel === mod.rel) renderModule(mod);
})();
