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

function speak(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  const text = el.textContent.trim();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.pitch = 1.0; u.lang = 'en-US';
  speechSynthesis.speak(u);
}

function metricId(label) {
  return 'metric_' + label.replace(/\s/g, '_');
}
function updateMetric(label, value) {
  const el = document.getElementById(metricId(label));
  if (el) el.textContent = value;
}
function clearFeedback() {
  const list = document.getElementById('feedbackList');
  list.innerHTML = '<div style="color:#9aa4b2; font-size:12px">Waiting for motion...</div>';
}
function addFeedback(type, message) {
  const list = document.getElementById('feedbackList');
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
  document.getElementById('soundStatus').textContent = soundEnabled ? 'ON' : 'OFF';
}

// ====== METRICS UI ======
function updateMetricsDisplay() {
  const config = sportConfigs[currentSport];
  const display = document.getElementById('metricsDisplay');
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
  document.getElementById('repCount').textContent = '0';
  document.getElementById('overallScore').textContent = '--';
  clearFeedback();
  updateMetricsDisplay();
}

function setSport(sport, el) {
  currentSport = sport;
  document.querySelectorAll('.sport-card').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  const config = sportConfigs[sport];
  const infoBox = document.getElementById('sportInfo');
  infoBox.innerHTML = `<h4>${config.info.title}</h4><ul>${config.info.points.map(p => `<li>${p}</li>`).join('')}</ul>`;
  document.getElementById('techniqueTips').textContent = config.tips;
  updateMetricsDisplay();
  resetMetrics();
}

document.addEventListener('DOMContentLoaded', () => {
  updateMetricsDisplay();
  const active = document.querySelector('.sport-card.active');
  if (active) setSport('golf', active);
});

// ====== GEOMETRY & DRAWING ======
function angleDeg(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mab = Math.hypot(abx, aby);
  const mcb = Math.hypot(cbx, cby);
  return Math.acos(Math.max(-1, Math.min(1, dot / (mab * mcb + 1e-9)))) * 180 / Math.PI;
}

function drawSkeleton(ctx, kps, flip = false) {
  const edges = [
    ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
    ['left_shoulder', 'right_shoulder'], ['left_hip', 'right_hip'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip']
  ];

  function get(name) {
    return kps.find(k => k.name === name) || { x: 0, y: 0, score: 0 };
  }

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#7c5cff';
  ctx.fillStyle = '#19c6ff';

  edges.forEach(([a, b]) => {
    const A = get(a), B = get(b);
    if (A.score > 0.3 && B.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  });

  kps.forEach(k => {
    if (k.score > 0.3) {
      ctx.beginPath();
      ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ====== SYNTHETIC KEYPOINTS (demo without ML) ======
function synthKeypoints(w, h, t) {
  // Centered stick figure that wiggles smoothly
  const cx = w * 0.5;
  const cy = h * 0.55;
  const s = Math.min(w, h) * 0.22;
  const wob = Math.sin(t * 1.3) * 0.08;
  const up = Math.sin(t * 0.9) * 0.06;
  function P(x,y){ return {x: cx + x*s, y: cy + y*s, score: 0.9}; }
  const pts = {
    left_shoulder:  P(-0.35 + wob, -0.8 + up),
    right_shoulder: P( 0.35 + wob, -0.8 + up),
    left_elbow:     P(-0.55, -0.5 + up),
    right_elbow:    P( 0.55, -0.5 + up),
    left_wrist:     P(-0.7, -0.25 + up),
    right_wrist:    P( 0.7, -0.25 + up),
    left_hip:       P(-0.2, -0.2 + up*0.5),
    right_hip:      P( 0.2, -0.2 + up*0.5),
    left_knee:      P(-0.2 - 0.05*Math.sin(t), 0.3 + 0.05*Math.sin(t*1.2)),
    right_knee:     P( 0.2 + 0.05*Math.cos(t), 0.3 + 0.05*Math.cos(t*1.2)),
    left_ankle:     P(-0.2, 0.8),
    right_ankle:    P( 0.2, 0.8)
  };
  return Object.entries(pts).map(([name, p]) => ({ name, ...p }));
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
  document.getElementById('overallScore').textContent = Math.round(score);
}

// ====== WEBCAM LOOP ======
async function startWebcamDemo() {
  try {
    if (activeStream) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    activeStream = stream;
    const vid = document.getElementById('cam');
    vid.srcObject = stream;
    await vid.play();
    sessionStartTime = Date.now();
    loop();
  } catch (e) {
    addFeedback('error', 'Camera access denied or unavailable');
    console.error(e);
  }
}

function stopWebcam() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  const vid = document.getElementById('cam');
  const cvs = document.getElementById('overlay');
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,cvs.width,cvs.height);
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
  }
}

function loop() {
  const vid = document.getElementById('cam');
  const cvs = document.getElementById('overlay');
  const ctx = cvs.getContext('2d');
  // Resize canvas to element pixel size
  const rect = cvs.getBoundingClientRect();
  cvs.width = rect.width * devicePixelRatio;
  cvs.height = rect.height * devicePixelRatio;
  ctx.clearRect(0,0,cvs.width,cvs.height);

  // draw video frame behind (already in <video>) — we just draw overlay
  const t = performance.now() / 1000;
  const kps = synthKeypoints(cvs.width, cvs.height, t);
  drawSkeleton(ctx, kps);
  analyzePose(kps);

  // update session time
  const sec = Math.floor((Date.now() - sessionStartTime)/1000);
  const mm = String(Math.floor(sec/60));
  const ss = String(sec%60).padStart(2,'0');
  document.getElementById('sessionTime').textContent = `${mm}:${ss}`;

  animationId = requestAnimationFrame(loop);
}

// ====== UPLOAD VIDEO HANDLERS ======

let uploadLoopRAF = null;
let uploadRVFC = null;

function startUploadOverlayLoop() {
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  const ctx = cvs.getContext('2d');

  // Resize canvas to match element on each frame (keeps sharp on resize/zoom)
  const render = () => {
    const rect = cvs.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (cvs.width !== w || cvs.height !== h) {
      cvs.width = w; cvs.height = h;
    }
    ctx.clearRect(0,0,w,h);
    const kps = synthKeypoints(w, h, vid.currentTime || performance.now()/1000);
    drawSkeleton(ctx, kps);
  };

  // Prefer requestVideoFrameCallback if present (Safari/Chrome support)
  if (typeof vid.requestVideoFrameCallback === 'function') {
    const step = () => {
      render();
      uploadRVFC = vid.requestVideoFrameCallback(step);
    };
    cancelUploadOverlayLoop();
    uploadRVFC = vid.requestVideoFrameCallback(step);
  } else {
    const step = () => {
      render();
      uploadLoopRAF = requestAnimationFrame(step);
    };
    cancelUploadOverlayLoop();
    uploadLoopRAF = requestAnimationFrame(step);
  }
}

function cancelUploadOverlayLoop() {
  const vid = document.getElementById('upVideo');
  if (vid && typeof vid.cancelVideoFrameCallback === 'function' && uploadRVFC) {
    vid.cancelVideoFrameCallback(uploadRVFC);
  }
  if (uploadLoopRAF) cancelAnimationFrame(uploadLoopRAF);
  uploadRVFC = null; uploadLoopRAF = null;
}

function setUploadStatus(msg) {
  const el = document.getElementById('uploadStatus');
  if (el) el.textContent = msg;
}

function handleVideoUpload(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  vid.src = url;
  vid.load();

  // Clear previous listeners
  vid.onloadedmetadata = null;
  vid.onplay = null;
  vid.onpause = null;
  vid.onended = null;
  vid.onerror = null;
  vid.onstalled = null;
  vid.onwaiting = null;
  vid.ontimeupdate = null;

  vid.addEventListener('loadedmetadata', () => {
    setUploadStatus(`Loaded: ${Math.round(vid.duration)}s • ${vid.videoWidth}×${vid.videoHeight}`);
    drawUploadOverlay();
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
function drawUploadOverlay() {
  const vid = document.getElementById('upVideo');
  const cvs = document.getElementById('upCanvas');
  const ctx = cvs.getContext('2d');
  const rect = cvs.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
  ctx.clearRect(0,0,w,h);
  // Use ONLY the video's currentTime so pausing truly freezes the overlay
  const t = isFinite(vid.currentTime) ? vid.currentTime : 0;
  const kps = synthKeypoints(w, h, t);
  drawSkeleton(ctx, kps);
}

function analyzeVideoFrame() {
  const out = document.getElementById('videoFeedback');
  const kps = synthKeypoints(640, 480, performance.now()/1000);
  const get = n => kps.find(k => k.name === n);
  const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
  const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
  const asym = Math.abs(L-R);
  out.innerHTML = `Estimated knee angles: L=${L.toFixed(1)}°, R=${R.toFixed(1)}° • Asym=${asym.toFixed(1)}°`;
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
  document.getElementById('strengths').innerHTML = '<ul>' + strengths.map(s => `<li>${s}</li>`).join('') + '</ul>';
  document.getElementById('improvements').innerHTML = '<ul>' + improvements.map(s => `<li>${s}</li>`).join('') + '</ul>';
  document.getElementById('coachingCues').innerHTML = '<ul>' + cues.map(s => `<li>${s}</li>`).join('') + '</ul>';
  document.getElementById('injuryRisks').innerHTML = '<ul>' + risks.map(s => `<li>${s}</li>`).join('') + '</ul>';
  document.getElementById('metricsSummary').innerHTML = metrics.map(([k,v]) => `
    <div class="metric-card"><div class="metric-label">${k}</div><div class="metric-value">${v}</div></div>`
  ).join('');
  document.getElementById('analysisReport').style.display = 'block';
  document.getElementById('videoFeedback').textContent = 'Generated a summary report for this session.';
}

function compareFrames() {
  document.getElementById('videoFeedback').textContent = 'Frame comparison demo: capture two timestamps and compare knee angles & symmetry (placeholder).';
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
