//-----------------------------------------------------
// MoveNet Posture Monitor – Shoulder Angle Display ✅
//-----------------------------------------------------

let detector;
const BAD_POSTURE_SECONDS = 10;

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

// UI
const timerText = document.createElement("div");
timerText.style.color = "#ffaa00";
timerText.style.fontSize = "18px";
timerText.style.marginTop = "10px";
document.querySelector(".app").appendChild(timerText);

// Calibration button
const calibrateBtn = document.createElement("button");
calibrateBtn.innerText = "Calibrate Good Posture ✅";
calibrateBtn.style.marginTop = "12px";
calibrateBtn.style.padding = "8px";
calibrateBtn.style.background = "#0f62fe";
calibrateBtn.style.color = "#fff";
calibrateBtn.style.border = "none";
calibrateBtn.style.borderRadius = "6px";
document.querySelector(".app").appendChild(calibrateBtn);

let badStart = null;
let alerted = false;

let baseline = 0;
let baselineSamples = [];
let calibrated = false;

let history = [];


// ---- LOAD MODEL ----
async function loadModel() {
  statusEl.innerText = "Loading MoveNet...";
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );
  statusEl.innerText = "Model Ready ✅ Click Calibrate";
}

// ---- CAMERA ----
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" }
  });
  video.srcObject = stream;
  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      video.play();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      resolve();
    };
  });
}

// ✅ Calculate shoulder angle (horizontal tilt)
function getShoulderAngle(LS, RS) {
  const dx = RS.x - LS.x;
  const dy = RS.y - LS.y;
  const angleRad = Math.atan2(dy, dx);
  return (angleRad * 180) / Math.PI;
}

// ---- DRAW ----
function drawPose(kp, shoulderAngle) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  kp.forEach(p => {
    if (p.score > 0.55) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#00eaff";
      ctx.fill();
    }
  });

  const pairs = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
  ctx.strokeStyle = "#00ff95";
  ctx.lineWidth = 2;
  pairs.forEach(([i, j]) => {
    const a = kp[i], b = kp[j];
    if (a.score > 0.55 && b.score > 0.55) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  });

  // ✅ Show shoulder angle above shoulder center
  const LS = kp[5];
  const RS = kp[6];
  const midX = (LS.x + RS.x) / 2;
  const midY = (LS.y + RS.y) - 20;

  ctx.fillStyle = "#ffdb58";
  ctx.font = "18px Arial";
  ctx.fillText(`Shoulder Angle: ${shoulderAngle.toFixed(1)}°`, midX - 100, midY);
}


// ✅ Auto-calibration
function calibratePosture(midShoulder, nose) {
  const diff = nose.y - midShoulder.y;
  baselineSamples.push(diff);

  if (baselineSamples.length >= 30) {
    baseline = baselineSamples.reduce((a,b)=>a+b,0) / baselineSamples.length;
    calibrated = true;
    statusEl.innerText = "✅ Calibrated!";
    statusEl.style.color = "#00ff95";
  }
}


// ✅ Posture Logic
function analyzePosture(kp) {
  const nose = kp[0];
  const LS = kp[5];
  const RS = kp[6];
  const LH = kp[11];
  const RH = kp[12];

  if (!nose || !LS || !RS || !LH || !RH)
    return { bad:false, reasons:[], shoulderAngle:0 };

  const reasons = [];
  const shoulderMid = { x:(LS.x+RS.x)/2, y:(LS.y+RS.y)/2 };
  const hipMid = { x:(LH.x+RH.x)/2, y:(LH.y+RH.y)/2 };

  const shoulderAngle = getShoulderAngle(LS, RS);

  // ✅ Forward Lean Detection
  if (calibrated) {
    const diff = nose.y - shoulderMid.y;
    if (diff > baseline + 35) reasons.push("Forward Lean");
  }

  // ✅ Side Lean / Shoulder Tilt Detection using angle
  if (Math.abs(shoulderAngle) > 10)
    reasons.push("Shoulder Tilt");

  history.push(reasons.length);
  if (history.length > 12) history.shift();
  const consistent = history.reduce((a,b)=>a+b,0) / history.length;

  return { bad: consistent >= 1.2, reasons, shoulderAngle, shoulderMid, nose };
}


// ---- MAIN LOOP ----
async function detectLoop() {
  const poses = await detector.estimatePoses(video);
  const pose = poses[0];

  if (pose?.keypoints) {
    const result = analyzePosture(pose.keypoints);

    drawPose(pose.keypoints, result.shoulderAngle);

    const now = Date.now();

    if (!calibrated) {
      statusEl.innerText = "Calibrating posture… Hold still";
      calibratePosture(result.shoulderMid, result.nose);
      return requestAnimationFrame(detectLoop);
    }

    if (result.bad) {
      if (!badStart) badStart = now;
      const secs = Math.floor((now - badStart)/1000);

      statusEl.innerText = `⚠️ Bad posture (${secs}s): ${result.reasons.join(", ")}`;
      statusEl.style.color = "#ff4f4f";
      timerText.innerText = `${secs}s`;

      if (secs >= BAD_POSTURE_SECONDS && !alerted) {
        alerted = true;
        alert(`⚠️ Fix posture: ${result.reasons.join(", ")}`);
        badStart = null;
        alerted = false;
        history = [];
        timerText.innerText = "";
      }

    } else {
      badStart = null;
      timerText.innerText = "";
      statusEl.innerText = "✅ Good posture";
      statusEl.style.color = "#00ff95";
    }
  }

  requestAnimationFrame(detectLoop);
}


// ✅ Manual calibration button
calibrateBtn.addEventListener("click", () => {
  calibrated = false;
  baselineSamples = [];
  history = [];
  badStart = null;
  statusEl.innerText = "Re-Calibrating… Sit neutral!";
});


// ---- START ----
(async function main() {
  await setupCamera();
  await loadModel();
  detectLoop();
})();
