/*
  Sports Pose Tutorial — script.js (complete)
  - Markerless skeleton overlay for images, webcam, and uploaded video
  - MoveNet via @tensorflow-models/pose-detection
  - Includes UI helpers, metrics, feedback, and simple quiz grading
*/

// ===== SHARED UTILITIES =====

// Speech synthesis for narration (single definition)
function speak(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  const text = el.textContent?.trim() || '';
  if (!('speechSynthesis' in window)) {
    alert('Speech not supported on this browser.');
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1.0;
  u.lang = 'en-US';
  speechSynthesis.speak(u);
}

// Quiz grading
const answers = { q1: 'b', q2: 'b', q3: 'b', q4: 'a', q5: 'b' };
function grade() {
  let s = 0;
  for (const k in answers) {
    const v = document.querySelector('input[name="' + k + '"]:checked');
    if (v && v.value === answers[k]) s++;
  }
  const el = document.getElementById('score');
  if (el) el.textContent = s + '/5';
}

// ====== GLOBAL STATE & CONFIG ======
const sportConfigs = {
  golf: {
    name: 'Golf Swing',
    metrics: ['Hip Rot', 'Shoulder Rot', 'X-Factor', 'Spine Angle', 'Weight Transfer'],
    info: {
      title: 'Golf Swing Analysis',
      points: [
        '<strong>Key Angles:</strong> Hip rotation, shoulder turn, spine angle, knee flex',
        '<strong>Phases:</strong> Address → Backswing → Top → Downswing → Impact → Follow-through',
        '<strong>Focus:</strong> X-factor (shoulder-hip separation), weight transfer, swing plane'
      ]
    },
    tips: 'Stand side-on to camera. Full swing motion. Camera ~3m away.'
  },
  sprint: {
    name: 'Sprint Mechanics',
    metrics: ['Knee Drive L', 'Knee Drive R', 'Stride Freq', 'Forward Lean', 'Ground Contact'],
    info: {
      title: 'Sprint Mechanics Analysis',
      points: [
        '<strong>Key Angles:</strong> Knee drive angle, ankle dorsiflexion, torso lean',
        '<strong>Phases:</strong> Stance → Swing → Flight → Foot strike',
        '<strong>Focus:</strong> Cadence (170–190 spm), knee drive >90°, full extension'
      ]
    },
    tips: 'Run perpendicular to camera. Full sprint effort. 10m capture zone.'
  },
  cricket: {
    name: 'Cricket Bowling',
    metrics: ['Front Arm', 'Bowl Arm', 'Hip-Shoulder', 'Follow Through', 'Release Height'],
    info: {
      title: 'Cricket Bowling Analysis',
      points: [
        '<strong>Key Angles:</strong> Bowling arm angle, front arm position, back arch',
        '<strong>Phases:</strong> Run-up → Delivery stride → Release → Follow-through',
        '<strong>Focus:</strong> Arm vertical at release, hip-shoulder separation, front arm pull'
      ]
    },
    tips: 'Side-on view of bowling action. Capture full run-up if possible.'
  },
  baseball: {
    name: 'Baseball Pitching',
    metrics: ['Arm Slot', 'Elbow Angle', 'Hip-Shoulder Sep', 'Stride Length', 'Release Point'],
    info: {
      title: 'Baseball Pitching Analysis',
      points: [
        '<strong>Key Angles:</strong> Elbow angle (avoid <90°), arm slot, stride angle',
        '<strong>Phases:</strong> Wind-up → Leg lift → Stride → Cocking → Acceleration → Follow-through',
        '<strong>Focus:</strong> Injury prevention, velocity optimization, release point consistency'
      ]
    },
    tips: 'Side camera angle best. Watch for elbow valgus stress.'
  },
  tennis: {
    name: 'Tennis Serve',
    metrics: ['Toss Height', 'Racket Drop', 'Shoulder Rot', 'Knee Bend', 'Contact Point'],
    info: {
      title: 'Tennis Serve Analysis',
      points: [
        '<strong>Key Angles:</strong> Trophy position, racket drop, knee bend at toss',
        '<strong>Phases:</strong> Toss → Trophy → Racket drop → Contact → Follow-through',
        '<strong>Focus:</strong> Contact point height, shoulder rotation, kinetic chain'
      ]
    },
    tips: 'Side-on camera placement. Capture full service motion.'
  },
  squat: {
    name: 'Squat Form',
    metrics: ['Left Knee', 'Right Knee', 'Hip Depth', 'Symmetry', 'Bar Path'],
    info: {
      title: 'Squat Technique Analysis',
      points: [
        '<strong>Key Angles:</strong> Knee flexion, hip depth, spine neutrality',
        '<strong>Phases:</strong> Standing → Descent → Bottom → Ascent',
        '<strong>Focus:</strong> Depth (~90° knee), symmetry, knee tracking'
      ]
    },
    tips: 'Side or front-oblique view. Keep full body in frame.'
  }
};

let currentSport = 'golf';
let repState = 'ready';
let repCount = 0;
let sessionStartTime = 0;
let soundEnabled = true;
let activeStream = null;
let animationId = null;
let phaseHistory = [];
let _lastFB = 0;

// ====== DOM HELPERS ======
function $(sel){ return document.querySelector(sel); }

function metricId(label) { return 'metric_' + label.replace(/\s/g, '_'); }
function updateMetric(label, value) {
  const el = document.getElementById(metricId(label));
  if (el) el.textContent = value;
}
function clearFeedback() {
  const list = document.getElementById('feedbackList');
  if (!list) return;
  list.innerHTML = '<div style="color:#9aa4b2; font-size:12px">Waiting for motion...</div>';
}
function addFeedback(type, message) {
  const list = document.getElementById('feedbackList');
  if (!list) return;
  if (list.querySelector('[style*="color:#9aa4b2"]')) list.innerHTML = '';
  const alert = document.createElement('div');
  alert.className = `feedback-alert feedback-${type}`;
  const icon = type === 'good' ? '✓' : type === 'warning' ? '⚠' : type === 'error' ? '✗' : 'ℹ';
  alert.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  list.insertBefore(alert, list.firstChild);
  if (list.children.length > 6) list.removeChild(list.lastChild);
  if (type === 'warning' || type === 'error') playSound(type);
  if (type === 'good') playSound('success');
}
function feedbackThrottled(type, msg, ms=1100) {
  const now = performance.now();
  if (now - _lastFB > ms) {
    addFeedback(type, msg);
    _lastFB = now;
  }
}

function playSound(type) {
  if (!soundEnabled) return;
  const audio = new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain); gain.connect(audio.destination);
  if (type === 'success') {
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.3, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.15);
  } else {
    osc.frequency.value = 400;
    gain.gain.setValueAtTime(0.2, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.1);
  }
  osc.start(audio.currentTime); osc.stop(audio.currentTime + 0.15);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const el = document.getElementById('soundStatus');
  if (el) el.textContent = soundEnabled ? 'ON' : 'OFF';
}

// ====== METRICS UI ======
function updateMetricsDisplay() {
  const config = sportConfigs[currentSport];
  const display = document.getElementById('metricsDisplay');
  if (!display) return;
  display.innerHTML = config.metrics.map(m => `
    <div class="metric-card">
      <div class="metric-label">${m}</div>
      <div class="metric-value" id="${metricId(m)}">--</div>
    </div>
  `).join('');
}

function resetMetrics() {
  repCount = 0;
  repState = 'ready';
  phaseHistory = [];
  const rc = document.getElementById('repCount');
  if (rc) rc.textContent = '0';
  const os = document.getElementById('overallScore');
  if (os) os.textContent = '--';
  clearFeedback();
  updateMetricsDisplay();
}

function setSport(sport, el) {
  currentSport = sport;
  document.querySelectorAll('.sport-card').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  const config = sportConfigs[sport];
  const infoBox = document.getElementById('sportInfo');
  if (infoBox) infoBox.innerHTML = `<h4>${config.info.title}</h4><ul>${config.info.points.map(p => `<li>${p}</li>`).join('')}</ul>`;
  const tips = document.getElementById('techniqueTips');
  if (tips) tips.textContent = config.tips;
  updateMetricsDisplay();
  resetMetrics();
}

document.addEventListener('DOMContentLoaded', () => {
  updateMetricsDisplay();
  const active = document.querySelector('.sport-card.active');
  if (active) setSport('golf', active);
});

// ===== POSE ESTIMATION UTILITIES =====

function angleDeg(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mab = Math.hypot(abx, aby);
  const mcb = Math.hypot(cbx, cby);
  return Math.acos(Math.max(-1, Math.min(1, dot / (mab * mcb + 1e-9)))) * 180 / Math.PI;
}

function drawSkeleton(ctx, kps) {
  const edges = [
    ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
    ['left_shoulder', 'right_shoulder'], ['left_hip', 'right_hip'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip']
  ];
  function get(name) { return kps.find(k => k.name === name) || { x: 0, y: 0, score: 0 }; }
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#7c5cff';
  ctx.fillStyle = '#19c6ff';
  edges.forEach(([a, b]) => {
    const A = get(a), B = get(b);
    if ((A.score ?? 0) > 0.3 && (B.score ?? 0) > 0.3) {
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  });
  kps.forEach(k => {
    if ((k.score ?? 0) > 0.3) {
      ctx.beginPath();
      ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function mapKeypointsToCanvas(kps, srcW, srcH, dstW, dstH) {
  const sx = dstW / (srcW || 1);
  const sy = dstH / (srcH || 1);
  return kps.map(k => ({
    ...k,
    x: k.x * sx,
    y: k.y * sy,
    score: (k.score == null ? 1 : k.score)
  }));
}

// ===== MODEL LOADING =====

async function ensurePoseLibs() {
  if (window._poseDetector) return;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection');
  window._poseDetector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

// ===== IMAGE ANALYSIS (for metrics.html) =====

async function runPoseOnImage(imgEl, canvasEl) {
  await ensurePoseLibs();
  const detector = window._poseDetector;
  const poses = await detector.estimatePoses(imgEl, { maxPoses: 1, flipHorizontal: false });
  if (!poses[0]) return;

  const kps = poses[0].keypoints;
  const ctx = canvasEl.getContext('2d');
  canvasEl.width = imgEl.naturalWidth;
  canvasEl.height = imgEl.naturalHeight;
  drawSkeleton(ctx, kps);

  const get = n => kps.find(k => k.name === n);
  const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
  const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
  const asym = 100 * Math.abs(L - R) / (0.5 * (L + R) + 1e-3);

  const out = imgEl.closest('.tile')?.querySelector('.kpi');
  if (out) {
    out.innerHTML = `<span class="tag">Left knee: ${L.toFixed(1)}°</span><span class="tag">Right knee: ${R.toFixed(1)}°</span><span class="tag">Asym: ${asym.toFixed(1)}%</span>`;
  }
}

function handleImageUpload(e, imgId, canvasId) {
  const file = e.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = document.getElementById(imgId);
  img.onload = () => {
    const canvas = document.getElementById(canvasId);
    runPoseOnImage(img, canvas);
  };
  img.src = url;
}

// ====== ANALYSIS ======
function analyzePose(kps) {
  const get = n => kps.find(k => k.name === n);
  const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
  const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
  if (!isFinite(L) || !isFinite(R)) return;

  const asymPct = Math.abs(L - R) / (0.5 * (L + R) + 1e-3) * 100;
  if (asymPct > 15) feedbackThrottled('warning', `Asymmetry ${asymPct.toFixed(1)}% — aim < 10%`);
  else feedbackThrottled('good', `Balanced lower-limb symmetry (${asymPct.toFixed(1)}%)`);

  if (currentSport === 'sprint') {
    updateMetric('Knee Drive L', (180 - L).toFixed(0) + '°');
    updateMetric('Knee Drive R', (180 - R).toFixed(0) + '°');
    // Torso lean proxy
    const LS = get('left_shoulder'), RS = get('right_shoulder');
    const LH = get('left_hip'), RH = get('right_hip');
    if (LS && RS && LH && RH) {
      const sh = { x:(LS.x+RS.x)/2, y:(LS.y+RS.y)/2 };
      const hp = { x:(LH.x+RH.x)/2, y:(LH.y+RH.y)/2 };
      const dy = sh.y - hp.y, dx = sh.x - hp.x;
      const lean = Math.abs(Math.atan2(dx, dy) * 180/Math.PI); // 0=vertical
      updateMetric('Forward Lean', lean.toFixed(1) + '°');
      if (lean < 3) feedbackThrottled('warning', 'Increase forward lean to ~5–10°');
    }
    updateMetric('Stride Freq', '—');
    updateMetric('Ground Contact', '—');

  } else if (currentSport === 'squat') {
    updateMetric('Left Knee', L.toFixed(1) + '°');
    updateMetric('Right Knee', R.toFixed(1) + '°');
    updateMetric('Symmetry', asymPct.toFixed(1) + '%');
    const LH = get('left_hip'), RH = get('right_hip');
    const LK = get('left_knee'), RK = get('right_knee');
    if (LH && RH && LK && RK) {
      const hipY = (LH.y + RH.y)/2, kneeY = (LK.y + RK.y)/2;
      const depth = (hipY - kneeY);
      updateMetric('Hip Depth', depth.toFixed(0) + 'px');
      if (L < 90 && R < 90) feedbackThrottled('good', 'Hit parallel (knee ~90°) or below');
      if (asymPct > 15) feedbackThrottled('warning', 'Keep knees tracking evenly');
    }
    updateMetric('Bar Path', '—');

  } else if (currentSport === 'golf') {
    const LS = get('left_shoulder'), RS = get('right_shoulder');
    const LH = get('left_hip'), RH = get('right_hip');
    if (LS && RS && LH && RH) {
      const shAngle = Math.atan2(RS.y - LS.y, RS.x - LS.x) * 180/Math.PI;
      const hipAngle = Math.atan2(RH.y - LH.y, RH.x - LH.x) * 180/Math.PI;
      const xFactor = Math.abs(shAngle - hipAngle);
      updateMetric('X-Factor', xFactor.toFixed(0) + '°');
      if (xFactor > 45) feedbackThrottled('good', 'Great X-Factor for power');
      else feedbackThrottled('warning', 'Increase shoulder turn for more X-Factor');
    }
    updateMetric('Hip Rot', '—');
    updateMetric('Shoulder Rot', '—');
    updateMetric('Spine Angle', '—');
    updateMetric('Weight Transfer', '—');

  } else if (currentSport === 'cricket' || currentSport === 'baseball') {
    const RS = get('right_shoulder'), RE = get('right_elbow'), RW = get('right_wrist');
    if (RS && RE && RW) {
      const elbowAngle = angleDeg(RS, RE, RW);
      updateMetric('Elbow Angle', elbowAngle.toFixed(0) + '°');
      if (elbowAngle < 90) feedbackThrottled('error', 'Elbow angle < 90° — potential strain risk');
      else feedbackThrottled('good', 'Elbow angle in safer range');
    }
    updateMetric('Arm Slot', '—');
    updateMetric('Hip-Shoulder Sep', '—');
    updateMetric('Stride Length', '—');
    updateMetric('Release Point', '—');

  } else if (currentSport === 'tennis') {
    updateMetric('Toss Height', '—');
    updateMetric('Racket Drop', '—');
    updateMetric('Shoulder Rot', '—');
    updateMetric('Knee Bend', (180 - L).toFixed(0) + '°');
    updateMetric('Contact Point', '—');
  }

  // Session score (very rough demo)
  const score = Math.max(10, Math.min(98, 100 - Math.abs(10 - (180 - L)) - asymPct * 0.2));
  const os = document.getElementById('overallScore');
  if (os) os.textContent = Math.round(score);
}

// ===== WEBCAM DEMO =====

async function startWebcamDemo() {
  await ensurePoseLibs();
  const video = document.getElementById('cam');
  const canvas = document.getElementById('overlay');
  const lk = document.getElementById('lk');
  const rk = document.getElementById('rk');
  const asym = document.getElementById('asym');
  const ctx = canvas.getContext('2d');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = stream;
    activeStream = stream;
    await new Promise(r => video.onloadedmetadata = r);

    (async function loop() {
      const poses = await window._poseDetector.estimatePoses(video, {
        maxPoses: 1,
        flipHorizontal: true
      });

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (poses[0]) {
        const kps = poses[0].keypoints;
        drawSkeleton(ctx, kps);
        const get = n => kps.find(k => k.name === n);
        const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
        const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));

        if (isFinite(L) && isFinite(R)) {
          if (lk) lk.textContent = L.toFixed(1);
          if (rk) rk.textContent = R.toFixed(1);
          if (asym) asym.textContent = (Math.abs(L - R) / (0.5 * (L + R) + 1e-3) * 100).toFixed(1) + '%';
          analyzePose(kps);
        }
      }
      animationId = requestAnimationFrame(loop);
    })();
  } catch (err) {
    alert('Camera access denied or unavailable: ' + err.message);
  }
}

// ===== VIDEO UPLOAD & ANALYSIS (markerless skeleton) =====

let uploadLoopRAF = null;
let uploadRVFC = null;
let uploadRunning = false;
let uploadPending = false;

function setUploadStatus(msg) {
  const el = document.getElementById('uploadStatus');
  if (el) el.textContent = msg;
}

function cancelUploadOverlayLoop() {
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  // Click anywhere on the video/canvas to analyze that moment
  const onMomentClick = () => analyzeCurrentMoment();
  if (cvs) cvs.onclick = onMomentClick;
  if (vid) vid.onclick = onMomentClick;
  uploadRunning = false;
  uploadPending = false;
  if (vid && typeof vid.cancelVideoFrameCallback === 'function' && uploadRVFC) {
    vid.cancelVideoFrameCallback(uploadRVFC);
  }
  if (uploadLoopRAF) cancelAnimationFrame(uploadLoopRAF);
  uploadRVFC = null; uploadLoopRAF = null;
}

async function startUploadOverlayLoop() {
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  const ctx = cvs.getContext('2d');

  await ensurePoseLibs();
  cancelUploadOverlayLoop();
  uploadRunning = true;

  const renderOnce = async () => {
    if (!uploadRunning || !vid || vid.readyState < 2) return;

    // Match canvas backing store to CSS size × DPR
    const rect = cvs.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    if (cvs.width !== W || cvs.height !== H) { cvs.width = W; cvs.height = H; }

    ctx.clearRect(0, 0, W, H);

    try {
      const poses = await window._poseDetector.estimatePoses(vid, { maxPoses: 1, flipHorizontal: false });
      if (poses[0]) {
        const mapped = mapKeypointsToCanvas(poses[0].keypoints, vid.videoWidth, vid.videoHeight, W, H);
        drawSkeleton(ctx, mapped);
        analyzePose(mapped);
      }
    } catch (_) { /* ignore per-frame errors */ }
  };

  if (typeof vid.requestVideoFrameCallback === 'function') {
    const step = async () => {
      if (!uploadRunning) return;
      if (uploadPending) { uploadRVFC = vid.requestVideoFrameCallback(step); return; }
      uploadPending = true;
      await renderOnce();
      uploadPending = false;
      uploadRVFC = vid.requestVideoFrameCallback(step);
    };
    uploadRVFC = vid.requestVideoFrameCallback(step);
  } else {
    const step = async () => {
      if (!uploadRunning) return;
      await renderOnce();
      uploadLoopRAF = requestAnimationFrame(step);
    };
    uploadLoopRAF = requestAnimationFrame(step);
  }
}

async function drawUploadOverlay() {
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  const ctx = cvs.getContext('2d');

  await ensurePoseLibs();

  const rect = cvs.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.floor(rect.width * dpr));
  const H = Math.max(1, Math.floor(rect.height * dpr));
  if (cvs.width !== W || cvs.height !== H) { cvs.width = W; cvs.height = H; }

  ctx.clearRect(0, 0, W, H);

  try {
    const poses = await window._poseDetector.estimatePoses(vid, { maxPoses: 1, flipHorizontal: false });
    const out = document.getElementById('videoFeedback');
    if (poses[0]) {
      const mapped = mapKeypointsToCanvas(poses[0].keypoints, vid.videoWidth, vid.videoHeight, W, H);
      drawSkeleton(ctx, mapped);
      analyzePose(mapped);
      // Moment readout for the paused/clicked frame
      const get = n => mapped.find(k => k.name === n);
      const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
      const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
      const asym = Math.abs(L - R);
      if (out) out.textContent = `t=${(vid.currentTime||0).toFixed(2)}s — L=${L.toFixed(1)}°, R=${R.toFixed(1)}° • Asym=${asym.toFixed(1)}°`;
    } else {
      const out = document.getElementById('videoFeedback');
      if (out) out.textContent = `t=${(vid.currentTime||0).toFixed(2)}s — No person detected.`;
    }
  } catch (_) {
    // ignore per-frame errors
  }
}

async function analyzeCurrentMoment() {
  // Pause (if playing) and analyze the exact displayed frame
  const vid = document.getElementById('upVideo');
  if (!vid) return;
  vid.pause();
  cancelUploadOverlayLoop();
  await drawUploadOverlay();
  setUploadStatus(`Analyzed @ ${(vid.currentTime||0).toFixed(2)}s`);
}

function handleVideoUpload(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const vid = document.getElementById('upVideo');

  cancelUploadOverlayLoop();

  vid.src = url;
  vid.load();

  // Clear previous listeners (if any)
  vid.onloadedmetadata = null;
  vid.onplay = null;
  vid.onpause = null;
  vid.onended = null;
  vid.onerror = null;
  vid.onstalled = null;
  vid.onwaiting = null;
  vid.ontimeupdate = null;

  vid.addEventListener('loadedmetadata', async () => {
    setUploadStatus(`Loaded: ${Math.round(vid.duration)}s • ${vid.videoWidth}×${vid.videoHeight}`);
    await drawUploadOverlay();
  }, { once: true });

  vid.addEventListener('play', () => {
    setUploadStatus('Playing…');
    startUploadOverlayLoop();
  });
  vid.addEventListener('pause', () => {
    setUploadStatus('Paused');
    cancelUploadOverlayLoop();
    // draw the frozen paused frame
    requestAnimationFrame(drawUploadOverlay);
  });
  vid.addEventListener('seeking', () => { setUploadStatus('Seeking…'); cancelUploadOverlayLoop(); });
  vid.addEventListener('seeked', () => { setUploadStatus('Seeked'); drawUploadOverlay(); });
  vid.addEventListener('ended', () => {
    setUploadStatus('Ended');
    cancelUploadOverlayLoop();
  });
  vid.addEventListener('stalled', () => setUploadStatus('Stalled (buffering issue)'));
  vid.addEventListener('waiting', () => setUploadStatus('Waiting (buffering/decoding)…'));
  vid.addEventListener('error', () => {
    const err = vid.error;
    setUploadStatus('Video error' + (err ? ` (code ${err.code})` : ''));
  });

  // Keep overlay fresh even on slow timeupdate
  vid.addEventListener('timeupdate', drawUploadOverlay);

  // Try to play (user gesture from file picker usually allows it)
  vid.play().catch(() => { setUploadStatus('Ready — click Play'); });
}

function analyzeVideoFrame() {
  // One-off analysis from the current uploaded video frame (uses real pose)
  const out = document.getElementById('videoFeedback');
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  const ctx = cvs.getContext('2d');
  if (!vid || !cvs) return;
  (async () => {
    await ensurePoseLibs();
    const rect = cvs.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    cvs.width = W; cvs.height = H;
    ctx.clearRect(0,0,W,H);
    const poses = await window._poseDetector.estimatePoses(vid, { maxPoses: 1, flipHorizontal: false });
    if (!poses[0]) { if (out) out.textContent = 'No person detected.'; return; }
    const mapped = mapKeypointsToCanvas(poses[0].keypoints, vid.videoWidth, vid.videoHeight, W, H);
    drawSkeleton(ctx, mapped);
    const get = n => mapped.find(k => k.name === n);
    const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
    const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
    const asym = Math.abs(L - R);
    if (out) out.textContent = `Estimated knee angles: L=${L.toFixed(1)}°, R=${R.toFixed(1)}° • Asym=${asym.toFixed(1)}°`;
  })();
}

function generateReport() {
  const strengths = [
    'Consistent symmetry across reps',
    'Stable torso during dynamic movement',
    'Effective lower-limb sequencing'
  ];
  const improvements = [
    'Increase forward lean slightly during acceleration phase',
    'Aim for more consistent depth at the bottom position',
    'Keep knee tracking over toes to reduce valgus'
  ];
  const cues = [
    'Think: “push the ground back” to improve stride mechanics',
    'Keep ribs down to maintain neutral spine',
    'Drive knee to hip height during swing phase'
  ];
  const risks = [
    'High asymmetry under fatigue',
    'Limited hip extension at toe-off'
  ];
  const metrics = [
    ['X-Factor', '42°'], ['Forward Lean', '7.5°'], ['Symmetry', '92%'], ['Cadence', '—']
  ];
  const sEl = document.getElementById('strengths');
  const iEl = document.getElementById('improvements');
  const cEl = document.getElementById('coachingCues');
  const rEl = document.getElementById('injuryRisks');
  const mEl = document.getElementById('metricsSummary');
  if (sEl) sEl.innerHTML = '<ul>' + strengths.map(s => `<li>${s}</li>`).join('') + '</ul>';
  if (iEl) iEl.innerHTML = '<ul>' + improvements.map(s => `<li>${s}</li>`).join('') + '</ul>';
  if (cEl) cEl.innerHTML = '<ul>' + cues.map(s => `<li>${s}</li>`).join('') + '</ul>';
  if (rEl) rEl.innerHTML = '<ul>' + risks.map(s => `<li>${s}</li>`).join('') + '</ul>';
  if (mEl) mEl.innerHTML = metrics.map(([k,v]) => `
    <div class="metric-card"><div class="metric-label">${k}</div><div class="metric-value">${v}</div></div>`
  ).join('');
  const rep = document.getElementById('analysisReport');
  const vf = document.getElementById('videoFeedback');
  if (rep) rep.style.display = 'block';
  if (vf) vf.textContent = 'Generated a summary report for this session.';
}

function compareFrames() {
  const vf = document.getElementById('videoFeedback');
  if (vf) vf.textContent = 'Frame comparison demo: capture two timestamps and compare knee angles & symmetry (placeholder).';
}

function pauseUpload() {
  const vid = document.getElementById('upVideo');
  if (!vid) return;
  vid.pause();
  cancelUploadOverlayLoop();
  // Render the exact paused frame
  requestAnimationFrame(drawUploadOverlay);
}
function playUpload() {
  const vid = document.getElementById('upVideo');
  if (!vid) return;
  vid.play().catch(()=>{});
}
function stepUpload(dir) {
  // dir = +1 (forward) or -1 (back)
  const vid = document.getElementById('upVideo');
  if (!vid || !isFinite(vid.duration)) return;
  const fpsGuess = 30; // simple default; user video may be VFR
  const dt = 1 / fpsGuess;
  vid.pause();
  cancelUploadOverlayLoop();
  // Seek and then draw once when we land
  const target = Math.min(Math.max(0, (vid.currentTime || 0) + dir * dt), vid.duration - 1e-3);
  const onSeeked = () => {
    vid.removeEventListener('seeked', onSeeked);
    drawUploadOverlay();
  };
  vid.addEventListener('seeked', onSeeked);
  vid.currentTime = target;
}
