// ─── Resources: PDF reader & presenter ───
// Cards in pages/resources.html carry data-pdf / data-kind / data-pages. This script adds:
//  • Reader: an in-page viewer with lazy page rendering, zoom, page jump and download.
//  • Presenter (slide decks): full screen, one slide at a time, with laser, spotlight, zoom,
//    pen/highlighter/shapes in colours, undo/redo, whiteboard, blackout, overview, talk countdown,
//    progress bar, an audience QR code, save-as-image, and keyboard/touch/clicker navigation.
//  • Deep links: resources.html#<card-id> opens that resource in the reader.
// PDF.js is loaded from cdnjs only when the first document is opened.
(function () {
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const MAX_CANVAS_PIXELS = 16e6;   // keep large posters within browser canvas limits
  const root = document.documentElement;
  const cards = Array.from(document.querySelectorAll('.resource[data-pdf]'));
  if (!cards.length) return;

  // ── PDF.js loading ──
  let pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS_URL;
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          resolve(window.pdfjsLib);
        };
        s.onerror = () => { pdfjsPromise = null; reject(new Error('Could not load the PDF viewer.')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }

  const docCache = new Map();
  function getDoc(url) {
    if (!docCache.has(url)) {
      const p = loadPdfjs().then(lib => lib.getDocument(url).promise);
      p.catch(() => docCache.delete(url));
      docCache.set(url, p);
    }
    return docCache.get(url);
  }

  // Render one page into a canvas at a CSS scale, respecting devicePixelRatio and a pixel cap
  function renderPage(page, canvas, cssScale) {
    const viewport = page.getViewport({ scale: cssScale });
    let ratio = window.devicePixelRatio || 1;
    const pixels = viewport.width * viewport.height * ratio * ratio;
    if (pixels > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
    });
    return task;
  }

  const icon = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    present: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20l4-4 4 4"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    laser: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 20h12M5 15l8-8 5 5-6 6H8z"/></svg>',
    black: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="12" rx="1.5"/><path d="M4 5l16 12"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17.5v.01"/></svg>',
  };
  const btn = (action, label, svg, extra = '') =>
    `<button type="button" class="vbtn" data-v="${action}" aria-label="${label}" title="${label}" ${extra}>${svg}</button>`;

  // ── Reader ──
  const reader = document.createElement('div');
  reader.className = 'reader';
  reader.hidden = true;
  reader.setAttribute('role', 'dialog');
  reader.setAttribute('aria-modal', 'true');
  reader.setAttribute('aria-labelledby', 'readerTitle');
  reader.innerHTML = `
    <div class="reader-bar">
      <div class="reader-heading">
        <span class="reader-kind" id="readerKind"></span>
        <h2 class="reader-title" id="readerTitle"></h2>
      </div>
      <div class="reader-tools">
        <div class="vgroup">
          ${btn('prev', 'Previous page', icon.prev)}
          <label class="reader-page"><span class="visually-hidden">Page</span><input type="number" min="1" value="1" inputmode="numeric" id="readerPageInput" /><span id="readerPageCount">/ 1</span></label>
          ${btn('next', 'Next page', icon.next)}
        </div>
        <div class="vgroup">
          ${btn('zoom-out', 'Zoom out', icon.minus)}
          <span class="reader-zoom" id="readerZoom">100%</span>
          ${btn('zoom-in', 'Zoom in', icon.plus)}
          ${btn('fit', 'Fit to width', icon.fit)}
        </div>
        <div class="vgroup">
          ${btn('present', 'Present (full screen)', icon.present)}
          <a class="vbtn" data-v="download" href="#" download aria-label="Download PDF" title="Download PDF">${icon.download}</a>
          ${btn('close', 'Close', icon.close)}
        </div>
      </div>
    </div>
    <p class="reader-notice" hidden></p>
    <div class="reader-scroll" tabindex="0"><div class="reader-pages"></div></div>
    <p class="reader-status" role="status"></p>`;
  document.body.appendChild(reader);

  const rScroll = reader.querySelector('.reader-scroll');
  const rPages = reader.querySelector('.reader-pages');
  const rStatus = reader.querySelector('.reader-status');
  const rInput = reader.querySelector('#readerPageInput');
  const rCount = reader.querySelector('#readerPageCount');
  const rZoom = reader.querySelector('#readerZoom');
  const rDownload = reader.querySelector('[data-v="download"]');
  const rNotice = reader.querySelector('.reader-notice');

  const state = {
    card: null, doc: null, pages: [], baseSizes: [], zoom: 1, fitScale: 1,
    current: 1, opener: null, pushed: false, observer: null, token: 0,
  };

  function cardInfo(card) {
    return {
      id: card.id,
      url: card.dataset.pdf,
      kind: card.dataset.kind,
      title: card.querySelector('.resource-title').textContent.trim(),
    };
  }

  async function openReader(card, { push = true, opener = null, present = false } = {}) {
    const info = cardInfo(card);
    state.card = card;
    state.opener = opener;
    state.zoom = 1;
    const token = ++state.token;

    reader.querySelector('#readerTitle').textContent = info.title;
    reader.querySelector('#readerKind').textContent = info.kind === 'slides' ? 'Slides' : 'Poster';
    reader.querySelector('[data-v="present"]').innerHTML = info.kind === 'slides' ? icon.present : icon.full;
    reader.querySelector('[data-v="present"]').title = info.kind === 'slides' ? 'Present (full screen)' : 'Full screen';
    rDownload.href = info.url;
    if (state.observer) state.observer.disconnect();
    state.doc = null;
    state.pages = [];
    state.current = 1;
    rInput.value = 1;
    rCount.textContent = '/ ' + (card.dataset.pages || '…');
    rZoom.textContent = '100%';
    reader.classList.remove('is-native');
    rNotice.hidden = true;
    rPages.innerHTML = '';
    rStatus.textContent = 'Loading…';
    reader.hidden = false;
    root.classList.add('viewer-open', 'bg-paused');

    if (push && location.hash !== '#' + info.id) {
      history.pushState({ resource: info.id }, '', '#' + info.id);
      state.pushed = true;
    }
    reader.querySelector('[data-v="close"]').focus({ preventScroll: true });

    try {
      const doc = await getDoc(info.url);
      if (token !== state.token) return;
      state.doc = doc;
      state.baseSizes = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        if (token !== state.token) return;
        const vp = page.getViewport({ scale: 1 });
        state.baseSizes.push({ w: vp.width, h: vp.height });
      }
      rStatus.textContent = '';
      rCount.textContent = '/ ' + doc.numPages;
      rInput.max = doc.numPages;
      buildPages();
      if (present) startPresenting();
    } catch (err) {
      if (token !== state.token) return;
      stopPresenting();
      showNativeViewer(info);
    }
  }

  // Fallback when PDF.js cannot read the file: pages opened straight from disk (file://) may not
  // fetch local files, and some networks block the CDN. The browser's own PDF viewer still works.
  function showNativeViewer(info) {
    reader.classList.add('is-native');
    rStatus.textContent = '';
    const frame = document.createElement('iframe');
    frame.className = 'reader-native';
    frame.src = info.url + (info.kind === 'poster' ? '#view=Fit' : '#view=FitH');
    frame.title = info.title;
    rPages.replaceChildren(frame);
    rNotice.textContent = location.protocol === 'file:'
      ? 'Opened from your computer, so this uses the browser’s PDF viewer. The full reader and presenter tools work on the published site.'
      : 'Showing the browser’s PDF viewer because the presenter tools could not load.';
    rNotice.hidden = false;
  }

  function closeReader({ fromHistory = false } = {}) {
    if (reader.hidden) return;
    state.token++;
    if (state.observer) state.observer.disconnect();
    reader.hidden = true;
    rPages.innerHTML = '';
    root.classList.remove('viewer-open', 'bg-paused');
    if (!fromHistory) {
      if (state.pushed) history.back();
      else history.replaceState(null, '', location.pathname + location.search);
    }
    state.pushed = false;
    if (state.opener) state.opener.focus({ preventScroll: true });
  }

  function computeFitScale() {
    const avail = Math.max(240, rScroll.clientWidth - 48);
    const first = state.baseSizes[0];
    const isPoster = state.card.dataset.kind === 'poster';
    // Slides fill the width (up to 1200 px); posters fit the width up to 980 px so text stays legible
    const target = Math.min(avail, isPoster ? 980 : 1200);
    return target / first.w;
  }

  function buildPages() {
    if (state.observer) state.observer.disconnect();
    rPages.innerHTML = '';
    state.fitScale = computeFitScale();
    const scale = state.fitScale * state.zoom;
    rZoom.textContent = Math.round(state.zoom * 100) + '%';
    state.pages = state.baseSizes.map((size, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'reader-page-wrap';
      wrap.style.width = Math.floor(size.w * scale) + 'px';
      wrap.style.height = Math.floor(size.h * scale) + 'px';
      wrap.dataset.page = i + 1;
      const canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      rPages.appendChild(wrap);
      return { wrap, canvas, rendered: false, task: null };
    });
    state.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) drawPage(+entry.target.dataset.page); });
    }, { root: rScroll, rootMargin: '800px 0px' });
    state.pages.forEach(p => state.observer.observe(p.wrap));
  }

  async function drawPage(n) {
    const p = state.pages[n - 1];
    if (!p || p.rendered) return;
    p.rendered = true;
    const token = state.token;
    const page = await state.doc.getPage(n);
    if (token !== state.token) return;
    if (p.task) p.task.cancel();
    p.task = renderPage(page, p.canvas, state.fitScale * state.zoom);
    p.task.promise.catch(() => { p.rendered = false; });
  }

  function setZoom(z, anchorRatio) {
    const ratio = anchorRatio ?? (rScroll.scrollTop + rScroll.clientHeight / 2) / Math.max(1, rScroll.scrollHeight);
    state.zoom = Math.min(4, Math.max(0.5, z));
    buildPages();
    rScroll.scrollTop = ratio * rScroll.scrollHeight - rScroll.clientHeight / 2;
  }

  function goToPage(n) {
    if (!state.pages.length) return;
    n = Math.min(state.pages.length, Math.max(1, n));
    state.pages[n - 1].wrap.scrollIntoView({ block: 'start' });
    rInput.value = n;
    state.current = n;
  }

  rScroll.addEventListener('scroll', () => {
    if (!state.pages.length) return;
    const mid = rScroll.scrollTop + rScroll.clientHeight / 3;
    let n = 1;
    for (const p of state.pages) { if (p.wrap.offsetTop <= mid) n = +p.wrap.dataset.page; else break; }
    if (n !== state.current) { state.current = n; rInput.value = n; }
  }, { passive: true });

  rInput.addEventListener('change', () => goToPage(parseInt(rInput.value, 10) || 1));

  reader.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const v = b.dataset.v;
    if (v === 'close') closeReader();
    else if (v === 'prev') goToPage(state.current - 1);
    else if (v === 'next') goToPage(state.current + 1);
    else if (v === 'zoom-in') setZoom(state.zoom * 1.25);
    else if (v === 'zoom-out') setZoom(state.zoom / 1.25);
    else if (v === 'fit') setZoom(1);
    else if (v === 'present') {
      if (state.card.dataset.kind === 'slides' && state.doc) startPresenting();
      else toggleFullscreen(reader);
    }
  });

  // Ctrl/⌘ + wheel zooms the reader instead of the page
  rScroll.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey) || !state.doc) return;
    e.preventDefault();
    setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!reader.hidden && state.doc && presenter.hidden) {
        const page = state.current;
        buildPages();
        goToPage(page);
      }
      if (!presenter.hidden) showSlide(pres.index, true);
    }, 150);
  });

  function toggleFullscreen(el) {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }

  // ── Presenter ──
  // Tools: laser, spotlight, zoom, pen, highlighter, arrow / box / ellipse, colours and sizes, undo/redo,
  // erase, whiteboard, black screen, overview, talk countdown, progress bar, QR code for the audience,
  // and saving the current slide (with drawings) as an image.
  const QR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  const SITE_URL = 'https://prince-vats.github.io/pages/resources.html';
  const COLORS = ['#ff3b1f', '#ffd400', '#22c55e', '#2f80ff', '#ffffff', '#111111'];
  const SIZES = { s: 0.0025, m: 0.0042, l: 0.007 };    // stroke width as a fraction of slide width
  const DRAW_TOOLS = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse'];
  const TOOL_KEYS = { l: 'laser', s: 'spotlight', z: 'zoom', d: 'pen', h: 'highlighter', a: 'arrow', r: 'rect', o: 'ellipse' };

  const picon = {
    spot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/></svg>',
    hl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l-4 4h6l1.5-1.5M9 15l7.5-7.5 3 3L12 18M9 15l3 3"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5M10 5h9v9"/></svg>',
    rect: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="8.5" ry="6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    board: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4M7 12l3-3 2 2 4-4"/></svg>',
    qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  };

  const presenter = document.createElement('div');
  presenter.className = 'presenter';
  presenter.hidden = true;
  presenter.setAttribute('role', 'dialog');
  presenter.setAttribute('aria-modal', 'true');
  presenter.setAttribute('aria-label', 'Presentation');
  presenter.tabIndex = -1;
  presenter.innerHTML = `
    <div class="presenter-stage">
      <canvas class="presenter-slide"></canvas>
      <canvas class="presenter-ink"></canvas>
    </div>
    <div class="presenter-spot" hidden></div>
    <div class="presenter-laser" hidden></div>
    <div class="presenter-black" hidden></div>
    <div class="presenter-overview" hidden><div class="overview-grid"></div></div>
    <div class="presenter-qr" hidden>
      <div class="qr-card">
        <div class="qr-code" aria-hidden="true"></div>
        <p class="qr-title">Scan for these slides</p>
        <p class="qr-url"></p>
      </div>
    </div>
    <div class="presenter-help" hidden>
      <h3>Keyboard shortcuts</h3>
      <dl>
        <dt>→ Space PgDn</dt><dd>Next slide</dd>
        <dt>← PgUp</dt><dd>Previous slide</dd>
        <dt>Home / End</dt><dd>First / last slide</dd>
        <dt>number + Enter</dt><dd>Go to slide</dd>
        <dt>L</dt><dd>Laser pointer</dd>
        <dt>S</dt><dd>Spotlight (scroll to resize)</dd>
        <dt>Z</dt><dd>Zoom: click a region (scroll to adjust)</dd>
        <dt>D / H</dt><dd>Pen / highlighter</dd>
        <dt>A / R / O</dt><dd>Arrow / box / ellipse</dd>
        <dt>C · [ ]</dt><dd>Next colour · thinner / thicker</dd>
        <dt>Ctrl+Z / Ctrl+Y</dt><dd>Undo / redo</dd>
        <dt>E</dt><dd>Erase this slide's drawings</dd>
        <dt>W</dt><dd>Whiteboard</dd>
        <dt>B</dt><dd>Black screen</dd>
        <dt>G</dt><dd>Slide overview</dd>
        <dt>Q</dt><dd>QR code for the audience</dd>
        <dt>T</dt><dd>Restart timer</dd>
        <dt>Ctrl+S</dt><dd>Save slide as image</dd>
        <dt>Esc</dt><dd>Close / exit (hold to leave full screen)</dd>
      </dl>
    </div>

    <div class="presenter-pop pop-style" hidden>
      <div class="pop-row swatches">${COLORS.map((c, i) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Colour ${i + 1}"></button>`).join('')}</div>
      <div class="pop-row sizes">
        <button type="button" class="size-btn" data-size="s" aria-label="Thin"><span></span></button>
        <button type="button" class="size-btn" data-size="m" aria-label="Medium"><span></span></button>
        <button type="button" class="size-btn" data-size="l" aria-label="Thick"><span></span></button>
      </div>
    </div>
    <div class="presenter-pop pop-timer" hidden>
      <p class="pop-label">Talk length</p>
      <div class="pop-row chips">
        <button type="button" class="chip" data-duration="0">Count up</button>
        ${[5, 10, 12, 15, 20, 30].map(m => `<button type="button" class="chip" data-duration="${m * 60}">${m} min</button>`).join('')}
      </div>
      <div class="pop-row">
        <label class="pop-custom">Custom <input type="number" min="1" max="240" step="1" placeholder="min" /></label>
        <button type="button" class="chip" data-timer="restart">Restart</button>
      </div>
    </div>
    <div class="presenter-pop pop-more" hidden>
      <button type="button" class="menu-item" data-v="p-save">Save slide as image <kbd>Ctrl+S</kbd></button>
      <button type="button" class="menu-item" data-v="p-redo">Redo <kbd>Ctrl+Y</kbd></button>
      <button type="button" class="menu-item" data-v="p-help">Keyboard shortcuts <kbd>?</kbd></button>
    </div>

    <div class="presenter-progress" aria-hidden="true"><span></span></div>
    <div class="presenter-bar" role="toolbar" aria-label="Presentation tools">
      ${btn('p-prev', 'Previous slide', icon.prev)}
      <span class="presenter-count" id="presenterCount">1 / 1</span>
      ${btn('p-next', 'Next slide', icon.next)}
      <span class="vsep"></span>
      ${btn('t-laser', 'Laser pointer (L)', icon.laser, 'aria-pressed="false"')}
      ${btn('t-spotlight', 'Spotlight (S)', picon.spot, 'aria-pressed="false"')}
      ${btn('t-zoom', 'Zoom (Z)', picon.zoom, 'aria-pressed="false"')}
      <span class="vsep"></span>
      ${btn('t-pen', 'Pen (D)', icon.pen, 'aria-pressed="false"')}
      ${btn('t-highlighter', 'Highlighter (H)', picon.hl, 'aria-pressed="false"')}
      ${btn('t-arrow', 'Arrow (A)', picon.arrow, 'aria-pressed="false"')}
      ${btn('t-rect', 'Box (R)', picon.rect, 'aria-pressed="false"')}
      ${btn('t-ellipse', 'Ellipse (O)', picon.ellipse, 'aria-pressed="false"')}
      <button type="button" class="vbtn style-btn" data-v="p-style" aria-label="Colour and size (C, [ ])" title="Colour and size (C, [ ])" aria-haspopup="true"><span class="style-dot"></span></button>
      ${btn('p-undo', 'Undo (Ctrl+Z)', picon.undo)}
      ${btn('p-erase', 'Erase drawings (E)', icon.eraser)}
      <span class="vsep"></span>
      ${btn('p-board', 'Whiteboard (W)', picon.board, 'aria-pressed="false"')}
      ${btn('p-black', 'Black screen (B)', icon.black, 'aria-pressed="false"')}
      ${btn('p-grid', 'Slide overview (G)', icon.grid, 'aria-pressed="false"')}
      <span class="vsep"></span>
      <button type="button" class="presenter-timer" data-v="p-timer" title="Timer: click to set a talk length (T restarts)" aria-haspopup="true">00:00</button>
      ${btn('p-qr', 'QR code for the audience (Q)', picon.qr, 'aria-pressed="false"')}
      ${btn('p-more', 'More', picon.more, 'aria-haspopup="true"')}
      ${btn('p-exit', 'Exit presentation (Esc)', icon.close)}
    </div>`;
  document.body.appendChild(presenter);

  const $ = sel => presenter.querySelector(sel);
  const stage = $('.presenter-stage');
  const slideCanvas = $('.presenter-slide');
  const inkCanvas = $('.presenter-ink');
  const laser = $('.presenter-laser');
  const spot = $('.presenter-spot');
  const black = $('.presenter-black');
  const overview = $('.presenter-overview');
  const overviewGrid = $('.overview-grid');
  const qrLayer = $('.presenter-qr');
  const help = $('.presenter-help');
  const bar = $('.presenter-bar');
  const countEl = $('#presenterCount');
  const timerEl = $('.presenter-timer');
  const progressEl = $('.presenter-progress span');
  const popStyle = $('.pop-style');
  const popTimer = $('.pop-timer');
  const popMore = $('.pop-more');
  const pops = [popStyle, popTimer, popMore];
  const inkCtx = inkCanvas.getContext('2d');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('presenter.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('presenter.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const pres = {
    index: 1, tool: null, color: store.get('color', COLORS[0]), size: store.get('size', 'm'),
    ink: new Map(), drawing: null, cache: new Map(), size_: null,
    started: 0, duration: store.get('duration', 0), timer: null, idle: null, digits: '',
    zoom: 0, zoomOrigin: [0.5, 0.5], board: false, spotR: 170, wheelAt: 0, touchX: undefined,
  };

  // ── Lifecycle ──
  async function startPresenting() {
    if (!state.doc) return;
    pres.index = Math.min(state.current || 1, state.doc.numPages);
    pres.ink = new Map();
    pres.cache = new Map();
    pres.started = Date.now();
    pres.board = false;
    pres.zoom = 0;
    presenter.hidden = false;
    setTool(null);
    [black, overview, help, qrLayer].forEach(el => { el.hidden = true; });
    closePops();
    syncPressed();
    updateStyleDot();
    presenter.classList.remove('is-loading');
    if (!document.fullscreenElement && presenter.requestFullscreen) {
      try { await presenter.requestFullscreen(); } catch (e) { /* stays as a full-window overlay */ }
    }
    // Let Esc reach the page (close menus first); holding Esc still leaves full screen
    if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(() => {});
    showSlide(pres.index, true);
    clearInterval(pres.timer);
    pres.timer = setInterval(updateTimer, 500);
    updateTimer();
    wake();
    presenter.focus();
  }

  // Browsers only allow full screen during a click, and loading a PDF can take longer than that,
  // so the presenter takes over the screen immediately and fills in once the document is ready.
  function presenterShell() {
    presenter.hidden = false;
    presenter.classList.add('is-loading');
    countEl.textContent = 'Loading…';
    slideCanvas.width = 0;
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    if (presenter.requestFullscreen) presenter.requestFullscreen().catch(() => {});
  }

  function stopPresenting() {
    if (presenter.hidden) return;
    presenter.hidden = true;
    presenter.classList.remove('is-loading');
    clearInterval(pres.timer);
    closePops();
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    if (document.fullscreenElement === presenter) document.exitFullscreen().catch(() => {});
    goToPage(pres.index);
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !presenter.hidden) stopPresenting();
    if (!presenter.hidden) setTimeout(() => showSlide(pres.index, true), 50);
  });

  // ── Timer: counts up, or down from a chosen talk length ──
  function fmt(sec) {
    const s = Math.abs(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (sec < 0 ? '−' : '') + (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }
  function updateTimer() {
    const elapsed = Math.floor((Date.now() - pres.started) / 1000);
    if (!pres.duration) {
      timerEl.textContent = fmt(elapsed);
      timerEl.classList.remove('is-warn', 'is-over');
      return;
    }
    const left = pres.duration - elapsed;
    const warnAt = Math.min(120, Math.round(pres.duration * 0.2));
    timerEl.textContent = fmt(left);
    timerEl.classList.toggle('is-warn', left >= 0 && left <= warnAt);
    timerEl.classList.toggle('is-over', left < 0);
  }
  function setDuration(sec) {
    pres.duration = sec;
    store.set('duration', sec);
    pres.started = Date.now();
    updateTimer();
    popTimer.querySelectorAll('[data-duration]').forEach(b => b.classList.toggle('is-active', +b.dataset.duration === sec));
  }

  // ── Slides ──
  function fitScaleFor(base) {
    return Math.min(stage.clientWidth / base.width, stage.clientHeight / base.height);
  }

  async function renderSlideTo(n, canvas, zoom = 1) {
    const page = await state.doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const fit = fitScaleFor(base);
    await renderPage(page, canvas, fit * zoom).promise;
    // Keep the on-screen size at the fit size; extra pixels make zoomed views sharp
    canvas.style.width = Math.floor(base.width * fit) + 'px';
    canvas.style.height = Math.floor(base.height * fit) + 'px';
    return canvas;
  }

  function blit(src) {
    slideCanvas.width = src.width;
    slideCanvas.height = src.height;
    slideCanvas.style.width = src.style.width;
    slideCanvas.style.height = src.style.height;
    slideCanvas.getContext('2d').drawImage(src, 0, 0);
  }

  async function showSlide(n, force = false) {
    if (!state.doc) return;
    n = Math.min(state.doc.numPages, Math.max(1, n));
    const sizeKey = stage.clientWidth + 'x' + stage.clientHeight;
    if (sizeKey !== pres.size_) { pres.cache = new Map(); pres.size_ = sizeKey; }
    if (n === pres.index && !force && slideCanvas.width) return;
    if (n !== pres.index) { setSlideZoom(0); setBoard(false); }
    pres.index = n;
    countEl.textContent = n + ' / ' + state.doc.numPages;
    progressEl.style.width = (n / state.doc.numPages * 100) + '%';

    const cached = pres.cache.get(n);
    if (cached) blit(cached);
    else {
      const off = document.createElement('canvas');
      try { await renderSlideTo(n, off); } catch (e) { return; }
      if (pres.index !== n) return;
      pres.cache.set(n, off);
      blit(off);
    }
    if (pres.zoom) renderZoomed();
    sizeInk();
    redrawInk();
    for (const m of [n + 1, n - 1]) {
      if (m < 1 || m > state.doc.numPages || pres.cache.has(m)) continue;
      const off = document.createElement('canvas');
      renderSlideTo(m, off).then(() => { if (pres.size_ === sizeKey) pres.cache.set(m, off); }).catch(() => {});
    }
  }

  function next() {
    if (!black.hidden) { black.hidden = true; syncPressed(); return; }
    if (pres.board) { setBoard(false); return; }
    showSlide(pres.index + 1);
  }
  function prev() {
    if (!black.hidden) { black.hidden = true; syncPressed(); return; }
    if (pres.board) { setBoard(false); return; }
    showSlide(pres.index - 1);
  }

  // ── Zoom: magnify around a point, re-rendered at higher resolution so text stays sharp ──
  async function renderZoomed() {
    const n = pres.index, z = pres.zoom;
    const off = document.createElement('canvas');
    try { await renderSlideTo(n, off, z); } catch (e) { return; }
    if (pres.index !== n || pres.zoom !== z) return;
    blit(off);
    sizeInk();
    redrawInk();
  }

  function applyZoomTransform() {
    const [ox, oy] = pres.zoomOrigin;
    const t = pres.zoom ? `scale(${pres.zoom})` : '';
    for (const c of [slideCanvas, inkCanvas]) {
      c.style.transformOrigin = `${ox * 100}% ${oy * 100}%`;
      c.style.transform = t;
    }
    presenter.classList.toggle('is-zoomed', !!pres.zoom);
  }

  function setSlideZoom(z, origin) {
    const was = pres.zoom;
    pres.zoom = z ? Math.min(5, Math.max(1.5, z)) : 0;
    if (origin) pres.zoomOrigin = origin;
    applyZoomTransform();
    if (pres.zoom && pres.zoom !== was) renderZoomed();
    else if (!pres.zoom && was) {
      const cached = pres.cache.get(pres.index);
      if (cached) { blit(cached); sizeInk(); redrawInk(); }
    }
  }

  // ── Whiteboard: a blank page with its own drawings ──
  function setBoard(on) {
    pres.board = on;
    presenter.classList.toggle('is-board', on);
    if (on) setSlideZoom(0);
    redrawInk();
    syncPressed();
  }

  // ── Ink: shapes and strokes in slide-relative coordinates, so they survive resizes and zoom ──
  const inkKey = () => (pres.board ? 'board' : pres.index);
  function layer(key = inkKey()) {
    if (!pres.ink.has(key)) pres.ink.set(key, { items: [], redo: [] });
    return pres.ink.get(key);
  }

  function sizeInk() {
    const ratio = (window.devicePixelRatio || 1) * (pres.zoom || 1);
    inkCanvas.style.width = slideCanvas.style.width;
    inkCanvas.style.height = slideCanvas.style.height;
    inkCanvas.width = Math.floor(parseFloat(slideCanvas.style.width || 0) * ratio);
    inkCanvas.height = Math.floor(parseFloat(slideCanvas.style.height || 0) * ratio);
  }

  function drawItem(ctx, it, w, h) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    ctx.lineWidth = Math.max(1.5, it.w * w);
    if (it.type === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(8, it.w * w * 4);
      ctx.lineCap = 'butt';
    }
    if (it.type === 'pen' || it.type === 'highlighter') {
      ctx.beginPath();
      it.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      if (it.pts.length === 1) ctx.lineTo(it.pts[0][0] * w + 0.1, it.pts[0][1] * h);
      ctx.stroke();
    } else {
      const ax = it.a[0] * w, ay = it.a[1] * h, bx = it.b[0] * w, by = it.b[1] * h;
      ctx.beginPath();
      if (it.type === 'rect') ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      else if (it.type === 'ellipse') ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
      else if (it.type === 'arrow') { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke();
      if (it.type === 'arrow') {
        const ang = Math.atan2(by - ay, bx - ax), len = Math.max(12, ctx.lineWidth * 4.5);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - len * Math.cos(ang - 0.45), by - len * Math.sin(ang - 0.45));
        ctx.lineTo(bx - len * Math.cos(ang + 0.45), by - len * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function redrawInk() {
    const w = inkCanvas.width, h = inkCanvas.height;
    inkCtx.clearRect(0, 0, w, h);
    const items = layer().items.slice();
    if (pres.drawing) items.push(pres.drawing);
    for (const it of items) drawItem(inkCtx, it, w, h);
  }

  function undo() { const L = layer(); if (L.items.length) { L.redo.push(L.items.pop()); redrawInk(); } }
  function redo() { const L = layer(); if (L.redo.length) { L.items.push(L.redo.pop()); redrawInk(); } }
  function eraseAll() { const L = layer(); if (L.items.length) { L.redo = L.items.reverse(); L.items = []; redrawInk(); } }

  function slidePoint(e) {
    const r = slideCanvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  // ── Tools ──
  function setTool(tool) {
    pres.tool = pres.tool === tool ? null : tool;
    presenter.dataset.tool = pres.tool || '';
    laser.hidden = pres.tool !== 'laser';
    spot.hidden = pres.tool !== 'spotlight';
    if (pres.tool !== 'zoom' && pres.zoom && !DRAW_TOOLS.includes(pres.tool)) setSlideZoom(0);
    syncPressed();
  }

  function syncPressed() {
    const on = (v, flag) => { const b = bar.querySelector(`[data-v="${v}"]`); if (b) b.setAttribute('aria-pressed', String(!!flag)); };
    ['laser', 'spotlight', 'zoom', ...DRAW_TOOLS].forEach(t => on('t-' + t, pres.tool === t));
    on('p-board', pres.board);
    on('p-black', !black.hidden);
    on('p-grid', !overview.hidden);
    on('p-qr', !qrLayer.hidden);
  }

  function updateStyleDot() {
    const dot = bar.querySelector('.style-dot');
    dot.style.setProperty('--c', pres.color);
    dot.dataset.size = pres.size;
    popStyle.querySelectorAll('.swatch').forEach(b => b.classList.toggle('is-active', b.dataset.color === pres.color));
    popStyle.querySelectorAll('.size-btn').forEach(b => b.classList.toggle('is-active', b.dataset.size === pres.size));
  }
  function setColor(c) {
    pres.color = c;
    store.set('color', c);
    updateStyleDot();
    if (!DRAW_TOOLS.includes(pres.tool)) setTool('pen');
  }
  function setSize(s) { pres.size = s; store.set('size', s); updateStyleDot(); }

  // ── Popovers ──
  function closePops() { pops.forEach(p => { p.hidden = true; }); }
  function togglePop(pop, anchor) {
    const open = pop.hidden;
    closePops();
    if (!open) return;
    pop.hidden = false;
    const a = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect();
    const left = Math.min(window.innerWidth - p.width - 8, Math.max(8, a.left + a.width / 2 - p.width / 2));
    pop.style.left = left + 'px';
    pop.style.bottom = (window.innerHeight - a.top + 10) + 'px';
  }

  // ── Overview ──
  function toggleOverview(force) {
    const show = force ?? overview.hidden;
    overview.hidden = !show;
    syncPressed();
    if (!show) return;
    overviewGrid.innerHTML = '';
    for (let i = 1; i <= state.doc.numPages; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'overview-item' + (i === pres.index ? ' is-current' : '');
      b.dataset.slide = i;
      b.setAttribute('aria-label', 'Slide ' + i);
      const c = document.createElement('canvas');
      const label = document.createElement('span');
      label.textContent = i;
      b.append(c, label);
      overviewGrid.appendChild(b);
      state.doc.getPage(i).then(page => {
        const base = page.getViewport({ scale: 1 });
        return renderPage(page, c, 220 / base.width).promise;
      }).catch(() => {});
    }
    const current = overviewGrid.querySelector('.is-current');
    if (current) current.scrollIntoView({ block: 'center' });
  }

  // ── QR code for the audience ──
  let qrPromise = null;
  function loadQr() {
    if (!qrPromise) {
      qrPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = QR_URL;
        s.onload = () => resolve(window.qrcode);
        s.onerror = () => { qrPromise = null; reject(new Error('qr')); };
        document.head.appendChild(s);
      });
    }
    return qrPromise;
  }
  function deckUrl() {
    // A file:// or localhost address is useless to the audience, so point to the published page
    const local = location.protocol === 'file:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
    return (local ? SITE_URL : location.origin + location.pathname) + '#' + state.card.id;
  }
  async function toggleQr(force) {
    const show = force ?? qrLayer.hidden;
    qrLayer.hidden = !show;
    syncPressed();
    if (!show) return;
    const url = deckUrl();
    qrLayer.querySelector('.qr-url').textContent = url.replace(/^https?:\/\//, '');
    const box = qrLayer.querySelector('.qr-code');
    box.textContent = '';
    try {
      const qrcode = await loadQr();
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    } catch (e) {
      box.textContent = 'QR code unavailable offline';
    }
  }

  // ── Save the current slide (with drawings) as a PNG ──
  function saveSlide() {
    const out = document.createElement('canvas');
    out.width = inkCanvas.width;
    out.height = inkCanvas.height;
    const ctx = out.getContext('2d');
    if (pres.board) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height); }
    else ctx.drawImage(slideCanvas, 0, 0, out.width, out.height);
    ctx.drawImage(inkCanvas, 0, 0);
    out.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${state.card.id}-${pres.board ? 'whiteboard' : 'slide-' + pres.index}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, 'image/png');
  }

  // ── Pointer: drawing, zoom, laser, spotlight, click / swipe navigation ──
  stage.addEventListener('pointerdown', e => {
    closePops();
    if (DRAW_TOOLS.includes(pres.tool)) {
      stage.setPointerCapture(e.pointerId);
      const p = slidePoint(e);
      const base = { type: pres.tool, color: pres.color, w: SIZES[pres.size] || SIZES.m };
      pres.drawing = pres.tool === 'pen' || pres.tool === 'highlighter' ? { ...base, pts: [p] } : { ...base, a: p, b: p };
      redrawInk();
      return;
    }
    if (pres.tool === 'zoom' && e.button === 0) {
      if (pres.zoom) setSlideZoom(0);
      else {
        const [x, y] = slidePoint(e);
        setSlideZoom(pres.lastZoom || 2.5, [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
      }
      return;
    }
    if (e.pointerType === 'touch') { pres.touchX = e.clientX; return; }
    if (e.button !== 0) return;
    const r = stage.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) prev(); else next();
  });

  presenter.addEventListener('pointermove', e => {
    if (pres.tool === 'laser') laser.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    if (pres.tool === 'spotlight') {
      spot.style.setProperty('--sx', e.clientX + 'px');
      spot.style.setProperty('--sy', e.clientY + 'px');
    }
    if (pres.drawing) {
      const p = slidePoint(e);
      if (pres.drawing.pts) pres.drawing.pts.push(p); else pres.drawing.b = p;
      redrawInk();
    }
  });

  stage.addEventListener('pointerup', e => {
    if (pres.drawing) {
      const d = pres.drawing;
      pres.drawing = null;
      const tiny = d.a && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 0.004;
      if (!tiny) { const L = layer(); L.items.push(d); L.redo = []; }
      redrawInk();
      return;
    }
    if (e.pointerType === 'touch' && pres.touchX !== undefined) {
      const dx = e.clientX - pres.touchX;
      if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
      else next();
      pres.touchX = undefined;
    }
  });

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    if (pres.tool === 'spotlight') {
      pres.spotR = Math.min(600, Math.max(60, pres.spotR * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      spot.style.setProperty('--sr', pres.spotR + 'px');
    } else if (pres.zoom || pres.tool === 'zoom') {
      const z = (pres.zoom || 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
      if (z < 1.4) setSlideZoom(0);
      else {
        const [x, y] = slidePoint(e);
        pres.lastZoom = z;
        setSlideZoom(z, pres.zoom ? pres.zoomOrigin : [x, y]);
      }
    } else if (Date.now() - pres.wheelAt > 450 && Math.abs(e.deltaY) > 20) {
      pres.wheelAt = Date.now();
      (e.deltaY > 0 ? next : prev)();
    }
  }, { passive: false });

  black.addEventListener('click', () => { black.hidden = true; syncPressed(); });
  qrLayer.addEventListener('click', () => toggleQr(false));
  overviewGrid.addEventListener('click', e => {
    const item = e.target.closest('.overview-item');
    if (!item) return;
    toggleOverview(false);
    setBoard(false);
    showSlide(+item.dataset.slide);
  });

  // ── Toolbar and popovers ──
  function runAction(v, anchor) {
    if (v.startsWith('t-')) return setTool(v.slice(2));
    if (v === 'p-prev') prev();
    else if (v === 'p-next') next();
    else if (v === 'p-style') togglePop(popStyle, anchor);
    else if (v === 'p-undo') undo();
    else if (v === 'p-redo') { redo(); closePops(); }
    else if (v === 'p-erase') eraseAll();
    else if (v === 'p-board') setBoard(!pres.board);
    else if (v === 'p-black') { black.hidden = !black.hidden; syncPressed(); }
    else if (v === 'p-grid') toggleOverview();
    else if (v === 'p-timer') togglePop(popTimer, anchor);
    else if (v === 'p-qr') toggleQr();
    else if (v === 'p-more') togglePop(popMore, anchor);
    else if (v === 'p-save') { saveSlide(); closePops(); }
    else if (v === 'p-help') { help.hidden = !help.hidden; closePops(); }
    else if (v === 'p-exit') stopPresenting();
  }
  presenter.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (b && (bar.contains(b) || popMore.contains(b))) { runAction(b.dataset.v, b); return; }
    const sw = e.target.closest('.swatch');
    if (sw) { setColor(sw.dataset.color); return; }
    const sz = e.target.closest('.size-btn');
    if (sz) { setSize(sz.dataset.size); return; }
    const d = e.target.closest('[data-duration]');
    if (d) { setDuration(+d.dataset.duration); closePops(); return; }
    if (e.target.closest('[data-timer="restart"]')) { pres.started = Date.now(); updateTimer(); closePops(); }
  });
  popTimer.querySelector('input').addEventListener('change', e => {
    const m = Math.round(+e.target.value);
    if (m > 0) { setDuration(m * 60); closePops(); }
  });

  // Auto-hide the toolbar and cursor while presenting (kept visible while a menu is open)
  function wake() {
    presenter.classList.remove('is-idle');
    clearTimeout(pres.idle);
    pres.idle = setTimeout(() => {
      if (!presenter.hidden && pops.every(p => p.hidden) && !pres.drawing) presenter.classList.add('is-idle');
    }, 2500);
  }
  presenter.addEventListener('pointermove', wake);

  // ── Keyboard ──
  document.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (!presenter.hidden) {
      const k = e.key, lower = k.length === 1 ? k.toLowerCase() : k, mod = e.ctrlKey || e.metaKey;
      let handled = true;
      if (mod && lower === 'z' && !e.shiftKey) undo();
      else if (mod && (lower === 'y' || (lower === 'z' && e.shiftKey))) redo();
      else if (mod && lower === 's') saveSlide();
      else if (mod) handled = false;
      else if (/^[0-9]$/.test(k)) pres.digits += k;
      else if (k === 'Enter' && pres.digits) { setBoard(false); showSlide(parseInt(pres.digits, 10)); pres.digits = ''; }
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) prev();
      else if (k === 'Home') { setBoard(false); showSlide(1); }
      else if (k === 'End') { setBoard(false); showSlide(state.doc.numPages); }
      else if (TOOL_KEYS[lower]) setTool(TOOL_KEYS[lower]);
      else if (lower === 'c') setColor(COLORS[(COLORS.indexOf(pres.color) + 1) % COLORS.length]);
      else if (k === '[') setSize(pres.size === 'l' ? 'm' : 's');
      else if (k === ']') setSize(pres.size === 's' ? 'm' : 'l');
      else if (lower === 'u') undo();
      else if (lower === 'e') eraseAll();
      else if (lower === 'w') setBoard(!pres.board);
      else if (lower === 'b' || k === '.') { black.hidden = !black.hidden; syncPressed(); }
      else if (lower === 'g') toggleOverview();
      else if (lower === 'q') toggleQr();
      else if (lower === 't') { pres.started = Date.now(); updateTimer(); }
      else if (k === '?') help.hidden = !help.hidden;
      else if (k === 'Escape') {
        if (pops.some(p => !p.hidden)) closePops();
        else if (!qrLayer.hidden) toggleQr(false);
        else if (!overview.hidden) toggleOverview(false);
        else if (!help.hidden) help.hidden = true;
        else if (pres.zoom) setSlideZoom(0);
        else if (pres.tool) setTool(pres.tool);
        else if (pres.board) setBoard(false);
        else stopPresenting();
      } else handled = false;
      if (handled) { e.preventDefault(); wake(); }
      return;
    }
    if (!reader.hidden) {
      if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); closeReader(); }
      else if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(state.zoom * 1.25); }
      else if (e.key === '-' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setZoom(state.zoom / 1.25); }
    }
  });

  // ── Cards: read / present / share ──
  document.addEventListener('click', e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const card = actionEl.closest('.resource');
    if (!card) return;
    const action = actionEl.dataset.action;
    if (action === 'read' || action === 'present') {
      e.preventDefault();
      if (action === 'present') presenterShell();
      openReader(card, { opener: actionEl, present: action === 'present' });
    } else if (action === 'share') {
      const url = location.href.split('#')[0] + '#' + card.id;
      const label = actionEl.textContent;
      const done = () => {
        actionEl.textContent = 'Link copied';
        actionEl.classList.add('is-done');
        setTimeout(() => { actionEl.textContent = label; actionEl.classList.remove('is-done'); }, 1600);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
      else window.prompt('Copy this link:', url);
    }
  });

  // ── Deep links and the back button ──
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const card = id && document.getElementById(id);
    if (card && card.classList.contains('resource')) {
      if (reader.hidden || state.card !== card) openReader(card, { push: false });
    } else if (!reader.hidden) {
      stopPresenting();
      closeReader({ fromHistory: true });
    }
  }
  window.addEventListener('popstate', () => { state.pushed = false; openFromHash(); });
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
})();
