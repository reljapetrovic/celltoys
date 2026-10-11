// Canvas 2D candle renderer. Draws from flame state; owns spark/smoke particles.

const WAX = '#f1e4c8', WAX_TOP = '#e2d0ad', ORANGE = '#ff7a1a', YELLOW = '#ffd36b', BLUE = '#4a7cff';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const sparks = [];
  const smokes = [];

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function teardrop(x, baseY, w, h, tipDx, color, alpha) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY);
    ctx.bezierCurveTo(x - w / 2, baseY - h * 0.45, x + tipDx - w * 0.15, baseY - h * 0.8, x + tipDx, baseY - h);
    ctx.bezierCurveTo(x + tipDx + w * 0.15, baseY - h * 0.8, x + w / 2, baseY - h * 0.45, x + w / 2, baseY);
    ctx.closePath();
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  }

  function roundedTop(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  }

  function particles(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt / p.ttl; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += p.ax * dt;
      if (p.life <= 0) list.splice(i, 1);
    }
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function draw(state, intensity, time, dt, { meter = false, safeTop = 0, reading = null } = {}) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    // Scale with the shorter side so tablets get a bigger candle, not a lost one.
    const unit = Math.min(W, H);
    const candleW = clamp(unit * 0.18, 44, 120);
    const candleTop = H * 0.62;
    const flameBase = candleTop - 8;
    const maxH = clamp(unit * 0.45, 90, 300);
    const flameH = maxH * state.size;
    const flicker = 0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.3);
    const flameW = candleW * 0.8 * flicker * (0.6 + 0.4 * state.size);
    const tipDx = state.lean * 0.6 * flameH + Math.sin(time * 17) * 2 * state.size;
    const glow = state.lit ? state.size : 0;

    if (glow > 0.02) {
      const gy = flameBase - flameH * 0.5;
      const g = ctx.createRadialGradient(cx, gy, 0, cx, gy, maxH * 2.2);
      g.addColorStop(0, `rgba(255,150,50,${0.35 * glow})`);
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // candle
    ctx.fillStyle = WAX; roundedTop(cx - candleW / 2, candleTop, candleW, H - candleTop, 6); ctx.fill();
    ctx.fillStyle = WAX_TOP; ctx.beginPath(); ctx.ellipse(cx, candleTop, candleW / 2, candleW * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, candleTop); ctx.lineTo(cx + state.lean * 3, candleTop - 12); ctx.stroke();

    // flame
    if (state.lit && state.size > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      teardrop(cx, flameBase, flameW * 1.1, flameH, tipDx, ORANGE, 0.85);
      teardrop(cx, flameBase, flameW * 0.7, flameH * 0.72, tipDx * 0.8, YELLOW, 0.95);
      teardrop(cx, flameBase + 2, flameW * 0.5, flameH * 0.25, tipDx * 0.3, BLUE, 0.7);
      ctx.globalCompositeOperation = 'source-over';
    }

    // sparks (rates are per second, independent of frame rate)
    if (state.lit && Math.random() < 5 * state.size * dt) {
      sparks.push({ x: cx + tipDx * 0.5, y: flameBase - flameH * 0.6, vx: (Math.random() - 0.5) * 20 + state.lean * 30, vy: -40 - Math.random() * 40, ax: 0, life: 1, ttl: 0.8 + Math.random() * 0.6 });
    }
    particles(sparks, dt);
    for (const p of sparks) { ctx.globalAlpha = p.life; ctx.fillStyle = YELLOW; ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    // smoke
    if (state.smoke > 0 && Math.random() < 30 * dt) {
      smokes.push({ x: cx, y: candleTop - 14, vx: (Math.random() - 0.5) * 10, vy: -25 - Math.random() * 20, ax: (Math.random() - 0.5) * 20, life: 1, ttl: 2 + Math.random(), r: 4 + Math.random() * 6 });
    }
    particles(smokes, dt);
    for (const p of smokes) {
      ctx.globalAlpha = 0.18 * p.life * Math.max(state.smoke, 0.3);
      ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (2 - p.life), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (meter) {
      const mw = Math.min(W - 32, 240);
      const my = safeTop + 16; // below the notch / status bar
      ctx.fillStyle = 'rgba(255,138,64,0.25)'; ctx.fillRect(16, my, mw, 6);
      ctx.fillStyle = intensity > 0.7 ? '#ff4d1a' : '#ff8a40'; ctx.fillRect(16, my, mw * intensity, 6);
      // Raw numbers for tuning: what the mic hears, how low-pitched it is, the result.
      if (reading) {
        ctx.fillStyle = '#ff8a40'; ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'top';
        ctx.fillText(`loud ${reading.loudness.toFixed(2)} · low ${reading.lowFraction.toFixed(2)} · blow ${intensity.toFixed(2)} · floor ${reading.floor.toFixed(3)}`, 16, my + 12);
      }
    }
  }

  return { resize, draw };
}
