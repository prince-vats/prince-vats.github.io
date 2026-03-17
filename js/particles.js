// ─── Aerosol Particle System ───
(function () {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H;
  const particles = [];
  const PARTICLE_COUNT = 160;
  const LIGHT_SOURCES = [
    { x: 0.15, y: 0.2, color: [255, 69, 0] },
    { x: 0.85, y: 0.5, color: [255, 140, 0] },
    { x: 0.5, y: 0.85, color: [255, 107, 53] },
  ];

  // Mouse interactivity state
  let mouseX = -1000;
  let mouseY = -1000;
  const MOUSE_RADIUS = 150; // Interaction radius

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouseX = -1000;
    mouseY = -1000; // Reset off-screen
  });

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class Particle {
    constructor() { this.reset(true); }
    reset(initial) {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.r = 1 + Math.random() * 2.5;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = (Math.random() - 0.5) * 0.3 - 0.05;
      this.life = 0;
      this.maxLife = 600 + Math.random() * 800;
      this.baseAlpha = 0.15 + Math.random() * 0.35;
      this.phase = Math.random() * Math.PI * 2;
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

  function scatter(p, light) {
    const lx = light.x * W, ly = light.y * H;
    const dx = p.x - lx, dy = p.y - ly;
    const dist = Math.sqrt(dx * dx + dy * dy) + 1;
    return Math.min(1, 400 / dist);
  }

  function coagulate() {
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const gap = Math.sqrt(dx * dx + dy * dy);
        if (gap < a.r + b.r + 2) {
          const newR = Math.sqrt(a.r * a.r + b.r * b.r);
          if (newR < 6) {
            a.r = newR;
            a.vx = (a.vx + b.vx) * 0.5;
            a.vy = (a.vy + b.vy) * 0.5;
            b.reset(false);
          }
        }
      }
    }
  }

  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    frame++;
    if (frame % 4 === 0) coagulate();

    for (const p of particles) {
      p.life++;
      if (p.life > p.maxLife) p.reset(false);

      // Mouse Repulsion Logic
      if (mouseX > -1000 && mouseY > -1000) {
        let dx = p.x - mouseX;
        let dy = p.y - mouseY;
        let dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < MOUSE_RADIUS && dist > 0) {
          // Calculate repulsion force (closer = stronger)
          let force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
          p.vx += (dx / dist) * force * 0.15;
          p.vy += (dy / dist) * force * 0.15;
        }
      }

      // Add gentle friction/damping to prevent infinite acceleration from mouse pushes
      p.vx = p.vx * 0.98;
      p.vy = p.vy * 0.98;

      // Add natural Brownian motion back in
      p.vx += (Math.random() - 0.5) * 0.04;
      p.vy += (Math.random() - 0.5) * 0.04;
      
      p.x += p.vx;
      p.y += p.vy;

      // Wrap around screen boundaries
      if (p.x < -20) p.x = W + 20;
      if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20;
      if (p.y > H + 20) p.y = -20;

      const lifeFrac = p.life / p.maxLife;
      let alpha = p.baseAlpha;
      if (lifeFrac < 0.1) alpha *= lifeFrac / 0.1;
      else if (lifeFrac > 0.85) alpha *= (1 - lifeFrac) / 0.15;

      alpha *= 0.7 + 0.3 * Math.sin(p.phase + frame * 0.015);

      let rC = 255, gC = 255, bC = 255;
      let totalScatter = 0;
      for (const ls of LIGHT_SOURCES) {
        const s = scatter(p, ls);
        totalScatter += s;
        rC += ls.color[0] * s;
        gC += ls.color[1] * s;
        bC += ls.color[2] * s;
      }
      const norm = 1 + totalScatter;
      rC = Math.min(255, rC / norm);
      gC = Math.min(255, gC / norm);
      bC = Math.min(255, bC / norm);

      const glowR = p.r * (2.5 + totalScatter * 1.5);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grad.addColorStop(0, `rgba(${Math.round(rC)},${Math.round(gC)},${Math.round(bC)},${(alpha * 0.6).toFixed(3)})`);
      grad.addColorStop(0.4, `rgba(${Math.round(rC)},${Math.round(gC)},${Math.round(bC)},${(alpha * 0.15).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(${Math.round(rC)},${Math.round(gC)},${Math.round(bC)},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }
  draw();
})();
