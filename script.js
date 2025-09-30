
// Shared narration
function speak(selector){
  const el = document.querySelector(selector);
  if(!('speechSynthesis' in window)) { alert('Speech not supported on this browser.'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(el.textContent);
  u.rate = 1.05; u.pitch = 1.0; u.lang = 'en-US';
  speechSynthesis.speak(u);
}

// Quiz
const answers = {q1:'b', q2:'b', q3:'b', q4:'a', q5:'b'};
function grade(){
  let s = 0; for(const k in answers){ const v = document.querySelector('input[name="'+k+'"]:checked'); if(v && v.value===answers[k]) s++; }
  const el = document.getElementById('score');
  if(el) el.textContent = s + '/5';
}

// Pose utils
function angleDeg(a,b,c){
  const abx=a.x-b.x, aby=a.y-b.y, cbx=c.x-b.x, cby=c.y-b.y;
  const dot=abx*cbx+aby*cby; const mab=Math.hypot(abx,aby), mcb=Math.hypot(cbx,cby);
  return Math.acos(Math.max(-1,Math.min(1,dot/(mab*mcb+1e-9))))*180/Math.PI;
}
function drawSkeleton(ctx, kps, flip=false){
  const edges = [ ['left_shoulder','left_elbow'], ['left_elbow','left_wrist'], ['right_shoulder','right_elbow'], ['right_elbow','right_wrist'], ['left_hip','left_knee'], ['left_knee','left_ankle'], ['right_hip','right_knee'], ['right_knee','right_ankle'], ['left_shoulder','right_shoulder'], ['left_hip','right_hip'] ];
  function get(name){ return kps.find(k=>k.name===name) || {x:0,y:0,score:0}; }
  ctx.lineWidth=2; ctx.strokeStyle='white'; ctx.fillStyle='white';
  edges.forEach(([a,b])=>{ const A=get(a), B=get(b); if(A.score>0.3 && B.score>0.3){ ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke(); }});
  kps.forEach(k=>{ if(k.score>0.3){ ctx.beginPath(); ctx.arc(k.x,k.y,3,0,Math.PI*2); ctx.fill(); }});
}

// Image page helpers (runs on metrics.html when present)
async function runPoseOnImage(imgEl, canvasEl){
  await ensurePoseLibs();
  const detector = await window._poseDetector;
  const poses = await detector.estimatePoses(imgEl,{maxPoses:1, flipHorizontal:false});
  if(!poses[0]) return;
  const kps = poses[0].keypoints;
  const ctx = canvasEl.getContext('2d');
  canvasEl.width = imgEl.naturalWidth; canvasEl.height = imgEl.naturalHeight;
  drawSkeleton(ctx, kps);
  // Example KPIs
  const get = n => kps.find(k=>k.name===n);
  const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
  const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
  const asym = 100*Math.abs(L-R)/(0.5*(L+R)+1e-3);
  const out = imgEl.closest('.tile').querySelector('.kpi');
  if(out){ out.innerHTML = `<span class="tag">Left knee: ${L.toFixed(1)}°</span><span class="tag">Right knee: ${R.toFixed(1)}°</span><span class="tag">Asym: ${asym.toFixed(1)}%</span>`; }
}

// Demo page helpers
async function ensurePoseLibs(){
  if(window._poseDetector) return;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection');
  // eslint-disable-next-line no-undef
  window._poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,{modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING});
}
function loadScript(src){
  return new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src=src; s.onload=resolve; s.onerror=reject; document.body.appendChild(s); });
}
async function startWebcamDemo(){
  await ensurePoseLibs();
  const video = document.getElementById('cam');
  const canvas = document.getElementById('overlay');
  const lk=document.getElementById('lk'), rk=document.getElementById('rk'), asym=document.getElementById('asym');
  const ctx = canvas.getContext('2d');
  const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user', width:{ideal:640}, height:{ideal:480}}});
  video.srcObject = stream; await new Promise(r=> video.onloadedmetadata = r);
  (async function loop(){
    const poses = await window._poseDetector.estimatePoses(video,{maxPoses:1, flipHorizontal:true});
    canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.clearRect(0,0,canvas.width,canvas.height);
    if(poses[0]){
      const kps = poses[0].keypoints; drawSkeleton(ctx, kps);
      const get = n=> kps.find(k=>k.name===n);
      const L = angleDeg(get('left_hip'), get('left_knee'), get('left_ankle'));
      const R = angleDeg(get('right_hip'), get('right_knee'), get('right_ankle'));
      if(isFinite(L)&&isFinite(R)){ lk.textContent=L.toFixed(1); rk.textContent=R.toFixed(1); asym.textContent=(Math.abs(L-R)/(0.5*(L+R)+1e-3)*100).toFixed(1)+'%'; }
    }
    requestAnimationFrame(loop);
  })();
}
async function handleVideoUpload(e){
  await ensurePoseLibs();
  const file = e.target.files[0]; if(!file) return;
  const url = URL.createObjectURL(file);
  const video = document.getElementById('upVideo');
  const canvas = document.getElementById('upCanvas');
  const ctx = canvas.getContext('2d');
  video.src = url;
  video.onloadedmetadata = ()=>{ video.play(); };
  (async function loop(){
    if(!video.paused && !video.ended){
      const poses = await window._poseDetector.estimatePoses(video,{maxPoses:1, flipHorizontal:false});
      canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.clearRect(0,0,canvas.width,canvas.height);
      if(poses[0]) drawSkeleton(ctx, poses[0].keypoints);
    }
    requestAnimationFrame(loop);
  })();
}
function handleImageUpload(e, imgId, canvasId){
  const file = e.target.files[0]; if(!file) return;
  const url = URL.createObjectURL(file);
  const img = document.getElementById(imgId);
  img.onload = ()=>{
    const canvas = document.getElementById(canvasId);
    runPoseOnImage(img, canvas);
  };
  img.src = url;
}
