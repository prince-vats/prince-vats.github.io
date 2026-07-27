// ─── Dark Mode Toggle ───
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Load saved theme preference
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  html.classList.toggle('light-mode', savedTheme === 'light');
  updateThemeIcon();
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isLightMode = html.classList.toggle('light-mode');
    localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
    updateThemeIcon();
  });
}

function updateThemeIcon() {
  if (themeToggle) {
    const span = themeToggle.querySelector('span');
    if (span) {
      span.textContent = html.classList.contains('light-mode') ? '☀️' : '🌙';
    }
  }
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
    navLinks.classList.toggle('active');
    hamburger.classList.toggle('active');
  });

  // Close menu on link click
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('active');
      hamburger.classList.remove('active');
    });
  });
}

// ─── Scroll-reveal observer ───
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ─── Form handler (placeholder) ───
function handleSubmit(e) {
  e.preventDefault();
  alert('Thank you for your message! I will get back to you soon.');
  e.target.reset();
}

// ─── Counter Animation for Stat Cards ───
function animateCounter(element, target, duration = 1500) {
  let current = 0;
  const increment = target / (duration / 16);
  
  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      element.textContent = target;
      clearInterval(timer);
    } else {
      element.textContent = Math.floor(current);
    }
  }, 16);
}

// Observe stat cards and animate on scroll into view
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !entry.target.classList.contains('animated')) {
      entry.target.classList.add('animated');
      // Animate stat numbers (if they exist and are numeric)
      const statNumber = entry.target.querySelector('.stat-number');
      if (statNumber && !isNaN(parseInt(statNumber.textContent))) {
        const target = parseInt(statNumber.textContent);
        animateCounter(statNumber, target, 1200);
      }
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('.stat-card').forEach(card => counterObserver.observe(card));

// ─── Image Lightbox Modal ───
document.addEventListener('DOMContentLoaded', () => {
  let lightbox = document.getElementById('lightboxModal');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightboxModal';
    lightbox.className = 'lightbox-modal';
    lightbox.innerHTML = `
      <button class="lightbox-nav lightbox-prev" id="lightboxPrev" aria-label="Previous image">&#10094;</button>
      <button class="lightbox-nav lightbox-next" id="lightboxNext" aria-label="Next image">&#10095;</button>
      <div class="lightbox-container">
        <button class="lightbox-close" id="lightboxClose" aria-label="Close enlarged view">&times;</button>
        <img class="lightbox-img" id="lightboxImg" src="" alt="Enlarged view" />
        <div class="lightbox-caption" id="lightboxCaption"></div>
      </div>
    `;
    document.body.appendChild(lightbox);
  }

  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
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
    if (lightboxCaption) {
      if (alt) {
        lightboxCaption.textContent = alt;
        lightboxCaption.style.display = 'block';
      } else {
        lightboxCaption.style.display = 'none';
      }
    }

    const showNav = mediaItems.length > 1;
    if (lightboxPrev) lightboxPrev.style.display = showNav ? 'flex' : 'none';
    if (lightboxNext) lightboxNext.style.display = showNav ? 'flex' : 'none';
  }

  function openLightbox(clickedMediaItem) {
    mediaItems = Array.from(document.querySelectorAll('.event-media')).filter(el => el.offsetParent !== null || el.offsetWidth > 0);
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

  // Intercept click on any .event-media container or image element
  document.body.addEventListener('click', (e) => {
    const mediaItem = e.target.closest('.event-media');
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
