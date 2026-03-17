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
  });

  // Close menu on link click
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('active'));
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
