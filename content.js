/* ===== YT Pitch Changer =====
 * YouTube上にターンテーブル/CDJ風のピッチフェーダーを表示し、
 * playbackRate でスピード（＝ピッチ）を変更する。
 */
(() => {
  'use strict';
  if (window.__ytpcLoaded) return;
  window.__ytpcLoaded = true;

  /* --- 設定 --- */
  // フェーダーの向き。true = 上がマイナス（Technics / CDJ と同じ向き）
  const FADER_INVERTED = true;
  const RANGES = [8, 10, 16];
  const STEP = 0.05;        // 内部の最小刻み(%)
  const SNAP = 0.12;        // センター(0.0%)へのスナップ幅(%)
  const TAP_TIMEOUT = 2000; // これ以上間が空いたらタップをリセット(ms)
  const MOVING_HOLD = 900;  // 「変化中」表示を維持する時間(ms)

  const state = {
    pitch: 0,            // 現在のピッチ(%)
    range: 8,            // ±レンジ(%)
    masterTempo: false,  // true = 音程を保持（CDJのMASTER TEMPO ON）
    baseBpm: null,       // 原曲のBPM（タップ or 手入力）
    visible: true,
    collapsed: false,
    pos: null,           // {left, top} パネル位置
  };

  let panel, elPct, elBpm, elTrack, elHandle, elScale, elTicks, btnMT, btnsRange;
  let video = null;
  let movingTimer = null;
  let reapplyGuard = 0;

  /* ================= 動画要素 ================= */

  function isWatchPage() { return location.pathname === '/watch'; }

  function findVideo() {
    // ホーム／検索結果ではサムネイルのプレビュー動画を掴んでしまうので触らない
    if (!isWatchPage()) return null;
    return document.querySelector('#movie_player video') ||
           document.querySelector('video.html5-main-video') ||
           document.querySelector('video');
  }

  function desiredRate() {
    return 1 + state.pitch / 100;
  }

  function applyRate() {
    if (!video) return;
    const rate = desiredRate();
    try {
      // preservesPitch = false で音程も一緒に動く（ターンテーブル的な挙動）
      video.preservesPitch = state.masterTempo;
      video.webkitPreservesPitch = state.masterTempo;
      if (Math.abs(video.playbackRate - rate) > 1e-6) video.playbackRate = rate;
    } catch (e) { /* 動画差し替え中などは無視 */ }
  }

  // YouTube の速度メニュー等で上書きされた場合に取り戻す。
  // ピッチが 0 のときは何もしない（YouTube側の速度設定を尊重する）
  function onRateChange() {
    if (state.pitch === 0 || !video) return;
    if (Math.abs(video.playbackRate - desiredRate()) < 1e-4) { reapplyGuard = 0; return; }
    if (reapplyGuard++ > 5) return; // 綱引きになったら諦める
    setTimeout(() => { applyRate(); render(); }, 0);
  }

  function bindVideo() {
    const v = findVideo();
    if (v === video) return;
    if (video) {
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('loadedmetadata', applyRate);
    }
    video = v;
    reapplyGuard = 0;
    if (video) {
      video.addEventListener('ratechange', onRateChange);
      video.addEventListener('loadedmetadata', applyRate);
      applyRate();
    }
  }

  /* ================= 永続化 ================= */

  function save() {
    try {
      chrome.storage.local.set({
        ytpc: {
          range: state.range,
          masterTempo: state.masterTempo,
          baseBpm: state.baseBpm,
          visible: state.visible,
          collapsed: state.collapsed,
          pos: state.pos,
        },
      });
    } catch (e) { /* 拡張のリロード直後などは無視 */ }
  }

  function load() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['ytpc'], (res) => {
          Object.assign(state, res && res.ytpc ? res.ytpc : {});
          if (!RANGES.includes(state.range)) state.range = 8;
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  /* ================= ピッチ操作 ================= */

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  function setPitch(pct, opts = {}) {
    let p = clamp(pct, -state.range, state.range);
    p = Math.round(p / STEP) * STEP;
    // センターへのスナップはフェーダーを掴んだときだけ（微調整では邪魔になる）
    if (opts.snap && Math.abs(p) < SNAP) p = 0;
    state.pitch = Number(p.toFixed(2));
    reapplyGuard = 0;
    applyRate();
    render();
    if (opts.moving !== false) flagMoving();
  }

  // ホイール／矢印キーによる微調整
  function nudge(delta) { setPitch(state.pitch + delta, { snap: false }); }

  function flagMoving() {
    panel.classList.add('ytpc-moving');
    clearTimeout(movingTimer);
    movingTimer = setTimeout(() => panel.classList.remove('ytpc-moving'), MOVING_HOLD);
  }

  /* ================= BPM ================= */

  let taps = [];

  function onTap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > TAP_TIMEOUT) taps = [];
    taps.push(now);
    if (taps.length > 9) taps.shift();
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avg > 150 && avg < 3000) {
        // 「今聞こえている音」にタップしているので、原曲BPMは現在のレートで割り戻す
        const heard = 60000 / avg;
        state.baseBpm = Number((heard / desiredRate()).toFixed(2));
        render();
        save();
      }
    } else {
      render(); // タップ1回目はカウント表示のみ
    }
  }

  function clearBpm() {
    taps = [];
    state.baseBpm = null;
    render();
    save();
  }

  function currentBpm() {
    return state.baseBpm == null ? null : state.baseBpm * desiredRate();
  }

  // BPM表示をクリックしたら手入力に切り替える
  function editBpm() {
    if (elBpm.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = state.baseBpm == null ? '' : String(Math.round(state.baseBpm * 10) / 10);
    input.placeholder = 'BPM';
    elBpm.textContent = '';
    elBpm.appendChild(input);
    input.focus();
    input.select();
    let closed = false;
    const close = () => { closed = true; input.remove(); render(); };
    const commit = () => {
      if (closed) return;
      const n = parseFloat(input.value);
      // 入力された値は「原曲のBPM」として扱う
      state.baseBpm = isFinite(n) && n > 20 && n < 400 ? Number(n.toFixed(2)) : null;
      taps = [];
      close();
      save();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { commit(); elTrack.focus(); }
      if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', commit);
  }

  /* ================= 描画 ================= */

  // CDJ 同様に小数2桁（STEP = 0.05% の微調整が読めるように）
  function fmtPct(p) {
    const a = Math.abs(p).toFixed(2);
    if (Number(a) === 0) return '0.00';
    return (p > 0 ? '+' : '-') + a;
  }

  function render() {
    if (!panel) return;

    elPct.firstChild.textContent = fmtPct(state.pitch);
    panel.classList.toggle('ytpc-active', state.pitch !== 0);

    // BPM
    if (!elBpm.querySelector('input')) {
      const bpm = currentBpm();
      elBpm.textContent = '';
      const num = document.createElement('span');
      if (bpm == null) {
        num.textContent = taps.length === 1 ? 'TAP…' : '--';
        elBpm.classList.add('ytpc-empty');
      } else {
        num.textContent = bpm.toFixed(1);
        elBpm.classList.remove('ytpc-empty');
      }
      const unit = document.createElement('i');
      unit.textContent = 'BPM';
      elBpm.append(num, unit);
      elBpm.title = state.baseBpm == null
        ? 'TAPでBPM入力 / クリックで手入力'
        : `原曲 ${state.baseBpm.toFixed(1)} BPM（クリックで手入力・TAP長押しでクリア）`;
    }

    // つまみ位置
    const travel = elTrack.clientHeight - elHandle.offsetHeight;
    const norm = state.range === 0 ? 0 : state.pitch / state.range; // -1..1
    const ratio = FADER_INVERTED ? (0.5 + norm * 0.5) : (0.5 - norm * 0.5);
    elHandle.style.top = (ratio * travel) + 'px';

    // レンジ表示
    btnsRange.forEach((b) => b.classList.toggle('ytpc-on', Number(b.dataset.range) === state.range));
    btnMT.classList.toggle('ytpc-on', state.masterTempo);

    renderScale();
  }

  function renderScale() {
    const r = state.range;
    const marks = [r, r / 2, 0, -r / 2, -r];
    elScale.textContent = '';
    elTicks.textContent = '';
    const travel = elTrack.clientHeight - elHandle.offsetHeight;
    const offset = elHandle.offsetHeight / 2;

    marks.forEach((m) => {
      const norm = m / r;
      // つまみ位置と同じ式を使う（FADER_INVERTED = true なら上がマイナス）
      const ratio = FADER_INVERTED ? (0.5 + norm * 0.5) : (0.5 - norm * 0.5);
      const y = offset + ratio * travel;

      const label = document.createElement('span');
      label.textContent = (m > 0 ? '+' : m < 0 ? '-' : '') + Math.abs(m).toFixed(1);
      label.style.top = y + 'px';
      elScale.appendChild(label);
    });

    // 目盛り（片側5本 + センター）
    for (let i = 0; i <= 10; i++) {
      const t = document.createElement('i');
      t.style.top = (offset + (i / 10) * travel) + 'px';
      if (i === 5) t.className = 'ytpc-tick-mid';
      elTicks.appendChild(t);
    }
  }

  /* ================= UI 構築 ================= */

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ytpc-panel';
    panel.innerHTML = `
      <div class="ytpc-head">
        <span class="ytpc-title">PITCH</span>
        <button class="ytpc-min" title="最小化">–</button>
      </div>
      <div class="ytpc-body">
        <div class="ytpc-readout">
          <div class="ytpc-pct"><span>0.00</span><i>%</i></div>
          <div class="ytpc-bpm ytpc-empty"><span>--</span><i>BPM</i></div>
        </div>
        <div class="ytpc-fader">
          <div class="ytpc-scale"></div>
          <div class="ytpc-ticks"></div>
          <div class="ytpc-track" tabindex="0" title="ドラッグ／ホイール／↑↓キー・ダブルクリックで0.0%">
            <div class="ytpc-center"></div>
            <div class="ytpc-handle"></div>
          </div>
        </div>
        <div class="ytpc-ranges">
          ${RANGES.map((r) => `<button data-range="${r}">±${r}</button>`).join('')}
        </div>
        <div class="ytpc-btns">
          <button class="ytpc-mt" title="ON = 音程を保持（速度だけ変わる）／OFF = ターンテーブル同様に音程も動く">MASTER TEMPO</button>
          <button class="ytpc-tap" title="拍に合わせてタップ／長押しでクリア">TAP</button>
          <button class="ytpc-reset" title="0.0% に戻す">RESET</button>
        </div>
        <div class="ytpc-hint">Alt+P で表示切替</div>
      </div>`;

    elPct = panel.querySelector('.ytpc-pct');
    elBpm = panel.querySelector('.ytpc-bpm');
    elTrack = panel.querySelector('.ytpc-track');
    elHandle = panel.querySelector('.ytpc-handle');
    elScale = panel.querySelector('.ytpc-scale');
    elTicks = panel.querySelector('.ytpc-ticks');
    btnMT = panel.querySelector('.ytpc-mt');
    btnsRange = Array.from(panel.querySelectorAll('.ytpc-ranges button'));

    if (state.pos) {
      panel.style.left = state.pos.left + 'px';
      panel.style.top = state.pos.top + 'px';
      panel.style.right = 'auto';
    }
    panel.classList.toggle('ytpc-collapsed', state.collapsed);

    // フルスクリーン時にパネルがプレイヤーの子になるため、
    // パネル内の操作が YouTube 側のショートカット（再生/停止・全画面解除）に伝わらないよう遮断する
    ['click', 'dblclick', 'pointerdown', 'pointerup', 'keydown', 'wheel'].forEach((t) => {
      panel.addEventListener(t, (e) => e.stopPropagation());
    });

    wireFader();
    wireButtons();
    wireDragPanel();
    mount();
  }

  /* --- フェーダー操作 --- */
  function wireFader() {
    let dragging = false;

    const pitchFromY = (clientY) => {
      const rect = elTrack.getBoundingClientRect();
      const hh = elHandle.offsetHeight;
      const travel = rect.height - hh;
      const ratio = clamp((clientY - rect.top - hh / 2) / travel, 0, 1);
      const norm = FADER_INVERTED ? (ratio - 0.5) * 2 : (0.5 - ratio) * 2;
      return norm * state.range;
    };

    elTrack.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { elTrack.setPointerCapture(e.pointerId); } catch (_) {}
      setPitch(pitchFromY(e.clientY), { snap: true });
      e.preventDefault();
    });

    elTrack.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      setPitch(pitchFromY(e.clientY), { snap: true });
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { elTrack.releasePointerCapture(e.pointerId); } catch (_) {}
      save();
    };
    elTrack.addEventListener('pointerup', end);
    elTrack.addEventListener('pointercancel', end);

    elTrack.addEventListener('dblclick', () => setPitch(0));

    elTrack.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.shiftKey ? STEP : 0.1;
      // つまみの動く向きに合わせる（上へスクロール = つまみが上）
      const up = e.deltaY < 0;
      nudge(FADER_INVERTED ? (up ? -step : step) : (up ? step : -step));
    }, { passive: false });

    // フェーダーにフォーカスがある間だけ矢印キーを奪う
    elTrack.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? STEP : 0.1;
      if (e.key === 'ArrowUp') { nudge(FADER_INVERTED ? -step : step); }
      else if (e.key === 'ArrowDown') { nudge(FADER_INVERTED ? step : -step); }
      else if (e.key === '0' || e.key === 'Home') { setPitch(0); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /* --- ボタン --- */
  function wireButtons() {
    btnsRange.forEach((b) => b.addEventListener('click', () => {
      state.range = Number(b.dataset.range);
      setPitch(state.pitch, { moving: false }); // レンジ外なら丸め込まれる
      save();
    }));

    btnMT.addEventListener('click', () => {
      state.masterTempo = !state.masterTempo;
      applyRate();
      render();
      save();
    });

    const btnTap = panel.querySelector('.ytpc-tap');
    let holdTimer = null;
    btnTap.addEventListener('pointerdown', () => {
      holdTimer = setTimeout(() => { holdTimer = null; clearBpm(); }, 600);
    });
    btnTap.addEventListener('pointerup', () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; onTap(); }
    });
    btnTap.addEventListener('pointerleave', () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    });

    panel.querySelector('.ytpc-reset').addEventListener('click', () => setPitch(0));

    elBpm.addEventListener('click', editBpm);

    panel.querySelector('.ytpc-min').addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      panel.classList.toggle('ytpc-collapsed', state.collapsed);
      if (!state.collapsed) render();
      save();
    });
  }

  /* --- パネルの移動 --- */
  function wireDragPanel() {
    const head = panel.querySelector('.ytpc-head');
    let sx = 0, sy = 0, sl = 0, st = 0, dragging = false;

    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      sx = e.clientX; sy = e.clientY; sl = rect.left; st = rect.top;
      head.classList.add('ytpc-grabbing');
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });

    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = clamp(sl + e.clientX - sx, 0, window.innerWidth - panel.offsetWidth);
      const top = clamp(st + e.clientY - sy, 0, window.innerHeight - 40);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
      state.pos = { left, top };
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      head.classList.remove('ytpc-grabbing');
      save();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  /* --- 全画面表示ではフルスクリーン要素側に付け替える --- */
  function mount() {
    const host = document.fullscreenElement || document.body;
    if (panel.parentElement !== host) host.appendChild(panel);
    updateVisibility();
  }

  // watch ページ以外ではパネルを出さない
  function updateVisibility() {
    const show = state.visible && isWatchPage();
    panel.classList.toggle('ytpc-hidden', !show);
    if (show) render(); // 非表示中は高さが取れずつまみ位置を計算できないため
  }

  function toggleVisible() {
    state.visible = !state.visible;
    updateVisibility();
    save();
  }

  // ウィンドウが縮んだときにパネルが画面外へ出ないようにする
  function clampPos() {
    if (!state.pos) return;
    const left = clamp(state.pos.left, 0, Math.max(0, window.innerWidth - panel.offsetWidth));
    const top = clamp(state.pos.top, 0, Math.max(0, window.innerHeight - 40));
    if (left !== state.pos.left || top !== state.pos.top) {
      state.pos = { left, top };
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      save();
    }
  }

  /* ================= 起動 ================= */

  load().then(() => {
    buildPanel();
    bindVideo();

    document.addEventListener('fullscreenchange', mount);
    document.addEventListener('webkitfullscreenchange', mount);

    // Alt+P で表示切替（パネル内で押しても効くよう capture フェーズで拾う）
    document.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyP' || e.key === 'p')) {
        if (!isWatchPage()) return;
        toggleVisible();
        e.preventDefault();
      }
    }, true);

    window.addEventListener('resize', clampPos);

    // 動画切り替え（SPA遷移）でピッチをリセットし、要素を貼り直す
    window.addEventListener('yt-navigate-finish', () => {
      state.pitch = 0;
      taps = [];
      bindVideo();   // 同じ video 要素が再利用される場合は何もしない
      applyRate();
      mount();
    });

    // 動画要素の差し替え / DOM再構築への保険。
    // 広告明けや画質切替で preservesPitch を戻されても取り返す（ratechange が出ないケース）
    setInterval(() => {
      bindVideo();
      if (state.pitch !== 0) applyRate();
      if (!panel.isConnected) mount();
    }, 1000);
  });
})();
