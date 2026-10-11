// ─── Dark Mode Toggle ───
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// The saved theme is applied by an inline script in each page's <head> (avoids a
// flash of the wrong theme); this re-applies it in case that script was skipped.
let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
if (savedTheme) html.classList.toggle('light-mode', savedTheme === 'light');
updateThemeState();

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isLightMode = html.classList.toggle('light-mode');
    try { localStorage.setItem('theme', isLightMode ? 'light' : 'dark'); } catch (e) { /* ignore */ }
    updateThemeState();
  });
}

// The sun/moon icons are swapped in CSS; keep the button's state announced
function updateThemeState() {
  if (themeToggle) themeToggle.setAttribute('aria-pressed', String(html.classList.contains('light-mode')));
}

// ─── Navbar scroll effect ───
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  });
  // trigger on load in case page is already scrolled
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}

// ─── Hamburger toggle ───
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('active');
    hamburger.classList.toggle('active', isOpen);
    hamburger.setAttribute('aria-expanded', isOpen);
  });

  // Close menu on link click
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('active');
      hamburger.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
}

// ─── Scroll-reveal observer ───
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.01, rootMargin: '0px 0px 40px 0px' });

// Observe and check elements initially in view
document.querySelectorAll('.reveal').forEach(el => {
  const rect = el.getBoundingClientRect();
  if (rect.top < window.innerHeight && rect.bottom > 0) {
    el.classList.add('visible');
  } else {
    revealObserver.observe(el);
  }
});

// ─── In-page sub-navigation: highlight the section in view ───
const subnavLinks = document.querySelectorAll('.subnav a[href^="#"]');
if (subnavLinks.length) {
  const targets = Array.from(subnavLinks)
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  const setActive = (id) => {
    subnavLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + id));
  };
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) setActive(entry.target.id); });
  }, { rootMargin: '-30% 0px -60% 0px' });
  targets.forEach(target => sectionObserver.observe(target));
}

// ─── Image Lightbox Modal ───
document.addEventListener('DOMContentLoaded', () => {
  let lightbox = document.getElementById('lightboxModal');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightboxModal';
    lightbox.className = 'lightbox-modal';
    lightbox.innerHTML = `
      <button class="lightbox-close" id="lightboxClose" aria-label="Close enlarged view">&times;</button>
      <button class="lightbox-nav lightbox-prev" id="lightboxPrev" aria-label="Previous image">&#10094;</button>
      <button class="lightbox-nav lightbox-next" id="lightboxNext" aria-label="Next image">&#10095;</button>
      <div class="lightbox-container">
        <img class="lightbox-img" id="lightboxImg" src="" alt="Enlarged view" />
        <div class="lightbox-details" id="lightboxDetails"></div>
      </div>
    `;
    document.body.appendChild(lightbox);
  }

  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxDetails = document.getElementById('lightboxDetails');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  let mediaItems = [];
  let currentIndex = -1;

  function updateLightboxItem(index) {
    if (index < 0 || index >= mediaItems.length) return;
    currentIndex = index;
    const mediaItem = mediaItems[currentIndex];
    const img = mediaItem.querySelector('img');
    const src = mediaItem.getAttribute('href') || (img ? img.src : '');
    const alt = img ? img.alt : '';

    if (lightboxImg) {
      lightboxImg.src = src;
      lightboxImg.alt = alt || 'Enlarged Image';
    }

    const eventItem = mediaItem.closest('.event-item');
    const eventContent = eventItem ? eventItem.querySelector('.event-content') : null;

    if (lightboxDetails) {
      if (eventContent) {
        lightboxDetails.innerHTML = eventContent.innerHTML;
        lightboxDetails.style.display = 'block';
      } else if (alt) {
        lightboxDetails.innerHTML = '';
        const caption = document.createElement('p');
        caption.className = 'lightbox-alt';
        caption.textContent = alt;
        lightboxDetails.appendChild(caption);
        lightboxDetails.style.display = 'block';
      } else {
        lightboxDetails.style.display = 'none';
      }
    }

    const showNav = mediaItems.length > 1;
    if (lightboxPrev) lightboxPrev.style.display = showNav ? 'flex' : 'none';
    if (lightboxNext) lightboxNext.style.display = showNav ? 'flex' : 'none';
  }

  function openLightbox(clickedMediaItem) {
    mediaItems = Array.from(document.querySelectorAll('.event-media, .research-media')).filter(el => el.offsetParent !== null || el.offsetWidth > 0);
    const index = mediaItems.indexOf(clickedMediaItem);
    if (index !== -1) {
      updateLightboxItem(index);
    } else {
      mediaItems = [clickedMediaItem];
      updateLightboxItem(0);
    }

    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (lightboxImg) lightboxImg.src = '';
    }, 350);
  }

  function showNext() {
    if (mediaItems.length <= 1) return;
    const nextIndex = (currentIndex + 1) % mediaItems.length;
    updateLightboxItem(nextIndex);
  }

  function showPrev() {
    if (mediaItems.length <= 1) return;
    const prevIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length;
    updateLightboxItem(prevIndex);
  }

  // Intercept click on any .event-media or .research-media container or image element
  document.body.addEventListener('click', (e) => {
    const mediaItem = e.target.closest('.event-media, .research-media');
    if (mediaItem) {
      e.preventDefault();
      openLightbox(mediaItem);
    }
  });

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxPrev) lightboxPrev.addEventListener('click', (e) => { e.stopPropagation(); showPrev(); });
  if (lightboxNext) lightboxNext.addEventListener('click', (e) => { e.stopPropagation(); showNext(); });

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowRight') {
      showNext();
    } else if (e.key === 'ArrowLeft') {
      showPrev();
    }
  });
});
