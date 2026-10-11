// ─── Resources: PDF reader & presenter ───
// Cards in pages/resources.html carry data-pdf / data-kind / data-pages. This script adds:
//  • Reader: an in-page viewer with lazy page rendering, zoom, page jump and download.
//  • Presenter (slide decks): full screen, one slide at a time, with a laser pointer, pen,
//    blackout, slide overview, timer and keyboard/touch navigation.
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
      <div class="presenter-laser" hidden></div>
    </div>
    <div class="presenter-black" hidden></div>
    <div class="presenter-overview" hidden><div class="overview-grid"></div></div>
    <div class="presenter-help" hidden>
      <h3>Keyboard shortcuts</h3>
      <dl>
        <dt>→ Space PgDn</dt><dd>Next slide</dd>
        <dt>← PgUp</dt><dd>Previous slide</dd>
        <dt>Home / End</dt><dd>First / last slide</dd>
        <dt>number + Enter</dt><dd>Go to slide</dd>
        <dt>L</dt><dd>Laser pointer</dd>
        <dt>D</dt><dd>Draw on the slide</dd>
        <dt>E</dt><dd>Erase drawings</dd>
        <dt>B</dt><dd>Black screen</dd>
        <dt>G</dt><dd>Slide overview</dd>
        <dt>T</dt><dd>Reset timer</dd>
        <dt>Esc</dt><dd>Exit</dd>
      </dl>
    </div>
    <div class="presenter-bar">
      ${btn('p-prev', 'Previous slide', icon.prev)}
      <span class="presenter-count" id="presenterCount">1 / 1</span>
      ${btn('p-next', 'Next slide', icon.next)}
      <span class="vsep"></span>
      ${btn('p-laser', 'Laser pointer (L)', icon.laser, 'aria-pressed="false"')}
      ${btn('p-pen', 'Draw (D)', icon.pen, 'aria-pressed="false"')}
      ${btn('p-erase', 'Erase drawings (E)', icon.eraser)}
      ${btn('p-black', 'Black screen (B)', icon.black, 'aria-pressed="false"')}
      ${btn('p-grid', 'Slide overview (G)', icon.grid, 'aria-pressed="false"')}
      <span class="vsep"></span>
      <button type="button" class="presenter-timer" data-v="p-timer" title="Elapsed time, click to reset (T)">00:00</button>
      ${btn('p-help', 'Keyboard shortcuts (?)', icon.help)}
      ${btn('p-exit', 'Exit presentation (Esc)', icon.close)}
    </div>`;
  document.body.appendChild(presenter);

  const stage = presenter.querySelector('.presenter-stage');
  const slideCanvas = presenter.querySelector('.presenter-slide');
  const inkCanvas = presenter.querySelector('.presenter-ink');
  const laser = presenter.querySelector('.presenter-laser');
  const black = presenter.querySelector('.presenter-black');
  const overview = presenter.querySelector('.presenter-overview');
  const overviewGrid = presenter.querySelector('.overview-grid');
  const help = presenter.querySelector('.presenter-help');
  const countEl = presenter.querySelector('#presenterCount');
  const timerEl = presenter.querySelector('.presenter-timer');
  const inkCtx = inkCanvas.getContext('2d');

  const pres = {
    index: 1, mode: null, ink: new Map(), stroke: null, task: null, cache: new Map(),
    started: 0, timer: null, idle: null, digits: '', size: null,
  };

  async function startPresenting() {
    if (!state.doc) return;
    pres.index = Math.min(state.current || 1, state.doc.numPages);
    pres.ink = new Map();
    pres.cache = new Map();
    pres.started = Date.now();
    presenter.hidden = false;
    setMode(null);
    black.hidden = true;
    overview.hidden = true;
    help.hidden = true;
    presenter.classList.remove('is-loading');
    if (!document.fullscreenElement && presenter.requestFullscreen) {
      try { await presenter.requestFullscreen(); } catch (e) { /* stays as a full-window overlay */ }
    }
    showSlide(pres.index, true);
    clearInterval(pres.timer);
    pres.timer = setInterval(updateTimer, 1000);
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
    if (pres.task) pres.task.cancel();
    if (document.fullscreenElement === presenter) document.exitFullscreen().catch(() => {});
    goToPage(pres.index);
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !presenter.hidden) stopPresenting();
    if (!presenter.hidden) setTimeout(() => showSlide(pres.index, true), 50);
  });

  function updateTimer() {
    const s = Math.floor((Date.now() - pres.started) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    timerEl.textContent = (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  // Render slide n to fit the stage; neighbours are pre-rendered into a small cache
  async function renderSlideTo(n, canvas) {
    const page = await state.doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(stage.clientWidth / base.width, stage.clientHeight / base.height);
    const task = renderPage(page, canvas, scale);
    await task.promise;
    return canvas;
  }

  async function showSlide(n, force = false) {
    if (!state.doc) return;
    n = Math.min(state.doc.numPages, Math.max(1, n));
    const sizeKey = stage.clientWidth + 'x' + stage.clientHeight;
    if (sizeKey !== pres.size) { pres.cache = new Map(); pres.size = sizeKey; }
    if (n === pres.index && !force && slideCanvas.width) return;
    pres.index = n;
    countEl.textContent = n + ' / ' + state.doc.numPages;

    const cached = pres.cache.get(n);
    if (cached) {
      slideCanvas.width = cached.width;
      slideCanvas.height = cached.height;
      slideCanvas.style.width = cached.style.width;
      slideCanvas.style.height = cached.style.height;
      slideCanvas.getContext('2d').drawImage(cached, 0, 0);
    } else {
      const off = document.createElement('canvas');
      try { await renderSlideTo(n, off); } catch (e) { return; }
      if (pres.index !== n) return;
      pres.cache.set(n, off);
      slideCanvas.width = off.width;
      slideCanvas.height = off.height;
      slideCanvas.style.width = off.style.width;
      slideCanvas.style.height = off.style.height;
      slideCanvas.getContext('2d').drawImage(off, 0, 0);
    }
    sizeInk();
    redrawInk();
    // Pre-render the next and previous slides
    for (const m of [n + 1, n - 1]) {
      if (m < 1 || m > state.doc.numPages || pres.cache.has(m)) continue;
      const off = document.createElement('canvas');
      renderSlideTo(m, off).then(() => { if (pres.size === sizeKey) pres.cache.set(m, off); }).catch(() => {});
    }
  }

  function next() { if (black.hidden) showSlide(pres.index + 1); else black.hidden = true; }
  function prev() { if (black.hidden) showSlide(pres.index - 1); else black.hidden = true; }

  // ── Ink (stored in slide-relative coordinates so it survives resizes) ──
  function sizeInk() {
    const ratio = window.devicePixelRatio || 1;
    inkCanvas.style.width = slideCanvas.style.width;
    inkCanvas.style.height = slideCanvas.style.height;
    inkCanvas.width = Math.floor(parseFloat(slideCanvas.style.width) * ratio);
    inkCanvas.height = Math.floor(parseFloat(slideCanvas.style.height) * ratio);
  }

  function redrawInk() {
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    const strokes = pres.ink.get(pres.index) || [];
    const w = inkCanvas.width, h = inkCanvas.height;
    inkCtx.lineCap = 'round';
    inkCtx.lineJoin = 'round';
    inkCtx.strokeStyle = '#ff3b1f';
    inkCtx.lineWidth = Math.max(2, w * 0.0035);
    for (const s of strokes) {
      inkCtx.beginPath();
      s.forEach(([x, y], i) => (i ? inkCtx.lineTo(x * w, y * h) : inkCtx.moveTo(x * w, y * h)));
      inkCtx.stroke();
    }
  }

  function slidePoint(e) {
    const r = slideCanvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  function setMode(mode) {
    pres.mode = pres.mode === mode ? null : mode;
    presenter.classList.toggle('is-laser', pres.mode === 'laser');
    presenter.classList.toggle('is-pen', pres.mode === 'pen');
    presenter.querySelector('[data-v="p-laser"]').setAttribute('aria-pressed', String(pres.mode === 'laser'));
    presenter.querySelector('[data-v="p-pen"]').setAttribute('aria-pressed', String(pres.mode === 'pen'));
    laser.hidden = pres.mode !== 'laser';
  }

  function toggleOverview(force) {
    const show = force ?? overview.hidden;
    overview.hidden = !show;
    presenter.querySelector('[data-v="p-grid"]').setAttribute('aria-pressed', String(show));
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

  stage.addEventListener('pointerdown', e => {
    if (pres.mode === 'pen') {
      stage.setPointerCapture(e.pointerId);
      pres.stroke = [slidePoint(e)];
      if (!pres.ink.has(pres.index)) pres.ink.set(pres.index, []);
      pres.ink.get(pres.index).push(pres.stroke);
      return;
    }
    if (e.pointerType === 'touch') { pres.touchX = e.clientX; return; }
    if (e.button !== 0) return;
    // Click: right two-thirds advances, left third goes back
    const r = stage.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) prev(); else next();
  });
  stage.addEventListener('pointermove', e => {
    if (pres.mode === 'laser') {
      laser.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }
    if (pres.mode === 'pen' && pres.stroke) {
      pres.stroke.push(slidePoint(e));
      redrawInk();
    }
  });
  stage.addEventListener('pointerup', e => {
    if (pres.stroke) { pres.stroke = null; return; }
    if (e.pointerType === 'touch' && pres.touchX !== undefined) {
      const dx = e.clientX - pres.touchX;
      if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
      else next();
      pres.touchX = undefined;
    }
  });
  black.addEventListener('click', () => { black.hidden = true; });
  overviewGrid.addEventListener('click', e => {
    const item = e.target.closest('.overview-item');
    if (!item) return;
    toggleOverview(false);
    showSlide(+item.dataset.slide);
  });

  presenter.querySelector('.presenter-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const v = b.dataset.v;
    if (v === 'p-prev') prev();
    else if (v === 'p-next') next();
    else if (v === 'p-laser') setMode('laser');
    else if (v === 'p-pen') setMode('pen');
    else if (v === 'p-erase') { pres.ink.delete(pres.index); redrawInk(); }
    else if (v === 'p-black') black.hidden = !black.hidden;
    else if (v === 'p-grid') toggleOverview();
    else if (v === 'p-timer') { pres.started = Date.now(); updateTimer(); }
    else if (v === 'p-help') help.hidden = !help.hidden;
    else if (v === 'p-exit') stopPresenting();
  });

  // Auto-hide the toolbar and cursor while presenting
  function wake() {
    presenter.classList.remove('is-idle');
    clearTimeout(pres.idle);
    pres.idle = setTimeout(() => { if (!presenter.hidden) presenter.classList.add('is-idle'); }, 2500);
  }
  presenter.addEventListener('pointermove', wake);

  // ── Keyboard ──
  document.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input, textarea')) return;
    if (!presenter.hidden) {
      const k = e.key;
      let handled = true;
      if (/^[0-9]$/.test(k)) { pres.digits += k; }
      else if (k === 'Enter' && pres.digits) { showSlide(parseInt(pres.digits, 10)); pres.digits = ''; }
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) prev();
      else if (k === 'Home') showSlide(1);
      else if (k === 'End') showSlide(state.doc.numPages);
      else if (k === 'l' || k === 'L') setMode('laser');
      else if (k === 'd' || k === 'D') setMode('pen');
      else if (k === 'e' || k === 'E') { pres.ink.delete(pres.index); redrawInk(); }
      else if (k === 'b' || k === 'B' || k === '.') black.hidden = !black.hidden;
      else if (k === 'g' || k === 'G') toggleOverview();
      else if (k === 't' || k === 'T') { pres.started = Date.now(); updateTimer(); }
      else if (k === '?' || k === 'h' || k === 'H') help.hidden = !help.hidden;
      else if (k === 'Escape') {
        if (!overview.hidden) toggleOverview(false);
        else if (!help.hidden) help.hidden = true;
        else if (pres.mode) setMode(pres.mode);
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
