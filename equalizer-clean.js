// NAME: Equalizer Clean
// AUTHOR: you
// VERSION: 1.1.0
// DESCRIPTION: Equalizer with presets, bass controls and saved configurations.

(function spicetifyEqualizer() {
  "use strict";

  const LOG = "[equalizer-clean]";
  const PRESETS_KEY = "spicetify-equalizer-clean:user-presets";
  const STATE_KEY = "spicetify-equalizer-clean:state";
  const MIN_DB = -12;
  const MAX_DB = 12;
  const PLOT_H = 168;
  const PAD = 10;
  const BASS_MIN_HZ = 60;
  const BASS_MAX_HZ = 250;
  const BASS_DEFAULT = Object.freeze({ on: false, amount: 6, freq: 100, style: "punch" });
  const EXAMPLE_ADV = Object.freeze([4.1, 6.0, -1.0, 0.5, -2.3, -1.0, -2.5, -1.5, -1.0, 4.0]);
  const EXAMPLE_BASS = Object.freeze({ on: true, amount: 12.0, freq: 220, style: "punch" });
  const BASS_STYLES = {
    punch: { name: "Punch", shelf: 1.75, w150: 0.48, w: [0, 0, -0.45, -0.03, 0.1, 0] },
    deep: { name: "Deep", shelf: 2, w150: 0.15, w: [0, 0, -0.3, 0, 0.06, 0] },
    classic: { name: "Classic" },
  };
  const WHEEL_DB = 0.1;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const ADV_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const ADV_BASE = 31.25;
  const MODEL_FS = 44100;
  const MODEL_Q = 1;

  const FALLBACK_BANDS = [
    { key: "audio.equalizer.low_shelf_gain_v2", type: "lowshelf", frequency: 60 },
    { key: "audio.equalizer.low_peak_gain_v2", type: "peaking", frequency: 150 },
    { key: "audio.equalizer.low_mid_peak_gain_v2", type: "peaking", frequency: 400 },
    { key: "audio.equalizer.high_mid_peak_gain_v2", type: "peaking", frequency: 1000 },
    { key: "audio.equalizer.high_peak_gain_v2", type: "peaking", frequency: 2400 },
    { key: "audio.equalizer.high_shelf_gain_v2", type: "highshelf", frequency: 15000 },
  ];

  const BUILTIN_PRESETS = [
    { name: "Flat", gains: [0, 0, 0, 0, 0, 0] },
    { name: "Bass Boost", gains: [7, 2.5, -2, 0, 0.5, 0] },
    { name: "Bass Cut", gains: [-6, -4, -1, 0, 0, 0] },
    { name: "Treble Boost", gains: [0, 0, 0, 1, 3, 6] },
    { name: "Treble Cut", gains: [0, 0, 0, -1, -3, -6] },
    { name: "V-Shape", gains: [5, 3, -2, -1, 2, 5] },
    { name: "Warm", gains: [3, 2, 1, 0, -1, -3] },
    { name: "Bright", gains: [-1, 0, 0, 1, 3, 4] },
    { name: "Vocal Clarity", gains: [-2, -1, 2, 4, 3, 0] },
    { name: "Podcast / Speech", gains: [-4, -1, 2, 4, 3, -2] },
    { name: "Rock", gains: [4, 2, -1, 0, 2, 4] },
    { name: "Pop", gains: [-1, 1, 3, 3, 1, -1] },
    { name: "Electronic", gains: [6, 2, -1, -1, 2, 4] },
    { name: "Hip-Hop", gains: [6, 2, -1.5, -0.5, 1, 2] },
    { name: "Jazz", gains: [3, 1, 0, 1, 2, 3] },
    { name: "Classical", gains: [3, 2, 0, 0, 1, 3] },
    { name: "Acoustic", gains: [3, 2, 1, 1, 2, 2] },
    { name: "Late Night", gains: [-4, -2, 0, 0, -1, -3] },
    { name: "Small Speakers", gains: [-2, 4, 2, 0, 0, -2] },
  ];

  const ICON = `<svg role="img" height="16" width="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="2.4" y="1" width="1.2" height="14" rx=".6"/><rect x="7.4" y="1" width="1.2" height="14" rx=".6"/><rect x="12.4" y="1" width="1.2" height="14" rx=".6"/>
    <rect x=".5" y="8.5" width="5" height="3" rx="1.5"/><rect x="5.5" y="3.5" width="5" height="3" rx="1.5"/><rect x="10.5" y="10" width="5" height="3" rx="1.5"/></svg>`;

  let tries = 0;
  (function waitForSpicetify() {
    const S = window.Spicetify;
    if (S?.Platform?.EqualizerAPI && S?.Playbar?.Button && S?.LocalStorage && document.body) {
      init().catch((err) => console.error(LOG, "failed to start", err));
      return;
    }
    if (++tries > 300) {
      console.warn(LOG, "EqualizerAPI not found");
      S?.showNotification?.("Equalizer unavailable", true, 5000);
      return;
    }
    setTimeout(waitForSpicetify, 150);
  })();

  const clampDb = (v) => Math.min(MAX_DB, Math.max(MIN_DB, Number(v) || 0));
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const yFromDb = (g, h) => PAD + ((MAX_DB - g) / (MAX_DB - MIN_DB)) * (h - 2 * PAD);
  const dbFromY = (y, h) => clampDb(MAX_DB - ((y - PAD) / (h - 2 * PAD)) * (MAX_DB - MIN_DB));
  const fmtDb = (g) => (Math.abs(g) < 0.05 ? "0.0" : (g > 0 ? "+" : "−") + Math.abs(g).toFixed(1));
  const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${f}`);
  const sameGains = (a, b) => !!a && !!b && a.length === b.length && a.every((g, i) => Math.abs(g - b[i]) < 0.05);
  const validArr = (g, n) => Array.isArray(g) && g.length === n && g.every(Number.isFinite);
  const average = (arrays) => arrays[0].map((_, i) => r2(arrays.reduce((sum, a) => sum + a[i], 0) / arrays.length));
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function makeWheelStepper() {
    let acc = 0;
    return (e) => {
      let units = e.wheelDeltaY;
      if (!Number.isFinite(units) || units === 0) {
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
        units = -px * 1.2;
      }
      if (Math.sign(units) !== Math.sign(acc)) acc = 0;
      acc += units;
      const steps = Math.trunc(acc / 120);
      acc -= steps * 120;
      return steps;
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    let timer = 0;
    const run = () => {
      last = performance.now();
      timer = 0;
      fn();
    };
    const throttled = () => {
      if (timer) return;
      const wait = last + ms - performance.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    };
    throttled.flush = () => {
      if (timer) {
        clearTimeout(timer);
        run();
      }
    };
    return throttled;
  }

  function smoothPath(p) {
    let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`;
    }
    return d;
  }

  function curveAt(vals, u) {
    const n = vals.length;
    if (u <= 0) return vals[0];
    if (u >= n - 1) return vals[n - 1];
    const i = Math.floor(u);
    const t = u - i;
    const p0 = vals[Math.max(0, i - 1)];
    const p1 = vals[i];
    const p2 = vals[i + 1];
    const p3 = vals[Math.min(n - 1, i + 2)];
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }

  const bassWeight = (bandHz, cornerHz) => {
    const octaves = Math.log2(bandHz / cornerHz);
    return octaves <= 0 ? 1 : Math.exp(-octaves * octaves);
  };
  const bassReach = (hz) => 0.4 + 0.6 * Math.min(2, Math.max(0, Math.log(hz / 60) / Math.log(100 / 60)));
  function bassLayer(bands, bass) {
    if (!bass?.on) return bands.map(() => 0);
    const style = BASS_STYLES[bass.style];
    if (!style?.w) return bands.map((b) => bass.amount * bassWeight(b.frequency, bass.freq));
    const gains = style.w.map((w) => bass.amount * w);
    gains[0] = MAX_DB * (1 - (1 - bass.amount / MAX_DB) ** style.shelf);
    gains[1] = bass.amount * style.w150 * bassReach(bass.freq);
    return gains;
  }
  const sliderToHz = (v) => Math.round(BASS_MIN_HZ * (BASS_MAX_HZ / BASS_MIN_HZ) ** (v / 100));
  const hzToSlider = (hz) => (100 * Math.log(hz / BASS_MIN_HZ)) / Math.log(BASS_MAX_HZ / BASS_MIN_HZ);
  const sameBass = (a, b) => (!a.on && !b.on) || (a.on && b.on && a.style === b.style && Math.abs(a.amount - b.amount) < 0.05 && Math.abs(a.freq - b.freq) < 1);

  function normBass(b) {
    const amount = Math.min(MAX_DB, Math.max(0, Number(b?.amount)));
    const freq = Math.min(BASS_MAX_HZ, Math.max(BASS_MIN_HZ, Math.round(Number(b?.freq))));
    return {
      on: !!b?.on,
      amount: Number.isFinite(amount) ? r1(amount) : BASS_DEFAULT.amount,
      freq: Number.isFinite(freq) ? freq : BASS_DEFAULT.freq,
      style: Object.hasOwn(BASS_STYLES, b?.style) ? b.style : BASS_DEFAULT.style,
    };
  }

  function biquadDb(type, f0, gain, f) {
    if (Math.abs(gain) < 1e-6) return 0;
    const A = 10 ** (gain / 40);
    const w0 = (2 * Math.PI * f0) / MODEL_FS;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    let b0, b1, b2, a0, a1, a2;
    if (type === "lowshelf" || type === "highshelf") {
      const k = 2 * Math.sqrt(A) * (sw / Math.SQRT2);
      if (type === "lowshelf") {
        b0 = A * (A + 1 - (A - 1) * cw + k);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - k);
        a0 = A + 1 + (A - 1) * cw + k;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - k;
      } else {
        b0 = A * (A + 1 + (A - 1) * cw + k);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - k);
        a0 = A + 1 - (A - 1) * cw + k;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - k;
      }
    } else {
      const alpha = sw / (2 * MODEL_Q);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    }
    const w = (2 * Math.PI * f) / MODEL_FS;
    const c1 = Math.cos(w);
    const c2 = Math.cos(2 * w);
    const num = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * c1 + 2 * b0 * b2 * c2;
    const den = a0 * a0 + a1 * a1 + a2 * a2 + 2 * (a0 * a1 + a1 * a2) * c1 + 2 * a0 * a2 * c2;
    return 10 * Math.log10(num / den);
  }

  function invert(m) {
    const n = m.length;
    const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      [a[c], a[p]] = [a[p], a[c]];
      const pv = a[c][c];
      for (let j = 0; j < 2 * n; j++) a[c][j] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r][c];
        for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
      }
    }
    return a.map((row) => row.slice(n));
  }

  function makeFitter(bands) {
    const us = [];
    for (let u = -0.3; u <= 9.3001; u += 0.1) us.push(u);
    const freqs = us.map((u) => ADV_BASE * 2 ** u);
    const response = (native, f) => bands.reduce((sum, b, j) => sum + biquadDb(b.type, b.frequency, native[j], f), 0);
    const basis = freqs.map((f) => bands.map((b) => biquadDb(b.type, b.frequency, 6, f) / 6));
    const n = bands.length;
    const lambda = 0.3;
    const btb = bands.map((_, i) => bands.map((__, j) => basis.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? lambda : 0)));
    const inv = invert(btb);
    const solver = inv.map((row) => freqs.map((_, k) => row.reduce((s, v, j) => s + v * basis[k][j], 0)));
    const apply = (vec) => solver.map((row) => row.reduce((s, m, k) => s + m * vec[k], 0));

    const target = (adv) => us.map((u) => curveAt(adv, u));
    function fit(adv) {
      const t = target(adv);
      let g = apply(t).map(clampDb);
      for (let it = 0; it < 6; it++) {
        const residual = freqs.map((f, k) => t[k] - response(g, f));
        const step = apply(residual);
        g = g.map((x, j) => clampDb(x + step[j]));
      }
      return g.slice(0, n).map(r2);
    }
    function maxError(adv, native) {
      const t = target(adv);
      let worst = 0;
      let hz = 0;
      us.forEach((u, k) => {
        const gap = Math.abs(t[k] - response(native, freqs[k]));
        if (u >= 0 && u <= 9 && gap > worst) {
          worst = gap;
          hz = freqs[k];
        }
      });
      return { db: worst, hz };
    }
    const toAdvanced = (gains6) => ADV_FREQS.map((_, j) => r1(clampDb(response(gains6, ADV_BASE * 2 ** j))));
    return { fit, maxError, response, toAdvanced };
  }

  function readJSON(key, fallback) {
    try {
      return JSON.parse(Spicetify.LocalStorage.get(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadUserPresets() {
    const list = readJSON(PRESETS_KEY, []);
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && typeof p.name === "string" && p.name.trim() && validArr(p.gains, 6))
      .map((p) => ({
        name: p.name,
        gains: p.gains.map(clampDb),
        ...(p.bass ? { bass: normBass(p.bass) } : {}),
        ...(validArr(p.adv, ADV_FREQS.length) ? { adv: p.adv.map(clampDb) } : {}),
      }));
  }

  const saveUserPresets = (list) => Spicetify.LocalStorage.set(PRESETS_KEY, JSON.stringify(list));

  function loadSavedState() {
    const s = readJSON(STATE_KEY, null);
    const hasState = !!s && typeof s === "object";
    return {
      hasState,
      mode: s?.mode === "advanced" ? "advanced" : hasState ? "simple" : "advanced",
      bass: s?.bass ? normBass(s.bass) : hasState ? { ...BASS_DEFAULT } : { ...EXAMPLE_BASS },
      gains: validArr(s?.gains, 6) ? s.gains.map(clampDb) : null,
      adv: validArr(s?.adv, ADV_FREQS.length) ? s.adv.map(clampDb) : hasState ? null : EXAMPLE_ADV.slice(),
      advFrom: validArr(s?.advFrom, 6) ? s.advFrom : null,
      effective: validArr(s?.effective, 6) ? s.effective.map(clampDb) : null,
    };
  }

  function readBands(api) {
    try {
      const filters = api.getActivePreset?.()?.filters;
      if (Array.isArray(filters) && filters.length === 6 && filters.every((f) => typeof f.key === "string" && Number.isFinite(f.frequency))) {
        return filters.map(({ key, type, frequency }) => ({ key, type, frequency }));
      }
    } catch {
    }
    return FALLBACK_BANDS.map((b) => ({ ...b }));
  }

  async function init() {
    const api = await Promise.resolve(Spicetify.Platform.EqualizerAPI);
    if (typeof api?.setActivePreset !== "function" || typeof api?.setEnabledState !== "function") {
      console.warn(LOG, "EqualizerAPI is missing the methods this extension needs", api);
      return;
    }

    const bands = readBands(api);
    const fitter = makeFitter(bands);
    const zeros6 = bands.map(() => 0);
    const zeros10 = ADV_FREQS.map(() => 0);
    const saved = loadSavedState();
    const state = {
      enabled: false,
      mode: saved.mode,
      gains: saved.gains || zeros6.slice(),
      adv: saved.adv || zeros10.slice(),
      advFrom: null,
      bass: saved.bass,
      userPresets: loadUserPresets(),
      view: "main",
      saving: false,
      selected: new Set(),
      pending: null,
    };
    let shown = { s: state.gains.slice(), a: state.adv.slice() };
    let dragging = -1;
    let lastLocalEdit = 0;
    let deferredSync = 0;
    let tween = 0;
    let ui = null;
    const builtinAdvCache = new Map();
    const builtinAdv = (p) => {
      if (!builtinAdvCache.has(p.name)) builtinAdvCache.set(p.name, fitter.toAdvanced(p.gains));
      return builtinAdvCache.get(p.name);
    };

    const gainsFrom = (filters) => {
      if (!Array.isArray(filters)) return null;
      const out = bands.map((b) => filters.find((f) => f?.key === b.key)?.gain);
      return out.every((g) => Number.isFinite(Number(g))) ? out.map(clampDb) : null;
    };

    const withBass = (gains6, bass) => {
      const layer = bassLayer(bands, bass);
      return gains6.map((g, i) => r2(clampDb(g + layer[i])));
    };

    function nativeGains() {
      return withBass(state.mode === "advanced" ? fitter.fit(state.adv) : state.gains, state.bass);
    }
    const saveState = () =>
      Spicetify.LocalStorage.set(
        STATE_KEY,
        JSON.stringify({ mode: state.mode, gains: state.gains, adv: state.adv, advFrom: state.advFrom, bass: state.bass, effective: nativeGains() })
      );

    let staleGains = null;
    try {
      const current = gainsFrom(await api.getFilters?.());
      if (current) {
        if (saved.effective && sameGains(current, saved.effective)) {
          state.mode = saved.mode;
          if (saved.gains) state.gains = saved.gains;
          if (saved.adv) state.adv = saved.adv;
          state.advFrom = saved.advFrom;
          if (!sameGains(current, nativeGains())) staleGains = current;
        } else if (!saved.hasState) {
          // Keep the shareable first-run example and apply it once to Spotify.
          if (!sameGains(current, nativeGains())) staleGains = current;
        } else {
          state.gains = current;
          state.bass = { ...state.bass, on: false };
        }
      }
    } catch (err) {
      console.debug(LOG, "getFilters failed; waiting for the first preset event", err);
    }
    shown = { s: state.gains.slice(), a: state.adv.slice() };

    const button = new Spicetify.Playbar.Button("Equalizer Clean", ICON, () => togglePanel(), false, false, true);
    button.element.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setEnabled(!state.enabled, true);
    });

    const buildPreset = (gains, name) => ({
      key: "custom",
      displayName: name || "Custom",
      filters: bands.map((b, i) => ({ key: b.key, type: b.type, frequency: b.frequency, gain: r2(clampDb(gains[i])) })),
    });

    function currentName() {
      const active = activePreset();
      if (active.kind === "user") return active.name;
      return state.bass.on && state.bass.amount > 0 ? `${active.name} + Bass` : active.name;
    }

    function pushToSpotify() {
      const native = nativeGains();
      saveState();
      try {
        if (native.every((g) => g === 0)) {
          try {
            api.setActivePreset("flat");
            return;
          } catch {
          }
        }
        api.setActivePreset(buildPreset(native, currentName()));
      } catch (err) {
        console.error(LOG, "setActivePreset failed", err);
        Spicetify.showNotification("Change rejected", true);
      }
    }
    const pushThrottled = throttle(pushToSpotify, 80);

    function setEnabled(on, notify = false) {
      state.enabled = on;
      button.active = on;
      button.label = on ? "Equalizer (on)" : "Equalizer (off)";
      try {
        api.setEnabledState(on);
      } catch (err) {
        console.error(LOG, "setEnabledState failed", err);
      }
      if (notify) Spicetify.showNotification(on ? "Equalizer on" : "Equalizer off");
      render();
    }

    function onSpotifyPreset(preset) {
      const incoming = gainsFrom(preset?.filters);
      if (!incoming) return;
      if (staleGains && sameGains(incoming, staleGains)) return;
      const wait = lastLocalEdit + 600 - performance.now();
      clearTimeout(deferredSync);
      if (wait > 0 || dragging !== -1) {
        deferredSync = setTimeout(() => onSpotifyPreset(preset), Math.max(wait, 150));
        return;
      }
      if (sameGains(incoming, nativeGains())) return;
      state.mode = "simple";
      state.gains = incoming;
      if (state.bass.on) state.bass = { ...state.bass, on: false };
      saveState();
      animateTo();
      render();
      positionPanel();
    }

    if (staleGains) {
      lastLocalEdit = performance.now();
      pushToSpotify();
      setTimeout(() => (staleGains = null), 5000);
    }

    try {
      api.subscribeToEnabledState?.((on) => {
        state.enabled = !!on;
        button.active = state.enabled;
        button.label = state.enabled ? "Equalizer (on)" : "Equalizer (off)";
        render();
      });
      api.subscribeToPresetChange?.(onSpotifyPreset);
    } catch (err) {
      console.error(LOG, "could not subscribe to equalizer changes", err);
    }

    function setBand(key, i, value, snapToZero = false) {
      let g = r1(clampDb(value));
      if (snapToZero && Math.abs(g) < 0.25) g = 0;
      if (g === state[key][i]) return;
      state[key] = state[key].map((x, j) => (j === i ? g : x));
      cancelAnimationFrame(tween);
      shown = { s: state.gains.slice(), a: state.adv.slice() };
      lastLocalEdit = performance.now();
      if (!state.enabled) setEnabled(true);
      pushThrottled();
      render();
    }

    function setBass(patch) {
      state.bass = normBass({ ...state.bass, ...patch });
      lastLocalEdit = performance.now();
      if (state.bass.on && !state.enabled) setEnabled(true);
      pushThrottled();
      render();
    }

    function setMode(mode) {
      if (mode === state.mode) return;
      if (mode === "advanced") {
        if (!(state.advFrom && sameGains(state.gains, state.advFrom))) state.adv = fitter.toAdvanced(state.gains);
      } else {
        state.gains = fitter.fit(state.adv);
        state.advFrom = state.gains.slice();
      }
      state.mode = mode;
      cancelAnimationFrame(tween);
      shown = { s: state.gains.slice(), a: state.adv.slice() };
      lastLocalEdit = performance.now();
      pushToSpotify();
      render();
      positionPanel();
    }

    function applyConfig(cfg, { enable = true } = {}) {
      if (cfg.adv) {
        state.mode = "advanced";
        state.adv = cfg.adv.map(clampDb);
      } else {
        state.mode = "simple";
        state.gains = cfg.gains.map(clampDb);
      }
      if (cfg.bass) state.bass = normBass(cfg.bass);
      lastLocalEdit = performance.now();
      if (enable && !state.enabled) setEnabled(true);
      pushToSpotify();
      animateTo();
      render();
      positionPanel();
    }

    function resetAll() {
      state.bass = { ...state.bass, on: false };
      applyConfig(state.mode === "advanced" ? { adv: zeros10 } : { gains: zeros6 }, { enable: false });
    }

    function animateTo() {
      cancelAnimationFrame(tween);
      const from = { s: shown.s.slice(), a: shown.a.slice() };
      const to = { s: state.gains.slice(), a: state.adv.slice() };
      if (reducedMotion() || !ui || ui.panel.hidden) {
        shown = to;
        draw();
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 180);
        const e = 1 - (1 - t) ** 3;
        shown = { s: from.s.map((g, i) => g + (to.s[i] - g) * e), a: from.a.map((g, i) => g + (to.a[i] - g) * e) };
        draw();
        if (t < 1) tween = requestAnimationFrame(step);
      };
      tween = requestAnimationFrame(step);
    }

    function configMatches(p) {
      const bassOk = !p.bass || sameBass(p.bass, state.bass);
      if (state.mode === "advanced") return !!p.adv && sameGains(p.adv, state.adv) && bassOk;
      return !p.adv && sameGains(p.gains, state.gains) && bassOk;
    }

    function activePreset() {
      const u = state.userPresets.findIndex(configMatches);
      if (u !== -1) return { id: `u:${u}`, name: state.userPresets[u].name, kind: "user" };
      const b = BUILTIN_PRESETS.findIndex((p) => (state.mode === "advanced" ? sameGains(builtinAdv(p), state.adv) : sameGains(p.gains, state.gains)));
      if (b !== -1) return { id: `b:${b}`, name: BUILTIN_PRESETS[b].name, kind: "builtin" };
      return { id: "custom", name: "Example", kind: "custom" };
    }

    const snapshot = (name) =>
      state.mode === "advanced"
        ? { name, gains: fitter.fit(state.adv), adv: state.adv.slice(), bass: { ...state.bass } }
        : { name, gains: state.gains.slice(), bass: { ...state.bass } };

    const selectedConfigs = () => state.userPresets.filter((p) => state.selected.has(p.name));

    function blend(list) {
      const anyAdv = list.some((p) => p.adv);
      const curve = anyAdv ? { adv: average(list.map((p) => p.adv || fitter.toAdvanced(p.gains))) } : { gains: average(list.map((p) => p.gains)) };
      const withBass = list.filter((p) => p.bass);
      if (!withBass.length) return curve;
      const on = withBass.filter((p) => p.bass.on);
      if (!on.length) return { ...curve, bass: { ...state.bass, on: false } };
      const amount = withBass.reduce((sum, p) => sum + (p.bass.on ? p.bass.amount : 0), 0) / withBass.length;
      const freq = Math.exp(on.reduce((sum, p) => sum + Math.log(p.bass.freq), 0) / on.length);
      return { ...curve, bass: { on: amount >= 0.05, amount, freq, style: on[0].style } };
    }

    function doApply() {
      const sel = selectedConfigs();
      if (!sel.length) return;
      applyConfig(sel.length === 1 ? sel[0] : blend(sel));
      Spicetify.showNotification(sel.length === 1 ? `Applied “${sel[0].name}”` : `Applied a blend of ${sel.length} configs`);
      showView("main");
    }

    function doOverwrite() {
      let count = 0;
      state.userPresets = state.userPresets.map((p) => {
        if (!state.selected.has(p.name)) return p;
        count++;
        return snapshot(p.name);
      });
      saveUserPresets(state.userPresets);
      state.pending = null;
      Spicetify.showNotification(`Overwrote ${count} config${count === 1 ? "" : "s"} with the current sound`);
      render();
    }

    function doDelete() {
      const before = state.userPresets.length;
      state.userPresets = state.userPresets.filter((p) => !state.selected.has(p.name));
      const count = before - state.userPresets.length;
      state.selected.clear();
      saveUserPresets(state.userPresets);
      state.pending = null;
      Spicetify.showNotification(`Deleted ${count} config${count === 1 ? "" : "s"}`);
      render();
    }

    function showView(view) {
      state.view = view;
      state.pending = null;
      if (view === "main") state.selected.clear();
      render();
      positionPanel();
    }

    function buildGraph({ freqs, key, cls }) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      const gradId = `speq-grad-${key}`;
      svg.innerHTML = `
        <defs><linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${PAD}" y2="${PLOT_H - PAD}">
          <stop offset="0" class="speq-stop-edge"/><stop offset=".5" class="speq-stop-mid"/><stop offset="1" class="speq-stop-edge"/>
        </linearGradient></defs>
        <path class="speq-grid"/><path class="speq-zero"/><path class="speq-fill" fill="url(#${gradId})"/><path class="speq-eqline"/><path class="speq-curve"/>`;

      const g = {
        svg, bands: [], thumbs: [], values: [], boosts: [],
        grid: svg.querySelector(".speq-grid"),
        zero: svg.querySelector(".speq-zero"),
        fill: svg.querySelector(".speq-fill"),
        eqline: svg.querySelector(".speq-eqline"),
        curve: svg.querySelector(".speq-curve"),
      };
      const bandsWrap = el("div", { class: "speq-bands", style: `grid-template-columns:repeat(${freqs.length},1fr)` });
      freqs.forEach((hz, i) => {
        const thumb = el("div", { class: "speq-thumb" });
        const band = el(
          "div",
          {
            class: "speq-band",
            role: "slider",
            tabindex: "0",
            "aria-orientation": "vertical",
            "aria-label": `${fmtHz(hz)}Hz`,
            "aria-valuemin": String(MIN_DB),
            "aria-valuemax": String(MAX_DB),
            title: "Drag or scroll · double-click to reset",
          },
          thumb
        );
        const fromPointer = (e) => dbFromY(e.clientY - band.getBoundingClientRect().top, band.clientHeight || PLOT_H);
        band.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          band.focus();
          band.setPointerCapture(e.pointerId);
          dragging = i;
          band.classList.add("is-dragging");
          setBand(key, i, fromPointer(e), true);
        });
        band.addEventListener("pointermove", (e) => {
          if (dragging === i) setBand(key, i, fromPointer(e), true);
        });
        const endDrag = () => {
          if (dragging !== i) return;
          dragging = -1;
          band.classList.remove("is-dragging");
          pushThrottled.flush();
        };
        band.addEventListener("pointerup", endDrag);
        band.addEventListener("pointercancel", endDrag);
        band.addEventListener("lostpointercapture", endDrag);
        band.addEventListener("dblclick", () => setBand(key, i, 0));
        const wheelSteps = makeWheelStepper();
        band.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            const steps = wheelSteps(e);
            if (steps) setBand(key, i, state[key][i] + steps * WHEEL_DB);
          },
          { passive: false }
        );
        band.addEventListener("keydown", (e) => {
          const step = e.shiftKey ? 0.1 : 0.5;
          const deltas = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 3, PageDown: -3 };
          let next = null;
          if (e.key in deltas) next = state[key][i] + deltas[e.key];
          else if (e.key === "Home") next = MAX_DB;
          else if (e.key === "End") next = MIN_DB;
          else if (e.key === "0" || e.key === "Delete" || e.key === "Backspace") next = 0;
          if (next === null) return;
          e.preventDefault();
          e.stopPropagation();
          setBand(key, i, next);
        });
        g.bands.push(band);
        g.thumbs.push(thumb);
        bandsWrap.append(band);
      });

      const scale = el("div", { class: "speq-scale" });
      for (const v of [12, 6, 0, -6, -12]) scale.append(el("span", { style: `top:${yFromDb(v, PLOT_H)}px`, text: v > 0 ? `+${v}` : `${v}` }));
      g.plot = el("div", { class: "speq-plot" }, svg, bandsWrap);

      const labels = el("div", { class: "speq-labels", style: `grid-template-columns:repeat(${freqs.length},1fr)` });
      freqs.forEach((hz) => {
        const v = el("div", { class: "speq-val" });
        const boost = el("div", { class: "speq-boost" });
        g.values.push(v);
        g.boosts.push(boost);
        labels.append(el("div", {}, v, el("div", { class: "speq-freq", text: `${fmtHz(hz)}Hz` }), boost));
      });
      g.boostLegend = el("div", { class: "speq-boost", text: "bass" });
      const legend = el("div", { class: "speq-legend" }, el("div", { class: "speq-val", text: " " }), el("div", { class: "speq-freq", text: " " }), g.boostLegend);
      g.body = el("div", { class: `speq-body ${cls}` }, scale, g.plot, legend, labels);
      return g;
    }

    function buildUI() {
      injectStyle();

      const sw = el("button", { class: "speq-switch", role: "switch", "aria-checked": "false", "aria-label": "Equalizer on/off", title: "Turn equalizer on/off" }, el("span"));
      sw.addEventListener("click", () => setEnabled(!state.enabled));
      const head = el(
        "div",
        { class: "speq-head" },
        el("div", {}, el("div", { class: "speq-title", text: "Equalizer" })),
        sw
      );

      const modeSimple = el("button", { class: "speq-seg-btn", role: "radio", text: "Simple", title: "Simple mode" });
      const modeAdv = el("button", { class: "speq-seg-btn", role: "radio", text: "Advanced", title: "Advanced mode" });
      modeSimple.addEventListener("click", () => setMode("simple"));
      modeAdv.addEventListener("click", () => setMode("advanced"));
      const seg = el("div", { class: "speq-seg", role: "radiogroup", "aria-label": "Equalizer mode" }, modeSimple, modeAdv);

      const g6 = buildGraph({ freqs: bands.map((b) => b.frequency), key: "gains", cls: "speq-graph6" });
      const g10 = buildGraph({ freqs: ADV_FREQS, key: "adv", cls: "speq-graph10" });
      const advHint = el("div", { class: "speq-hint speq-adv-hint" });

      const rangeRow = (label, attrs, onInput, onWheelStep) => {
        const input = el("input", { class: "speq-range", type: "range", ...attrs });
        const out = el("output", { class: "speq-out" });
        input.addEventListener("input", () => onInput(Number(input.value)));
        input.addEventListener("change", () => pushThrottled.flush());
        input.addEventListener("keydown", (e) => e.stopPropagation());
        const row = el("label", { class: "speq-row" }, el("span", { class: "speq-row-label", text: label }), input, out);
        const wheelSteps = makeWheelStepper();
        row.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            const steps = wheelSteps(e);
            if (steps) onWheelStep(steps);
          },
          { passive: false }
        );
        return { row, input, out };
      };
      const bassSw = el("button", { class: "speq-switch", role: "switch", "aria-checked": "false", "aria-label": "Bass boost on/off", title: "Turn bass boost on/off" }, el("span"));
      bassSw.addEventListener("click", () => setBass({ on: !state.bass.on }));
      const bassSum = el("div", { class: "speq-sub" });
      const amount = rangeRow(
        "Amount",
        { min: "0", max: "12", step: "0.1", "aria-label": "Bass boost amount" },
        (v) => setBass({ amount: v, on: true }),
        (steps) => setBass({ amount: r1(state.bass.amount + steps * WHEEL_DB), on: true })
      );
      const freq = rangeRow(
        "Up to",
        { min: "0", max: "100", step: "1", "aria-label": "Bass boost frequency" },
        (v) => setBass({ freq: sliderToHz(v), on: true }),
        (steps) => setBass({ freq: state.bass.freq + steps, on: true })
      );
      const styleBtns = Object.entries(BASS_STYLES).map(([id, s]) => {
        const btn = el("button", { class: "speq-seg-btn", role: "radio", text: s.name });
        btn.dataset.style = id;
        btn.addEventListener("click", () => setBass({ style: id, on: true }));
        return btn;
      });
      const styleSeg = el("div", { class: "speq-seg speq-seg3", role: "radiogroup", "aria-label": "Bass style" }, ...styleBtns);
      const bassBox = el(
        "section",
        { class: "speq-bass", "aria-label": "Bass boost" },
        el("div", { class: "speq-bass-head" }, el("div", {}, el("div", { class: "speq-bass-title", text: "Bass boost" }), bassSum), bassSw),
        styleSeg,
        amount.row,
        freq.row
      );

      const select = el("select", { class: "speq-select", "aria-label": "Preset" });
      select.addEventListener("change", () => {
        const [kind, idx] = select.value.split(":");
        if (kind === "u" && state.userPresets[+idx]) applyConfig(state.userPresets[+idx]);
        else if (kind === "b" && BUILTIN_PRESETS[+idx]) {
          const p = BUILTIN_PRESETS[+idx];
          applyConfig(state.mode === "advanced" ? { adv: builtinAdv(p) } : { gains: p.gains });
        }
      });
      const saveBtn = el("button", { class: "speq-btn", text: "Save", title: "Save config" });
      const manageBtn = el("button", { class: "speq-btn", text: "Manage", title: "Manage configs" });
      const resetBtn = el("button", { class: "speq-btn", text: "Reset", title: "Reset" });
      saveBtn.addEventListener("click", () => showSaveForm(true));
      manageBtn.addEventListener("click", () => showView("manage"));
      resetBtn.addEventListener("click", resetAll);
      const foot = el("div", { class: "speq-foot" }, select, saveBtn, manageBtn, resetBtn);

      const nameInput = el("input", { class: "speq-input", type: "text", maxlength: "40", placeholder: "Name this config", "aria-label": "Config name" });
      nameInput.addEventListener("keydown", (e) => e.stopPropagation());
      const confirmSave = el("button", { class: "speq-btn speq-primary", text: "Save" });
      const cancelSave = el("button", { class: "speq-btn", text: "Cancel", type: "button" });
      const saveForm = el("form", { class: "speq-foot" }, nameInput, confirmSave, cancelSave);
      saveForm.hidden = true;
      saveForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return nameInput.focus();
        const existing = state.userPresets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
        const entry = snapshot(name);
        if (existing === -1) state.userPresets.push(entry);
        else state.userPresets[existing] = entry;
        saveUserPresets(state.userPresets);
        Spicetify.showNotification(existing === -1 ? `Saved “${name}”` : `Updated “${name}”`);
        showSaveForm(false);
        pushToSpotify();
      });
      cancelSave.addEventListener("click", () => showSaveForm(false));

      const mainView = el("div", { class: "speq-view" }, seg, g6.body, g10.body, advHint, bassBox, foot, saveForm);

      const backBtn = el("button", { class: "speq-btn speq-btn-sm", text: "← Back" });
      backBtn.addEventListener("click", () => showView("main"));
      const mTitle = el("div", { class: "speq-mtitle" });
      const allBox = el("input", { type: "checkbox", class: "speq-check", "aria-label": "Select all configs" });
      allBox.addEventListener("change", () => {
        state.selected = allBox.checked ? new Set(state.userPresets.map((p) => p.name)) : new Set();
        state.pending = null;
        render();
      });
      const mHead = el("div", { class: "speq-mhead" }, backBtn, mTitle, el("label", { class: "speq-all" }, allBox, el("span", { text: "All" })));
      const list = el("div", { class: "speq-list", role: "list", "aria-label": "Saved configs" });
      const empty = el("div", { class: "speq-empty", text: "No saved configs." });
      const hint = el("div", { class: "speq-hint", text: "Select configs to apply, blend, overwrite or delete." });

      const applyBtn = el("button", { class: "speq-btn speq-primary" });
      const overBtn = el("button", { class: "speq-btn" });
      const delBtn = el("button", { class: "speq-btn speq-danger" });
      applyBtn.addEventListener("click", doApply);
      overBtn.addEventListener("click", () => {
        state.pending = "overwrite";
        render();
      });
      delBtn.addEventListener("click", () => {
        state.pending = "delete";
        render();
      });
      const actions = el("div", { class: "speq-foot" }, applyBtn, overBtn, delBtn);

      const confirmMsg = el("div", { class: "speq-confirm-msg" });
      const confirmBtn = el("button", { class: "speq-btn speq-danger-solid", text: "Confirm" });
      const cancelBtn = el("button", { class: "speq-btn", text: "Cancel" });
      confirmBtn.addEventListener("click", () => (state.pending === "delete" ? doDelete() : doOverwrite()));
      cancelBtn.addEventListener("click", () => {
        state.pending = null;
        render();
      });
      const confirmBar = el("div", { class: "speq-foot speq-confirm" }, confirmMsg, confirmBtn, cancelBtn);

      const manageView = el("div", { class: "speq-view" }, mHead, list, empty, hint, actions, confirmBar);
      manageView.hidden = true;

      const panel = el("div", { class: "speq-panel", role: "dialog", "aria-label": "Equalizer" }, head, mainView, manageView);
      panel.hidden = true;
      document.body.append(panel);

      ui = {
        panel, sw, modeSimple, modeAdv, g6, g10, advHint, select, foot, saveForm, nameInput,
        bassBox, bassSw, bassSum, styleBtns, amount, freq,
        mainView, manageView, mTitle, allBox, list, empty, applyBtn, overBtn, delBtn, actions, confirmBar, confirmMsg, confirmBtn,
        optionsKey: "",
        rowsKey: "",
      };
    }

    function miniCurve(cfg) {
      const w = 56;
      const h = 22;
      const vals = cfg.adv
        ? cfg.adv.map((g, i) => clampDb(g + fitter.response(bassLayer(bands, cfg.bass), ADV_BASE * 2 ** i)))
        : withBass(cfg.gains, cfg.bass);
      const pts = vals.map((g, i) => [((i + 0.5) * w) / vals.length, h / 2 - (g / MAX_DB) * (h / 2 - 2)]);
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "speq-mini");
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = `<line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/><path d="${smoothPath([[0, pts[0][1]], ...pts, [w, pts[pts.length - 1][1]]])}"/>`;
      return svg;
    }

    function configRow(cfg) {
      const box = el("input", { type: "checkbox", class: "speq-check", "aria-label": `Select ${cfg.name}` });
      box.addEventListener("change", () => {
        if (box.checked) state.selected.add(cfg.name);
        else state.selected.delete(cfg.name);
        state.pending = null;
        render();
      });
      const meta = !cfg.bass ? "EQ only" : cfg.bass.on ? `${BASS_STYLES[cfg.bass.style].name} +${cfg.bass.amount.toFixed(1)}` : "Bass off";
      const name = el("span", { class: "speq-item-name" }, el("span", { class: "speq-item-text", text: cfg.name }));
      const row = el("label", { class: "speq-item", role: "listitem", title: "Double-click to apply" }, box, name, miniCurve(cfg), el("span", { class: "speq-item-meta", text: meta }));
      row.dataset.name = cfg.name;
      row.addEventListener("dblclick", (e) => {
        e.preventDefault();
        state.selected = new Set([cfg.name]);
        doApply();
      });
      return row;
    }

    function showSaveForm(on) {
      state.saving = on;
      ui.foot.hidden = on;
      ui.saveForm.hidden = !on;
      if (on) {
        const active = activePreset();
        ui.nameInput.value = active.kind === "user" ? active.name : "";
        ui.nameInput.focus();
        ui.nameInput.select();
      }
      render();
    }

    function drawGrid(g, W, H, n) {
      g.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const col = W / n;
      let grid = "";
      for (const v of [12, 6, -6, -12]) grid += `M0 ${r1(yFromDb(v, H))}H${W}`;
      for (let i = 0; i < n; i++) grid += `M${r1(col * (i + 0.5))} ${PAD}V${H - PAD}`;
      g.grid.setAttribute("d", grid);
      g.zero.setAttribute("d", `M0 ${r1(yFromDb(0, H))}H${W}`);
    }

    function drawLabels(g, vals, boosts) {
      const hasBoost = boosts.some((b) => Math.abs(b) >= 0.05);
      vals.forEach((v, i) => {
        g.values[i].textContent = fmtDb(v);
        g.values[i].classList.toggle("is-zero", Math.abs(v) < 0.05);
        g.boosts[i].textContent = Math.abs(boosts[i]) >= 0.05 ? fmtDb(boosts[i]) : "";
      });
      g.boostLegend.style.visibility = hasBoost ? "visible" : "hidden";
    }

    function drawSimple() {
      const g = ui.g6;
      const W = g.plot.clientWidth || 320;
      const H = PLOT_H;
      const n = bands.length;
      drawGrid(g, W, H, n);
      const col = W / n;
      const boost = bassLayer(bands, state.bass);
      const hasBoost = boost.some((b) => Math.abs(b) >= 0.05);
      const pathFor = (vals) => {
        const pts = vals.map((v, i) => [col * (i + 0.5), yFromDb(v, H)]);
        return { pts, d: smoothPath([[0, pts[0][1]], ...pts, [W, pts[pts.length - 1][1]]]) };
      };
      const eq = pathFor(shown.s);
      const eff = pathFor(shown.s.map((v, i) => clampDb(v + boost[i])));
      const y0 = r1(yFromDb(0, H));
      g.curve.setAttribute("d", eff.d);
      g.fill.setAttribute("d", `${eff.d} L${W} ${y0} L0 ${y0} Z`);
      g.eqline.setAttribute("d", hasBoost ? eq.d : "");
      eq.pts.forEach(([, y], i) => (g.thumbs[i].style.top = `${y}px`));
      drawLabels(g, shown.s, boost);
    }

    function drawAdvanced() {
      const g = ui.g10;
      const W = g.plot.clientWidth || 400;
      const H = PLOT_H;
      const n = ADV_FREQS.length;
      drawGrid(g, W, H, n);
      const col = W / n;
      const fitted = fitter.fit(shown.a);
      const native = withBass(fitted, state.bass);
      const layer = bassLayer(bands, state.bass);
      const yClamp = (db) => yFromDb(Math.max(MIN_DB - 0.5, Math.min(MAX_DB + 0.5, db)), H);
      let d = "";
      for (let x = 0; x <= W + 0.01; x += 3) {
        const f = ADV_BASE * 2 ** (x / col - 0.5);
        d += `${x ? "L" : "M"}${r1(x)} ${r1(yClamp(fitter.response(native, f)))}`;
      }
      const y0 = r1(yFromDb(0, H));
      g.curve.setAttribute("d", d);
      g.fill.setAttribute("d", `${d} L${W} ${y0} L0 ${y0} Z`);
      const pts = shown.a.map((v, i) => [col * (i + 0.5), yFromDb(v, H)]);
      g.eqline.setAttribute("d", smoothPath([[0, pts[0][1]], ...pts, [W, pts[pts.length - 1][1]]]));
      pts.forEach(([, y], i) => (g.thumbs[i].style.top = `${y}px`));
      drawLabels(g, shown.a, ADV_FREQS.map((_, i) => fitter.response(layer, ADV_BASE * 2 ** i)));
       ui.advHint.textContent = "";
    }

    function draw() {
      if (!ui || ui.panel.hidden || state.view !== "main") return;
      if (state.mode === "advanced") drawAdvanced();
      else drawSimple();
    }

    function setRange(r, value, text, fraction) {
      if (document.activeElement !== r.input) r.input.value = String(value);
      r.out.textContent = text;
      r.input.style.setProperty("--fill", `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`);
    }

    function renderMain() {
      const adv = state.mode === "advanced";
      ui.g6.body.hidden = adv;
      ui.g10.body.hidden = !adv;
       ui.advHint.hidden = true;
      ui.modeSimple.setAttribute("aria-checked", String(!adv));
      ui.modeAdv.setAttribute("aria-checked", String(adv));
      const g = adv ? ui.g10 : ui.g6;
      const vals = adv ? state.adv : state.gains;
      g.bands.forEach((band, i) => {
        band.setAttribute("aria-valuenow", vals[i].toFixed(1));
        band.setAttribute("aria-valuetext", `${fmtDb(vals[i])} dB`);
      });

      const key = JSON.stringify(state.userPresets.map((p) => [p.name, !!p.adv]));
      if (key !== ui.optionsKey) {
        ui.optionsKey = key;
        ui.select.replaceChildren();
         ui.select.append(el("option", { value: "custom", text: "Example", hidden: "" }));
        const builtin = el("optgroup", { label: "Presets" });
        BUILTIN_PRESETS.forEach((p, i) => builtin.append(el("option", { value: `b:${i}`, text: p.name })));
        ui.select.append(builtin);
        if (state.userPresets.length) {
          const mine = el("optgroup", { label: "My configs" });
          state.userPresets.forEach((p, i) => mine.append(el("option", { value: `u:${i}`, text: p.name })));
          ui.select.append(mine);
        }
      }
      ui.select.value = activePreset().id;

      const b = state.bass;
      ui.bassBox.classList.toggle("is-off", !b.on);
      ui.bassSw.setAttribute("aria-checked", String(b.on));
      for (const btn of ui.styleBtns) btn.setAttribute("aria-checked", String(btn.dataset.style === b.style));
       ui.bassSum.textContent = b.on ? BASS_STYLES[b.style].name : "Off";
      setRange(ui.amount, b.amount, `${b.amount.toFixed(1)} dB`, b.amount / MAX_DB);
      setRange(ui.freq, hzToSlider(b.freq), `${b.freq} Hz`, hzToSlider(b.freq) / 100);
      draw();
    }

    function renderManage() {
      const list = state.userPresets;
      for (const name of state.selected) if (!list.some((p) => p.name === name)) state.selected.delete(name);

      const key = JSON.stringify(list);
      if (key !== ui.rowsKey) {
        ui.rowsKey = key;
        ui.list.replaceChildren(...list.map(configRow));
      }
      const active = activePreset();
      for (const row of ui.list.children) {
        const on = state.selected.has(row.dataset.name);
        row.querySelector("input").checked = on;
        row.classList.toggle("is-selected", on);
        row.classList.toggle("is-active", active.kind === "user" && active.name === row.dataset.name);
      }

      const n = state.selected.size;
      ui.mTitle.textContent = n ? `${n} of ${list.length} selected` : `Saved configs (${list.length})`;
      ui.empty.hidden = list.length > 0;
      ui.list.hidden = list.length === 0;
      ui.allBox.checked = list.length > 0 && n === list.length;
      ui.allBox.indeterminate = n > 0 && n < list.length;
      ui.allBox.disabled = list.length === 0;
      ui.applyBtn.textContent = n > 1 ? `Blend ${n}` : "Apply";
      ui.applyBtn.title = "Apply";
      ui.overBtn.textContent = n > 1 ? `Overwrite ${n}` : "Overwrite";
      ui.overBtn.title = "Overwrite selected";
      ui.delBtn.textContent = n > 1 ? `Delete ${n}` : "Delete";
      for (const btn of [ui.applyBtn, ui.overBtn, ui.delBtn]) btn.disabled = n === 0;

      ui.actions.hidden = !!state.pending;
      ui.confirmBar.hidden = !state.pending;
      if (state.pending) {
        const names = selectedConfigs().map((p) => p.name);
        const what = names.length === 1 ? `“${names[0]}”` : `${names.length} configs`;
        ui.confirmMsg.textContent = state.pending === "delete" ? `Delete ${what}?` : `Overwrite ${what}?`;
        ui.confirmMsg.title = state.pending === "delete" ? "Cannot be undone" : "Overwrite selected";
        ui.confirmBtn.textContent = state.pending === "delete" ? "Delete" : "Overwrite";
      }
    }

    function render() {
      if (!ui || ui.panel.hidden) return;
      ui.panel.classList.toggle("is-off", !state.enabled);
      ui.panel.classList.toggle("is-advanced", state.mode === "advanced");
      ui.sw.setAttribute("aria-checked", String(state.enabled));
      ui.mainView.hidden = state.view !== "main";
      ui.manageView.hidden = state.view !== "manage";
      if (state.view === "main") renderMain();
      else renderManage();
    }

    function positionPanel() {
      if (!ui || ui.panel.hidden) return;
      const { panel } = ui;
      const W = panel.offsetWidth || 380;
      const r = button.element.getBoundingClientRect();
      let bottom = 100;
      if (r.width && r.height) {
        const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8);
        bottom = Math.max(8, window.innerHeight - r.top + 10);
        panel.style.left = `${left}px`;
        panel.style.right = "auto";
      } else {
        panel.style.left = "auto";
        panel.style.right = "16px";
      }
      panel.style.bottom = `${bottom}px`;
      panel.style.maxHeight = `${Math.max(200, window.innerHeight - bottom - 8)}px`;
    }

    function onOutsidePointer(e) {
      if (!ui.panel.contains(e.target) && !button.element.contains(e.target)) closePanel();
    }

    function onKey(e) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (state.saving) showSaveForm(false);
      else if (state.pending) {
        state.pending = null;
        render();
      } else if (state.view === "manage") showView("main");
      else closePanel();
    }

    function openPanel() {
      if (!ui) buildUI();
      ui.panel.hidden = false;
      state.view = "main";
      cancelAnimationFrame(tween);
      shown = { s: state.gains.slice(), a: state.adv.slice() };
      render();
      positionPanel();
      document.addEventListener("pointerdown", onOutsidePointer, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", positionPanel);
    }

    function closePanel() {
      if (!ui || ui.panel.hidden) return;
      if (state.saving) showSaveForm(false);
      state.view = "main";
      state.pending = null;
      state.selected.clear();
      ui.panel.hidden = true;
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", positionPanel);
    }

    function togglePanel() {
      if (ui && !ui.panel.hidden) closePanel();
      else openPanel();
    }

  }

  function injectStyle() {
    if (document.getElementById("speq-clean-style")) return;
    const style = document.createElement("style");
    style.id = "speq-clean-style";
    style.textContent = `
.speq-panel{--speq-accent:var(--spice-button-active,#1ed760);--speq-accent-rgb:var(--spice-rgb-button-active,30,215,96);--speq-text:var(--spice-text,#fff);--speq-sub:var(--spice-subtext,#b3b3b3);--speq-line:rgba(var(--spice-rgb-text,255,255,255),.08);--speq-soft:rgba(var(--spice-rgb-text,255,255,255),.06);
  position:fixed;z-index:1000;width:380px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:16px 16px 14px;border-radius:12px;overflow-y:auto;overscroll-behavior:contain;
  background:var(--spice-main-elevated,#282828);color:var(--speq-text);box-shadow:0 16px 48px rgba(0,0,0,.5),0 0 0 1px rgba(var(--spice-rgb-text,255,255,255),.06);
  font-size:13px;line-height:1.3;user-select:none;-webkit-user-select:none}
.speq-panel.is-advanced{width:480px}
.speq-panel[hidden],.speq-panel [hidden]{display:none!important}
.speq-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.speq-title{font-size:16px;font-weight:700}
.speq-sub{font-size:11.5px;color:var(--speq-sub);margin-top:2px}
.speq-switch{flex:none;position:relative;width:38px;height:22px;border:0;border-radius:11px;padding:0;cursor:pointer;background:rgba(var(--spice-rgb-text,255,255,255),.3);transition:background .15s}
.speq-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.speq-switch[aria-checked="true"]{background:var(--speq-accent)}
.speq-switch[aria-checked="true"] span{transform:translateX(16px)}
.speq-switch:focus-visible{outline:2px solid var(--speq-text);outline-offset:2px}
.speq-seg{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:2px;margin-bottom:12px;border-radius:8px;background:var(--speq-soft)}
.speq-seg-btn{height:28px;border:0;border-radius:6px;background:transparent;color:var(--speq-sub);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.speq-seg-btn:hover{color:var(--speq-text)}
.speq-seg-btn[aria-checked="true"]{background:rgba(var(--spice-rgb-text,255,255,255),.14);color:var(--speq-text)}
.speq-seg-btn:focus-visible{outline:2px solid var(--speq-text);outline-offset:-2px}
.speq-seg3{grid-template-columns:repeat(3,1fr);margin-bottom:6px}
.speq-bass.is-off .speq-seg3{opacity:.55}
.speq-body{display:grid;grid-template-columns:26px 1fr;column-gap:6px}
.speq-scale{position:relative;height:${PLOT_H}px}
.speq-scale span{position:absolute;right:0;transform:translateY(-50%);font-size:10px;color:var(--speq-sub);font-variant-numeric:tabular-nums}
.speq-plot{position:relative;height:${PLOT_H}px}
.speq-plot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.speq-grid{stroke:var(--speq-line);stroke-width:1;fill:none}
.speq-zero{stroke:rgba(var(--spice-rgb-text,255,255,255),.22);stroke-width:1;fill:none}
.speq-curve{stroke:var(--speq-accent);stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round;transition:stroke .2s}
.speq-eqline{stroke:rgba(var(--spice-rgb-text,255,255,255),.55);stroke-width:1.25;stroke-dasharray:3 3;fill:none}
.speq-stop-edge{stop-color:rgb(var(--speq-accent-rgb));stop-opacity:.35}
.speq-stop-mid{stop-color:rgb(var(--speq-accent-rgb));stop-opacity:.04}
.speq-panel.is-off .speq-curve{stroke:var(--speq-sub);stroke-dasharray:4 4}
.speq-panel.is-off .speq-stop-edge,.speq-panel.is-off .speq-stop-mid{stop-color:var(--speq-sub);stop-opacity:.08}
.speq-bands{position:absolute;inset:0;display:grid}
.speq-band{position:relative;cursor:ns-resize;outline:none;touch-action:none}
.speq-thumb{position:absolute;left:50%;width:14px;height:14px;border-radius:50%;background:var(--speq-text);transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.5);transition:transform .1s;pointer-events:none}
.speq-graph10 .speq-thumb{width:12px;height:12px}
.speq-band:hover .speq-thumb,.speq-band.is-dragging .speq-thumb{transform:translate(-50%,-50%) scale(1.2)}
.speq-band:focus-visible .speq-thumb{box-shadow:0 0 0 3px var(--spice-main-elevated,#282828),0 0 0 5px var(--speq-accent)}
.speq-labels{display:grid;text-align:center;margin-top:6px}
.speq-legend{margin-top:6px;text-align:right}
.speq-legend .speq-boost{font-weight:600;opacity:.85}
.speq-val{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.speq-graph10 .speq-val{font-size:11px}
.speq-val.is-zero{color:var(--speq-sub);font-weight:600}
.speq-freq{font-size:10.5px;color:var(--speq-sub);margin-top:1px}
.speq-boost{min-height:13px;margin-top:1px;font-size:10px;font-weight:700;color:var(--speq-accent);font-variant-numeric:tabular-nums;white-space:nowrap}
.speq-adv-hint{margin:6px 0 0 32px}
.speq-bass{margin-top:10px;padding:10px 12px 8px;border-radius:8px;background:var(--speq-soft)}
.speq-bass-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.speq-bass-title{font-weight:700}
.speq-row{display:grid;grid-template-columns:50px 1fr 54px;align-items:center;gap:10px;height:26px;cursor:pointer}
.speq-row-label{font-size:12px;color:var(--speq-sub)}
.speq-out{text-align:right;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.speq-bass.is-off .speq-row{opacity:.55}.speq-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;margin:0;border-radius:2px;outline:none;cursor:pointer;
  background:linear-gradient(to right,var(--speq-accent) var(--fill,0%),rgba(var(--spice-rgb-text,255,255,255),.2) var(--fill,0%))}
.speq-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:var(--speq-text);box-shadow:0 1px 3px rgba(0,0,0,.5)}
.speq-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px var(--spice-main-elevated,#282828),0 0 0 5px var(--speq-accent)}
.speq-foot{display:flex;align-items:center;gap:6px;margin:12px 0 0}
.speq-select,.speq-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border-radius:6px;padding:0 8px;font:inherit;color:inherit;
  background:rgba(var(--spice-rgb-text,255,255,255),.07);border:1px solid rgba(var(--spice-rgb-text,255,255,255),.14);outline:none}
.speq-select:focus-visible,.speq-input:focus{border-color:var(--speq-text)}
.speq-select option,.speq-select optgroup{background:var(--spice-main-elevated,#282828);color:var(--speq-text)}
.speq-input{user-select:text;-webkit-user-select:text}
.speq-btn{flex:none;height:32px;padding:0 12px;border-radius:16px;border:1px solid rgba(var(--spice-rgb-text,255,255,255),.28);background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
.speq-btn:not(:disabled):hover{border-color:var(--speq-text);transform:scale(1.03)}
.speq-btn:focus-visible{outline:2px solid var(--speq-text);outline-offset:2px}
.speq-btn:disabled{opacity:.4;cursor:default}
.speq-btn.speq-primary{background:var(--speq-accent);border-color:transparent;color:#000}
.speq-btn.speq-danger:not(:disabled):hover{border-color:#f15e6c;color:#f15e6c}
.speq-btn.speq-danger-solid{background:#e91429;border-color:transparent;color:#fff}
.speq-btn-sm{height:28px;padding:0 10px;font-size:12px}
.speq-mhead{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.speq-mtitle{flex:1;min-width:0;font-weight:700}
.speq-all{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--speq-sub);cursor:pointer}
.speq-check{width:14px;height:14px;margin:0;accent-color:var(--speq-accent);cursor:pointer}
.speq-list{display:flex;flex-direction:column;gap:2px;max-height:264px;overflow-y:auto;margin:0 -6px;padding:0 6px}
.speq-item{display:grid;grid-template-columns:14px minmax(0,1fr) 56px 92px;align-items:center;gap:10px;padding:7px 8px;border-radius:6px;cursor:pointer}
.speq-item:hover{background:var(--speq-soft)}
.speq-item.is-selected{background:rgba(var(--speq-accent-rgb),.16)}
.speq-item-name{display:flex;align-items:center;gap:6px;min-width:0;font-weight:600}
.speq-item-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.speq-pill{flex:none;padding:1px 5px;border-radius:4px;font-size:9.5px;font-weight:700;color:var(--speq-sub);border:1px solid rgba(var(--spice-rgb-text,255,255,255),.22)}
.speq-item.is-active .speq-item-name::after{content:"· active";flex:none;font-weight:600;font-size:11px;color:var(--speq-accent)}
.speq-item-meta{font-size:11px;color:var(--speq-sub);text-align:right;white-space:nowrap}
.speq-mini{width:56px;height:22px;overflow:visible}
.speq-mini line{stroke:rgba(var(--spice-rgb-text,255,255,255),.2);stroke-width:1}
.speq-mini path{fill:none;stroke:var(--speq-accent);stroke-width:1.5;stroke-linecap:round}
.speq-empty{padding:28px 8px;text-align:center;color:var(--speq-sub)}
.speq-hint{margin-top:8px;font-size:11px;color:var(--speq-sub)}
.speq-confirm-msg{flex:1;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.speq-panel *{transition:none!important}}
`;
    document.head.append(style);
  }
})();
