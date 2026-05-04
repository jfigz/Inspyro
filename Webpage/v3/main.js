const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealTargets = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  revealTargets.forEach((target) => observer.observe(target));
} else {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
}

const featureScroller = document.querySelector("[data-feature-scroll]");
if (featureScroller) {
  const featureCards = Array.from(featureScroller.querySelectorAll(".feature-card"));
  const progressItems = Array.from(featureScroller.querySelectorAll(".feature-progress [data-feature-target]"));
  const featuresGrid = featureScroller.querySelector(".features-grid");
  let activeFeatureIndex = -1;
  let featureTicking = false;

  function setActiveFeature(index) {
    const nextIndex = Math.max(0, Math.min(index, featureCards.length - 1));
    if (nextIndex === activeFeatureIndex) return;

    featureCards.forEach((card, cardIndex) => {
      card.classList.toggle("is-active", cardIndex === nextIndex);
    });

    progressItems.forEach((item, itemIndex) => {
      const isActive = itemIndex === nextIndex;
      item.classList.toggle("is-active", isActive);
      if (isActive) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    });

    featuresGrid?.classList.add("has-active");
    activeFeatureIndex = nextIndex;
  }

  function scrollToFeature(index) {
    const sectionTop = window.scrollY + featureScroller.getBoundingClientRect().top;
    const travel = Math.max(1, featureScroller.offsetHeight - window.innerHeight);
    const segmentCount = Math.max(1, featureCards.length - 1);
    const targetProgress = Math.min(index / segmentCount / 1.08, 1);
    const targetTop = sectionTop + travel * targetProgress;

    window.scrollTo({
      top: Math.round(targetTop),
      behavior: "auto",
    });
  }

  function updateActiveFeature() {
    featureTicking = false;
    const rect = featureScroller.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const rawProgress = -rect.top / travel;
    const progress = Math.max(0, Math.min(rawProgress * 1.08, 1));
    const segmentCount = Math.max(1, featureCards.length - 1);
    const nextIndex = Math.round(progress * segmentCount);
    setActiveFeature(nextIndex);
  }

  function requestFeatureUpdate() {
    if (featureTicking) return;
    featureTicking = true;
    requestAnimationFrame(updateActiveFeature);
  }

  setActiveFeature(0);
  updateActiveFeature();
  progressItems.forEach((item, itemIndex) => {
    item.addEventListener("click", () => {
      const targetIndex = Number.parseInt(item.dataset.featureTarget || `${itemIndex}`, 10);
      const nextIndex = Number.isNaN(targetIndex) ? itemIndex : targetIndex;
      setActiveFeature(nextIndex);
      scrollToFeature(nextIndex);
    });
  });
  window.addEventListener("scroll", requestFeatureUpdate, { passive: true });
  window.addEventListener("resize", requestFeatureUpdate, { passive: true });
}

if (!prefersReducedMotion) {
  const canvas = document.getElementById("system-canvas");
  const ctx = canvas.getContext("2d");
  const points = [];
  let width = 0;
  let height = 0;
  let frame = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedPoints();
  }

  function seedPoints() {
    points.length = 0;
    const count = Math.max(26, Math.min(64, Math.round((width * height) / 32000)));
    for (let index = 0; index < count; index += 1) {
      points.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        tone: Math.random() > 0.68 ? "63,185,80" : "88,166,255",
        r: Math.random() * 1.2 + 0.7,
      });
    }
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = "rgba(240, 246, 252, 0.025)";
    ctx.lineWidth = 1;
    const step = 76;
    const offset = (frame * 0.08) % step;

    for (let x = -step + offset; x < width + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = -step + offset; y < height + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function tick() {
    frame += 1;
    ctx.clearRect(0, 0, width, height);
    drawGrid();

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      for (let j = i + 1; j < points.length; j += 1) {
        const q = points[j];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 138) {
          const alpha = (1 - dist / 138) * 0.11;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(88, 166, 255, ${alpha})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.tone}, 0.42)`;
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();
  tick();
}
