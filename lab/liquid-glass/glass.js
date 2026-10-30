/**
 * Liquid Glass Effect
 * Cross-browser implementation using SVG feDisplacementMap.
 *
 * Technique:
 * 1. Generate a displacement map the size of the container
 * 2. The map is neutral (128,128) everywhere EXCEPT under the lens
 * 3. Under the lens, the map encodes a spherical refraction profile
 * 4. Apply the SVG filter to the content — only lens area distorts
 * 5. Overlay specular highlights on the lens element itself
 *
 * Quarter-computation optimization: the lens portion is symmetric,
 * so we compute only the top-left quadrant and mirror to the other three.
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// ─── Displacement Map Generator ──────────────────────────────────────────────

function generateFullMap(containerW, containerH, lensX, lensY, lensW, lensH, opts = {}) {
  const {
    scale = 15,
    depth = 12,
    curvature = 40,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = containerW;
  canvas.height = containerH;
  const ctx = canvas.getContext('2d');

  // Fill entire map with neutral gray (no displacement)
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, containerW, containerH);

  // Now compute the lens region
  const lensCanvas = document.createElement('canvas');
  lensCanvas.width = lensW;
  lensCanvas.height = lensH;
  const lensCtx = lensCanvas.getContext('2d');
  const imageData = lensCtx.createImageData(lensW, lensH);
  const data = imageData.data;

  const cx = lensW / 2;
  const cy = lensH / 2;
  const rx = cx;
  const ry = cy;
  const curveExp = curvature / 20;

  // Compute top-left quadrant only, mirror to the rest
  const halfW = Math.ceil(cx);
  const halfH = Math.ceil(cy);

  for (let py = 0; py <= halfH; py++) {
    for (let px = 0; px <= halfW; px++) {
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      const dist = Math.sqrt(nx * nx + ny * ny);

      let r = 128, g = 128;

      if (dist <= 1.0) {
        // Spherical refraction: displacement strongest at mid-radius
        const profile = Math.pow(1 - dist * dist, curveExp);
        const angle = Math.atan2(ny, nx);
        const strength = profile * depth * (1 - Math.pow(dist, 2.5));

        const dx = Math.cos(angle) * strength;
        const dy = Math.sin(angle) * strength;

        r = clamp(Math.round(128 + dx * scale / 10), 0, 255);
        g = clamp(Math.round(128 + dy * scale / 10), 0, 255);
      }

      // Write to all four quadrants
      const mx = Math.round(2 * cx - px);
      const my = Math.round(2 * cy - py);
      const flipR = 256 - r;
      const flipG = 256 - g;

      setPixel(data, lensW, px, py, r, g, 128, 255);
      if (mx < lensW) setPixel(data, lensW, mx, py, clamp(flipR,0,255), g, 128, 255);
      if (my < lensH) setPixel(data, lensW, px, my, r, clamp(flipG,0,255), 128, 255);
      if (mx < lensW && my < lensH) setPixel(data, lensW, mx, my, clamp(flipR,0,255), clamp(flipG,0,255), 128, 255);
    }
  }

  lensCtx.putImageData(imageData, 0, 0);

  // Draw the lens displacement onto the full container map at the lens position
  const drawX = lensX - lensW / 2;
  const drawY = lensY - lensH / 2;
  ctx.drawImage(lensCanvas, drawX, drawY);

  return canvas.toDataURL('image/png');
}

function setPixel(data, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i < 0 || i + 3 >= data.length) return;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

// ─── SVG Filter Builder ──────────────────────────────────────────────────────

let filterCounter = 0;

function createGlassFilter(mapDataUrl, scale) {
  // Fresh ID each call — forces Safari to invalidate its filter cache
  const id = `glass-${filterCounter++}`;
  const defs = document.getElementById('filterDefs');

  // Build filter element
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImage.setAttribute('href', mapDataUrl);
  feImage.setAttribute('result', 'dispMap');
  feImage.setAttribute('preserveAspectRatio', 'none');

  const feDisplace = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
  feDisplace.setAttribute('in', 'SourceGraphic');
  feDisplace.setAttribute('in2', 'dispMap');
  feDisplace.setAttribute('scale', scale.toString());
  feDisplace.setAttribute('xChannelSelector', 'R');
  feDisplace.setAttribute('yChannelSelector', 'G');

  filter.appendChild(feImage);
  filter.appendChild(feDisplace);

  // Clear old filters, add new one
  while (defs.firstChild) defs.removeChild(defs.firstChild);
  defs.appendChild(filter);

  return id;
}

// ─── Glass State & Application ───────────────────────────────────────────────

let currentParams = {
  scale: 15,
  depth: 12,
  curvature: 40,
  chroma: 15,
  specular: 25,
};

// Track lens positions for each demo
const lensState = {
  lens1: { x: 0, y: 0 },
  lens2: { x: 0, y: 0 },
};

function applyGlass(containerId, lensId, stateKey) {
  const container = document.getElementById(containerId);
  const lens = document.getElementById(lensId);
  if (!container || !lens) return;

  const cw = container.offsetWidth;
  const ch = container.offsetHeight;
  const lw = lens.offsetWidth;
  const lh = lens.offsetHeight;
  const lx = lensState[stateKey].x;
  const ly = lensState[stateKey].y;

  const mapUrl = generateFullMap(cw, ch, lx, ly, lw, lh, {
    scale: currentParams.scale,
    depth: currentParams.depth,
    curvature: currentParams.curvature,
  });

  const filterId = createGlassFilter(mapUrl, currentParams.scale);

  const contentLayer = container.querySelector('.content-layer');
  if (contentLayer) {
    contentLayer.style.filter = `url(#${filterId})`;
  }
}

function updateAllGlass() {
  applyGlass('lensDemo', 'glassLens1', 'lens1');
  applyGlass('textDemo', 'glassLens2', 'lens2');
}

// ─── Draggable Lens ──────────────────────────────────────────────────────────

function makeDraggable(lens, container, stateKey) {
  let isDragging = false;
  let offsetX, offsetY;

  // Initialize position at center
  const initX = container.offsetWidth / 2;
  const initY = container.offsetHeight / 2;
  lensState[stateKey] = { x: initX, y: initY };

  function updatePos() {
    lens.style.left = lensState[stateKey].x + 'px';
    lens.style.top = lensState[stateKey].y + 'px';
  }
  updatePos();

  function onStart(e) {
    isDragging = true;
    const point = e.touches ? e.touches[0] : e;
    const rect = container.getBoundingClientRect();
    offsetX = point.clientX - rect.left - lensState[stateKey].x;
    offsetY = point.clientY - rect.top - lensState[stateKey].y;
    lens.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onMove(e) {
    if (!isDragging) return;
    const point = e.touches ? e.touches[0] : e;
    const rect = container.getBoundingClientRect();
    const hw = lens.offsetWidth / 2;
    const hh = lens.offsetHeight / 2;

    lensState[stateKey].x = clamp(
      point.clientX - rect.left - offsetX, hw, container.offsetWidth - hw
    );
    lensState[stateKey].y = clamp(
      point.clientY - rect.top - offsetY, hh, container.offsetHeight - hh
    );
    updatePos();
    // Re-generate map at new position
    applyGlass(container.id, lens.id, stateKey);
  }

  function onEnd() {
    isDragging = false;
    lens.style.cursor = 'grab';
  }

  lens.addEventListener('mousedown', onStart);
  lens.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

// ─── Switch Component ────────────────────────────────────────────────────────

function initSwitch() {
  const track = document.getElementById('switchTrack');
  const label = document.getElementById('switchLabel');
  let isOn = false;

  track.addEventListener('click', () => {
    isOn = !isOn;
    track.classList.toggle('active', isOn);
    label.textContent = isOn ? 'ON' : 'OFF';
  });
}

// ─── Slider Component ────────────────────────────────────────────────────────

function initSlider() {
  const trackEl = document.querySelector('.slider-track');
  const fill = document.getElementById('sliderFill');
  const thumb = document.getElementById('sliderThumb');
  const valueEl = document.getElementById('sliderValue');
  let isDragging = false;
  let progress = 0.5;

  function updateSlider() {
    const pct = Math.round(progress * 100);
    fill.style.width = pct + '%';
    thumb.style.left = pct + '%';
    valueEl.textContent = pct;
  }
  updateSlider();

  function onStart(e) {
    isDragging = true;
    onMove(e);
    e.preventDefault();
  }

  function onMove(e) {
    if (!isDragging) return;
    const point = e.touches ? e.touches[0] : e;
    const rect = trackEl.getBoundingClientRect();
    progress = clamp((point.clientX - rect.left) / rect.width, 0, 1);
    updateSlider();
  }

  function onEnd() { isDragging = false; }

  trackEl.addEventListener('mousedown', onStart);
  trackEl.addEventListener('touchstart', onStart, { passive: false });
  thumb.addEventListener('mousedown', onStart);
  thumb.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);
}

// ─── Controls Panel ──────────────────────────────────────────────────────────

function initControls() {
  const ids = ['ctrlScale', 'ctrlDepth', 'ctrlCurve', 'ctrlChroma', 'ctrlSpec'];
  const keys = ['scale', 'depth', 'curvature', 'chroma', 'specular'];

  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      currentParams[keys[i]] = parseInt(el.value);
      updateAllGlass();
    });
  });
}

// ─── Initialize ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const lens1 = document.getElementById('glassLens1');
  const container1 = document.getElementById('lensDemo');
  if (lens1 && container1) makeDraggable(lens1, container1, 'lens1');

  const lens2 = document.getElementById('glassLens2');
  const container2 = document.getElementById('textDemo');
  if (lens2 && container2) makeDraggable(lens2, container2, 'lens2');

  initSwitch();
  initSlider();
  initControls();

  // Initial render
  updateAllGlass();
});
