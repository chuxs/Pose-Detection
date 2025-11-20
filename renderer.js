//-----------------------------------------------------
// MoveNet Posture Monitor – Distance Adaptive (with Notifications)
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
// const calibrateBtn = document.createElement("button");
// calibrateBtn.innerText = "Calibrate Good Posture ✅";
// calibrateBtn.style.marginTop = "12px";
// calibrateBtn.style.padding = "8px";
// calibrateBtn.style.background = "#0f62fe";
// calibrateBtn.style.color = "#fff";
// calibrateBtn.style.border = "none";
// calibrateBtn.style.borderRadius = "6px";
// document.querySelector(".app").appendChild(calibrateBtn);

// Debug info
const debugEl = document.createElement("div");
debugEl.style.marginTop = "8px";
debugEl.style.fontSize = "12px";
debugEl.style.color = "#888";
document.querySelector(".app").appendChild(debugEl);

let badStart = null;
let alerted = false;

let baseline = 0;
let baselineSamples = [];
let calibrated = false;

let history = [];

// ---- LOAD MODEL ----
async function loadModel() {
  statusEl.innerText = "Loading MoveNet...";
  try {
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { 
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
        //modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true
      }
    );
    statusEl.innerText = "Model Ready ✅ Sit naturally and click Calibrate";
    console.log("MoveNet model loaded successfully");
  } catch (error) {
    console.error("Error loading model:", error);
    statusEl.innerText = "❌ Failed to load model";
    statusEl.style.color = "#ff4f4f";
  }
}

// ---- CAMERA ----
async function setupCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: 740, 
        height: 580, 
        facingMode: "user",
        frameRate: { ideal: 30 }
      }
    });
    video.srcObject = stream;
    
    return new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.play();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log(`Camera setup: ${video.videoWidth}x${video.videoHeight}`);
        resolve();
      };
      
      video.onerror = () => {
        console.error("Video error");
        statusEl.innerText = "❌ Camera error";
        resolve();
      };
    });
  } catch (error) {
    console.error("Camera setup error:", error);
    statusEl.innerText = "❌ Camera access denied";
    throw error;
  }
}

// ✅ Notification helper
function showNotification(title, body) {
  if (!("Notification" in window)) {
    console.warn("This browser does not support notifications.");
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "warning.png" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        new Notification(title, { body, icon: "warning.png" });
      }
    });
  }
}

// Calculate shoulder angle (horizontal tilt)
function getShoulderAngle(LS, RS) {
  const dx = RS.x - LS.x;
  const dy = RS.y - LS.y;
  const angleRad = Math.atan2(dy, dx);
  return (angleRad * 180) / Math.PI;
}

// ---- DRAW ----
function drawPose(kp, shoulderAngle, currentDiff = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw video frame
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Draw calibration lines if calibrated
  if (calibrated && kp[5] && kp[6]) {
    const shoulderMid = { 
      x: (kp[5].x + kp[6].x) / 2, 
      y: (kp[5].y + kp[6].y) / 2 
    };
    
    // Draw baseline reference (green)
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, shoulderMid.y + baseline);
    ctx.lineTo(canvas.width, shoulderMid.y + baseline);
    ctx.stroke();
    
    // Draw current head position line
    const deviation = Math.abs(currentDiff - baseline);
    const leanThreshold = 35; // Simple fixed threshold like original
    ctx.strokeStyle = deviation > leanThreshold ? 'rgba(255, 100, 0, 0.5)' : 'rgba(255, 255, 0, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, shoulderMid.y + currentDiff);
    ctx.lineTo(canvas.width, shoulderMid.y + currentDiff);
    ctx.stroke();
    
    ctx.setLineDash([]);
  }

  // Draw keypoints - only head and shoulders
  if (kp && kp.length > 0) {
    [0, 5, 6].forEach(index => {
      const p = kp[index];
      if (p && p.score > 0.55) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#00eaff";
        ctx.fill();
        
        // Labels
        ctx.fillStyle = "#ffffff";
        ctx.font = "12px Arial";
        const label = index === 0 ? "Nose" : index === 5 ? "L Shoulder" : "R Shoulder";
        ctx.fillText(label, p.x + 10, p.y - 10);
      }
    });

    // Draw shoulder line only
    ctx.strokeStyle = "#00ff95";
    ctx.lineWidth = 3;
    
    const LS = kp[5], RS = kp[6];
    if (LS && RS && LS.score > 0.55 && RS.score > 0.55) {
      ctx.beginPath();
      ctx.moveTo(LS.x, LS.y);
      ctx.lineTo(RS.x, RS.y);
      ctx.stroke();
      
      // Show metrics
      const midX = (LS.x + RS.x) / 2;
      const midY = Math.min(LS.y, RS.y) - 20;

      ctx.fillStyle = "#ffdb58";
      ctx.font = "16px Arial";
      ctx.fillText(`Shoulder Angle: ${shoulderAngle.toFixed(1)}°`, midX - 90, midY);
      
      if (calibrated) {
        const deviation = currentDiff - baseline;
        ctx.fillText(`Deviation: ${deviation.toFixed(1)}px`, midX - 60, midY + 25);
      }
    }
  }
}

// Simple calibration
function calibratePosture(shoulderMid, nose) {
  if (!shoulderMid || !nose) return;
  
  const diff = nose.y - shoulderMid.y;
  baselineSamples.push(diff);

  if (baselineSamples.length >= 30) {
    baseline = baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length;
    calibrated = true;
    
    statusEl.innerText = `✅ Calibrated! Good posture detected.`;
    statusEl.style.color = "#00ff95";
    
    console.log(`Baseline set to: ${baseline.toFixed(2)} from ${baselineSamples.length} samples`);
  }
}

// Simplified posture analysis
function analyzePosture(kp) {
  const nose = kp[0];
  const LS = kp[5];
  const RS = kp[6];

  if (!nose || !LS || !RS) {
    return { bad: false, reasons: [], shoulderAngle: 0, valid: false };
  }

  const reasons = [];
  const shoulderMid = { 
    x: (LS.x + RS.x) / 2, 
    y: (LS.y + RS.y) / 2 
  };

  const shoulderAngle = getShoulderAngle(LS, RS);
  const currentDiff = nose.y - shoulderMid.y;

  if (calibrated) {
    const deviation = currentDiff - baseline;
    if (deviation > 35) {
      reasons.push("Forward Lean");
    }
  }

  if (Math.abs(shoulderAngle) > 10) {
    reasons.push("Shoulder Tilt");
  }

  history.push(reasons.length);
  if (history.length > 12) history.shift();
  
  const avgBadness = history.reduce((a, b) => a + b, 0) / history.length;
  const consistent = avgBadness >= 1.2;

  debugEl.innerText = `Baseline: ${baseline.toFixed(1)} | Deviation: ${(currentDiff - baseline).toFixed(1)} | History avg: ${avgBadness.toFixed(2)}`;

  return { 
    bad: consistent,
    reasons, 
    shoulderAngle, 
    shoulderMid, 
    nose,
    currentDiff,
    valid: true
  };
}

// ---- MAIN LOOP ----
async function detectLoop() {
  try {
    if (!detector) {
      statusEl.innerText = "❌ Detector not ready";
      setTimeout(() => requestAnimationFrame(detectLoop), 1000);
      return;
    }

    const poses = await detector.estimatePoses(video, {
      maxPoses: 1,
      flipHorizontal: false
    });
    
    const pose = poses[0];
    let result = { valid: false, currentDiff: 0 };

    if (pose?.keypoints) {
      result = analyzePosture(pose.keypoints);
      drawPose(pose.keypoints, result.shoulderAngle, result.currentDiff);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ff4444";
      ctx.font = "20px Arial";
      ctx.fillText("No pose detected - Move into frame", 50, 50);
    }
    
    if (!result.valid) {
      statusEl.innerText = "⏳ Adjust position - need to see head and shoulders clearly";
      statusEl.style.color = "#ffaa00";
      return requestAnimationFrame(detectLoop);
    }

    const now = Date.now();

    if (!calibrated) {
      const progress = Math.min(baselineSamples.length, 30);
      statusEl.innerText = `Calibrating... ${progress}/30 - Sit naturally and hold still`;
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
        showNotification("⚠️ Fix Your Posture", `Detected: ${result.reasons.join(", ")}`);
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
  } catch (error) {
    console.error('Detection error:', error);
    statusEl.innerText = "❌ Detection error - retrying...";
    statusEl.style.color = "#ff4f4f";
    setTimeout(() => requestAnimationFrame(detectLoop), 1000);
    return;
  }

  requestAnimationFrame(detectLoop);
}

// Manual calibration button
// calibrateBtn.addEventListener("click", () => {
//   calibrated = false;
//   baselineSamples = [];
//   history = [];
//   badStart = null;
//   statusEl.innerText = "Re-Calibrating… Sit in your normal position!";
//   statusEl.style.color = "#ffaa00";
// });

// ---- START ----
(async function main() {
  try {
    statusEl.innerText = "Setting up camera...";
    await setupCamera();
    statusEl.innerText = "Camera ready! Loading pose detection...";
    await loadModel();
    statusEl.innerText = "Ready! Sit naturally and click Calibrate";
    detectLoop();
  } catch (error) {
    console.error('Startup error:', error);
    statusEl.innerText = "❌ Failed to start - check camera permissions";
    statusEl.style.color = "#ff4f4f";
  }
})();
