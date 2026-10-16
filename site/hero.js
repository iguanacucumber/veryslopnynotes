/* hero.js — toute l'animation du hero, zéro dépendance.
 * Boucle rAF unique : mesh canvas + parallaxe + flottement des cartes.
 * Timeline : la progression du scroll dans .track pilote les 4 écrans.
 */

// Tokens miroir du CSS : le look se règle ici et dans :root.
export const CONFIG = {
  average: 14.82,
  countDuration: 1400,
  wordStagger: 40,
  cardStagger: 90,
  parallaxMax: 12,
  magneticMax: 8,
  keyWord: "session.",
  blobSpeed: 0.00012,
};

// --- Helpers purs (testés) ---
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const countUpValue = (from, to, t) => lerp(from, to, easeOutExpo(clamp(t, 0, 1)));
export const formatAverage = (v) => v.toFixed(2).replace(".", ",");
export const screenIndexForProgress = (p, n = 4) => clamp(Math.floor(p * n), 0, n - 1);

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function init() {
  const doc = document;
  const root = doc.documentElement;
  const reduced = reducedMotion();
  const finePointer =
    typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches;

  /* --- Grain généré localement, aucune image distante --- */
  const grain = doc.querySelector(".grain");
  if (grain) {
    const n = doc.createElement("canvas");
    n.width = n.height = 128;
    const nx = n.getContext("2d");
    const img = nx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    nx.putImageData(img, 0, 0);
    grain.style.backgroundImage = `url(${n.toDataURL()})`;
  }

  /* --- Révélation du titre, mot à mot depuis un masque --- */
  const h1 = doc.getElementById("headline");
  if (h1) {
    const words = h1.textContent.trim().split(/\s+/);
    h1.textContent = "";
    words.forEach((w, i) => {
      const mask = doc.createElement("span");
      mask.className = "mask";
      mask.setAttribute("aria-hidden", "true");
      const inner = doc.createElement("span");
      inner.className = "word" + (w === CONFIG.keyWord ? " key" : "");
      inner.style.transitionDelay = reduced ? "0s" : `${i * CONFIG.wordStagger}ms`;
      inner.textContent = w;
      mask.appendChild(inner);
      h1.appendChild(mask);
      h1.appendChild(doc.createTextNode(" "));
    });
    h1.setAttribute("aria-label", words.join(" "));
    requestAnimationFrame(() => requestAnimationFrame(() => h1.classList.add("revealed")));
  }

  /* --- Mesh gradient : 4 halos radiaux lents + parallaxe pointeur ±12px --- */
  const canvas = doc.getElementById("mesh");
  const ctx = canvas?.getContext("2d");
  const blobs = [
    { x: 0.15, y: 0.2, r: 0.45, var: "--blob-a", sp: 1.0, ph: 0.0, depth: 1.0 },
    { x: 0.85, y: 0.75, r: 0.5, var: "--blob-b", sp: 0.8, ph: 2.1, depth: 0.7 },
    { x: 0.7, y: 0.15, r: 0.35, var: "--blob-c", sp: 1.2, ph: 4.2, depth: 1.3 },
    { x: 0.25, y: 0.85, r: 0.4, var: "--blob-b", sp: 0.6, ph: 5.5, depth: 0.5 },
  ];
  const blobColor = (name) =>
    getComputedStyle(root).getPropertyValue(name).trim() || "rgba(52,211,153,.4)";
  const sizeMesh = () => {
    if (!canvas) return;
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  };
  sizeMesh();
  addEventListener("resize", sizeMesh, { passive: true });

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", (e) => {
    pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  let stageVisible = true;
  new IntersectionObserver(([e]) => (stageVisible = e.isIntersecting)).observe(
    doc.querySelector(".stage"),
  );

  function drawMesh(t) {
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (const b of blobs) {
      const dx = Math.sin(t * CONFIG.blobSpeed * b.sp + b.ph) * 0.06;
      const dy = Math.cos(t * CONFIG.blobSpeed * b.sp * 1.3 + b.ph) * 0.06;
      const cx = (b.x + dx) * w + pointer.x * CONFIG.parallaxMax * b.depth;
      const cy = (b.y + dy) * h + pointer.y * CONFIG.parallaxMax * b.depth;
      const r = b.r * Math.max(w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const c = blobColor(b.var);
      g.addColorStop(0, c);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  if (reduced) drawMesh(4000); // cadre final statique

  /* --- Timeline : scroll → écran actif --- */
  const track = doc.getElementById("track");
  const screens = [...doc.querySelectorAll(".pscreen")];
  const steps = [...doc.querySelectorAll(".steps li")];
  const avg = doc.getElementById("avgValue");
  const path = doc.getElementById("curvePath");
  const box = doc.getElementById("taskBox");
  const fills = [...doc.querySelectorAll(".grid i")];
  let pathLen = 0;
  if (path && path.getTotalLength) {
    pathLen = path.getTotalLength();
    path.style.strokeDasharray = String(pathLen);
    path.style.strokeDashoffset = reduced ? "0" : String(pathLen);
    path.style.transition = "stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)";
  }
  let countRaf = 0;
  let fillTimers = [];
  const narrow = () => innerWidth <= 860;

  function runCountUp() {
    if (!avg) return;
    cancelAnimationFrame(countRaf);
    if (reduced) {
      avg.textContent = formatAverage(CONFIG.average);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / CONFIG.countDuration;
      avg.textContent = formatAverage(countUpValue(0, CONFIG.average, t));
      if (t < 1) countRaf = requestAnimationFrame(tick);
    };
    countRaf = requestAnimationFrame(tick);
  }

  function activate(i) {
    screens.forEach((s, k) => {
      const on = k === i;
      if (on && !s.classList.contains("is-active")) {
        // Re-déclenche les animations d'entrée à chaque passage.
        s.classList.remove("is-active");
        void s.offsetWidth;
        s.classList.add("is-active");
      } else if (!on) {
        s.classList.remove("is-active");
      }
    });
    steps.forEach((s, k) => s.classList.toggle("on", k === i));
    fillTimers.forEach(clearTimeout);
    fillTimers = [];
    if (path) path.style.strokeDashoffset = i === 0 || reduced ? "0" : String(pathLen);
    if (i === 0) runCountUp();
    if (box && !reduced) {
      const was = box.classList.contains("done");
      box.classList.remove("done");
      box.setAttribute("aria-pressed", "false");
      if (i === 1 && !was) {
        // La case se coche seule quand son écran arrive.
        fillTimers.push(
          setTimeout(() => {
            box.classList.add("done");
            box.setAttribute("aria-pressed", "true");
          }, 600),
        );
      }
    }
    if (box && reduced && i === 1) {
      box.classList.add("done");
      box.setAttribute("aria-pressed", "true");
    }
    if (!reduced) {
      fills.forEach((f, k) => {
        f.classList.remove("fill");
        if (i === 2) fillTimers.push(setTimeout(() => f.classList.add("fill"), 120 + k * 60));
      });
    } else {
      fills.forEach((f) => f.classList.toggle("fill", i >= 2));
    }
  }

  function progress() {
    if (!track) return 0;
    const total = track.offsetHeight - innerHeight;
    return total > 0 ? clamp(scrollY / total, 0, 1) : 1;
  }
  let current = -1;
  const syncFromScroll = () => {
    // Mouvement réduit : même timeline, mais tout est instantané + fondus
    // courts (voir la media query) — aucun flottement ni parallaxe.
    const i = screenIndexForProgress(narrow() ? clamp(progress() * 1.15, 0, 1) : progress());
    if (i !== current) {
      current = i;
      activate(i);
    }
  };
  addEventListener("scroll", syncFromScroll, { passive: true });
  addEventListener("resize", syncFromScroll);
  syncFromScroll();

  /* --- Cartes : apparition en cascade, puis flottement + parallaxe --- */
  const cards = [...doc.querySelectorAll(".floaters li")];
  const shown = cards.map(() => 0);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries, obs) => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      cards.forEach((c, i) => {
        setTimeout(() => {
          c.classList.add("shown");
          shown[i] = 1;
        }, reduced ? 0 : i * CONFIG.cardStagger);
      });
    }).observe(doc.querySelector(".phone-zone"));
  } else {
    cards.forEach((c, i) => {
      c.classList.add("shown");
      shown[i] = 1;
    });
  }

  /* --- CTA magnétiques : suivent le curseur dans un rayon de 8px --- */
  const magnetics = [...doc.querySelectorAll(".magnetic")];
  if (finePointer && !reduced) {
    for (const btn of magnetics) {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate(${clamp(dx * 0.12, -CONFIG.magneticMax, CONFIG.magneticMax)}px,${clamp(dy * 0.18, -CONFIG.magneticMax, CONFIG.magneticMax)}px)`;
      });
      btn.addEventListener("pointerleave", () => (btn.style.transform = ""));
    }
  }

  /* --- Thème : système par défaut, bascule manuelle persistée --- */
  const toggle = doc.getElementById("themeToggle");
  const stored = (() => {
    try {
      return localStorage.getItem("vsn-theme");
    } catch {
      return null;
    }
  })();
  const applyTheme = (t) => {
    root.dataset.theme = t;
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(t === "light"));
      toggle.textContent = t === "light" ? "☀" : "☾";
    }
  };
  applyTheme(
    stored ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
  );
  toggle?.addEventListener("click", () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("vsn-theme", next);
    } catch {
      /* stockage indisponible : la bascule reste visuelle */
    }
    applyTheme(next);
  });

  /* --- Boucle unique : mesh + parallaxe des cartes, en pause hors-champ --- */
  const t0 = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (reduced || doc.hidden || !stageVisible) return;
    pointer.x = lerp(pointer.x, pointer.tx, 0.06);
    pointer.y = lerp(pointer.y, pointer.ty, 0.06);
    drawMesh(now - t0);
    const t = (now - t0) / 1000;
    const depthScale = narrow() ? 0.25 : 1;
    cards.forEach((c, i) => {
      const d = parseFloat(c.dataset.depth || "1") * depthScale;
      const entrance = (1 - shown[i]) * 26;
      const float = Math.sin(t * 1.05 + i * 1.3) * 7 * d;
      const px = pointer.x * CONFIG.parallaxMax * d;
      const py = pointer.y * CONFIG.parallaxMax * d + entrance + float;
      c.style.transform = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0)`;
    });
  }
  if (!reduced) requestAnimationFrame(frame);
  else cards.forEach((c) => c.classList.add("shown"));
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
