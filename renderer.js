//=============================================================================
// MoveNet Posture Monitor – Distance Adaptive (with Notifications)
//=============================================================================
// This application uses TensorFlow.js and the MoveNet pose detection model
// to monitor user posture in real-time via webcam. It detects poor posture
// (forward lean, backward lean, tilted shoulders) and sends desktop
// notifications after sustained bad posture.
//=============================================================================

// Pose detection model instance (initialized in loadModel)
let detector;

// Number of seconds of continuous bad posture before triggering a notification
const BAD_POSTURE_SECONDS = 10;

//-----------------------------------------------------------------------------
// DOM ELEMENT REFERENCES
//-----------------------------------------------------------------------------

// Video element that displays the webcam feed
const video = document.getElementById("video");

// Canvas element used to draw pose overlay on top of video
const canvas = document.getElementById("canvas");

// 2D rendering context for drawing on the canvas
const ctx = canvas.getContext("2d");

// Status text element showing current state (calibrating, good/bad posture)
const statusEl = document.getElementById("status");

//-----------------------------------------------------------------------------
// DYNAMIC UI ELEMENTS
//-----------------------------------------------------------------------------

// Timer display showing seconds of continuous bad posture
const timerText = document.createElement("div");
timerText.style.color = "#ffaa00";
timerText.style.fontSize = "18px";
timerText.style.marginTop = "10px";
document.querySelector(".app").appendChild(timerText);

// Debug info display showing baseline, deviation, and history average
// Useful for understanding the posture detection algorithm
const debugEl = document.createElement("div");
debugEl.style.marginTop = "8px";
debugEl.style.fontSize = "12px";
debugEl.style.color = "#888";
document.querySelector(".app").appendChild(debugEl);

//-----------------------------------------------------------------------------
// POSTURE TRACKING STATE
//-----------------------------------------------------------------------------

// Timestamp when bad posture was first detected (null if posture is good)
let badStart = null;

// Flag to prevent multiple notifications for the same bad posture session
let alerted = false;

// Calibrated baseline: average nose-to-shoulder-midpoint distance during good posture
let baseline = 0;

// Array collecting samples during calibration phase
let baselineSamples = [];

// Flag indicating whether calibration is complete
let calibrated = false;

// Rolling history of posture quality scores for smoothing detection
// Stores count of reasons for bad posture per frame (0 = good, 1+ = bad)
let history = [];

//=============================================================================
// MODEL LOADING
//=============================================================================

/**
 * Loads the MoveNet pose detection model from TensorFlow.js
 * Uses SINGLEPOSE_THUNDER variant for better accuracy (slower than LIGHTNING)
 *
 * Model variants:
 * - SINGLEPOSE_THUNDER: More accurate, slightly slower (~30ms per frame)
 * - SINGLEPOSE_LIGHTNING: Faster, less accurate (~15ms per frame)
 */
async function loadModel() {
  statusEl.innerText = "Loading MoveNet...";
  try {
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
        // Alternative: SINGLEPOSE_LIGHTNING for faster but less accurate detection
        // modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true, // Reduces jitter in keypoint positions
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

//=============================================================================
// CAMERA SETUP
//=============================================================================

/**
 * Initializes the webcam and sets up the video stream
 * Requests camera permission from the user and configures video dimensions
 *
 * @returns {Promise<void>} Resolves when camera is ready and streaming
 * @throws {Error} If camera access is denied or unavailable
 */
async function setupCamera() {
  try {
    // Request camera access with specified constraints
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 1820, // Desired video width
        height: 1100, // Desired video height
        facingMode: "user", // Use front-facing camera
        frameRate: { ideal: 30 }, // Target 30 FPS for smooth detection
      },
    });

    // Attach stream to video element
    video.srcObject = stream;

    // Wait for video metadata to load before resolving
    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        // Match canvas dimensions to actual video dimensions
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

//=============================================================================
// NOTIFICATION SYSTEM
//=============================================================================

/**
 * Displays a desktop notification to alert the user about bad posture
 * Uses the Web Notifications API (requests permission if not yet granted)
 *
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 */
function showNotification(title, body) {
  // Check if browser supports notifications
  if (!("Notification" in window)) {
    console.warn("This browser does not support notifications.");
    return;
  }

  // If permission granted, show notification immediately
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "warning.svg" });
  }
  // If not denied, request permission first
  else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, { body, icon: "warning.svg" });
      }
    });
  }
}

//=============================================================================
// POSTURE CALCULATION UTILITIES
//=============================================================================

/**
 * Calculates the horizontal tilt angle of the shoulders
 * A perfectly level shoulder line has angle 0°
 * Positive angle = right shoulder higher, Negative = left shoulder higher
 *
 * @param {Object} LS - Left shoulder keypoint {x, y, score}
 * @param {Object} RS - Right shoulder keypoint {x, y, score}
 * @returns {number} Angle in degrees (-180 to 180)
 */
function getShoulderAngle(LS, RS) {
  const dx = RS.x - LS.x; // Horizontal distance between shoulders
  const dy = RS.y - LS.y; // Vertical distance (should be ~0 for level shoulders)
  const angleRad = Math.atan2(dy, dx); // Angle in radians
  return (angleRad * 180) / Math.PI; // Convert to degrees
}

//=============================================================================
// POSE VISUALIZATION
//=============================================================================

/**
 * Draws the pose overlay on the canvas including:
 * - Video frame as background
 * - Baseline reference line (calibrated position)
 * - Current head position line
 * - Keypoints (nose, shoulders) as colored dots
 * - Shoulder connection line
 * - Real-time metrics (angle, deviation)
 *
 * @param {Array} kp - Array of keypoints from pose detection
 * @param {number} shoulderAngle - Current shoulder tilt angle in degrees
 * @param {number} currentDiff - Current nose-to-shoulder-midpoint distance
 */
function drawPose(kp, shoulderAngle, currentDiff = 0) {
  // Clear previous frame
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw video frame as background
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  //--- Draw calibration reference lines ---
  if (calibrated && kp[5] && kp[6]) {
    // Calculate midpoint between shoulders
    const shoulderMid = {
      x: (kp[5].x + kp[6].x) / 2,
      y: (kp[5].y + kp[6].y) / 2,
    };

    // Draw baseline reference line (green dashed) - represents good posture position
    ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed line pattern
    ctx.beginPath();
    ctx.moveTo(0, shoulderMid.y + baseline);
    ctx.lineTo(canvas.width, shoulderMid.y + baseline);
    ctx.stroke();

    // Draw current head position line
    // Color changes based on deviation: yellow (OK) or orange (bad)
    const deviation = Math.abs(currentDiff - baseline);
    const leanThreshold = 35; // Pixel threshold for bad posture
    ctx.strokeStyle =
      deviation > leanThreshold
        ? "rgba(255, 100, 0, 0.5)"
        : "rgba(255, 255, 0, 0.5)";
    ctx.beginPath();
    ctx.moveTo(0, shoulderMid.y + currentDiff);
    ctx.lineTo(canvas.width, shoulderMid.y + currentDiff);
    ctx.stroke();

    ctx.setLineDash([]); // Reset to solid lines
  }

  //--- Draw keypoints (nose and shoulders only) ---
  if (kp && kp.length > 0) {
    // Keypoint indices: 0 = nose, 5 = left shoulder, 6 = right shoulder
    [0, 5, 6].forEach((index) => {
      const p = kp[index];
      // Only draw if confidence score is above threshold
      if (p && p.score > 0.55) {
        // Draw keypoint as cyan circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#00eaff";
        ctx.fill();

        // Draw label next to keypoint
        ctx.fillStyle = "#ffffff";
        ctx.font = "12px Arial";
        const label =
          index === 0 ? "Nose" : index === 5 ? "L Shoulder" : "R Shoulder";
        ctx.fillText(label, p.x + 10, p.y - 10);
      }
    });

    //--- Draw shoulder connection line ---
    ctx.strokeStyle = "#00ff95"; // Bright green
    ctx.lineWidth = 3;

    const LS = kp[5],
      RS = kp[6]; // Left and right shoulder
    if (LS && RS && LS.score > 0.55 && RS.score > 0.55) {
      // Draw line connecting shoulders
      ctx.beginPath();
      ctx.moveTo(LS.x, LS.y);
      ctx.lineTo(RS.x, RS.y);
      ctx.stroke();

      //--- Display metrics above shoulder line ---
      const midX = (LS.x + RS.x) / 2;
      const midY = Math.min(LS.y, RS.y) - 20;

      ctx.fillStyle = "#ffdb58"; // Yellow text
      ctx.font = "16px Arial";
      ctx.fillText(
        `Shoulder Angle: ${shoulderAngle.toFixed(1)}°`,
        midX - 90,
        midY
      );

      // Show deviation only after calibration
      if (calibrated) {
        const deviation = currentDiff - baseline;
        ctx.fillText(
          `Deviation: ${deviation.toFixed(1)}px`,
          midX - 60,
          midY + 25
        );
      }
    }
  }
}

//=============================================================================
// CALIBRATION
//=============================================================================

/**
 * Collects posture samples during calibration phase
 * After collecting 30 samples, calculates the baseline (average) and
 * marks calibration as complete
 *
 * The baseline represents the nose-to-shoulder-midpoint distance
 * when the user is sitting in their natural, good posture position
 *
 * @param {Object} shoulderMid - Midpoint between shoulders {x, y}
 * @param {Object} nose - Nose keypoint {x, y, score}
 */
function calibratePosture(shoulderMid, nose) {
  if (!shoulderMid || !nose) return;

  // Calculate vertical distance from nose to shoulder midpoint
  const diff = nose.y - shoulderMid.y;
  baselineSamples.push(diff);

  // Once we have enough samples, compute the baseline
  if (baselineSamples.length >= 30) {
    // Average all samples to get stable baseline
    baseline =
      baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length;
    calibrated = true;

    statusEl.innerText = `✅ Calibrated! Good posture detected.`;
    statusEl.style.color = "#00ff95";

    console.log(
      `Baseline set to: ${baseline.toFixed(2)} from ${
        baselineSamples.length
      } samples`
    );
  }
}

//=============================================================================
// POSTURE ANALYSIS
//=============================================================================

/**
 * Analyzes the current pose to determine if posture is good or bad
 *
 * Bad posture is detected based on:
 * 1. Vertical deviation - Head too far forward (>35px) or back (<-60px) from baseline
 * 2. Shoulder tilt - Shoulders tilted more than 10 degrees from horizontal
 *
 * Uses a rolling history buffer to smooth detection and reduce false positives
 * from momentary movements
 *
 * @param {Array} kp - Array of keypoints from pose detection
 * @returns {Object} Analysis result containing:
 *   - bad: boolean - Whether posture is considered bad
 *   - reasons: string[] - List of detected issues
 *   - shoulderAngle: number - Current shoulder tilt angle
 *   - shoulderMid: Object - Midpoint between shoulders
 *   - nose: Object - Nose keypoint
 *   - currentDiff: number - Current nose-shoulder distance
 *   - valid: boolean - Whether detection was successful
 */
function analyzePosture(kp) {
  // Extract key points: nose (0), left shoulder (5), right shoulder (6)
  const nose = kp[0];
  const LS = kp[5];
  const RS = kp[6];

  // Return invalid if required keypoints are missing
  if (!nose || !LS || !RS) {
    return { bad: false, reasons: [], shoulderAngle: 0, valid: false };
  }

  const reasons = [];

  // Calculate shoulder midpoint
  const shoulderMid = {
    x: (LS.x + RS.x) / 2,
    y: (LS.y + RS.y) / 2,
  };

  // Calculate current metrics
  const shoulderAngle = getShoulderAngle(LS, RS);
  const currentDiff = nose.y - shoulderMid.y;

  //--- Check for vertical deviation (forward/backward lean) ---
  if (calibrated) {
    const deviation = currentDiff - baseline;
    // Forward lean: head drops below baseline (positive deviation)
    // Backward lean: head rises above baseline (negative deviation)
    if (deviation > 35 || deviation < -60) {
      reasons.push("Bad Posture Detected");
    }
  }

  //--- Check for shoulder tilt ---
  // Shoulders should be relatively level (within ±10 degrees)
  if (Math.abs(shoulderAngle) > 10) {
    reasons.push("Bad Posture Detected");
  }

  //--- Smooth detection using history buffer ---
  // Store number of issues detected this frame
  history.push(reasons.length);
  // Keep only last 12 frames
  if (history.length > 12) history.shift();

  // Calculate average "badness" over recent frames
  const avgBadness = history.reduce((a, b) => a + b, 0) / history.length;
  // Require consistent bad posture (average >= 1.2) to trigger alert
  const consistent = avgBadness >= 1.2;

  // Update debug display
  debugEl.innerText = `Baseline: ${baseline.toFixed(1)} | Deviation: ${(
    currentDiff - baseline
  ).toFixed(1)} | History avg: ${avgBadness.toFixed(2)}`;

  return {
    bad: consistent, // Only true if bad posture is sustained
    reasons,
    shoulderAngle,
    shoulderMid,
    nose,
    currentDiff,
    valid: true,
  };
}

//=============================================================================
// MAIN DETECTION LOOP
//=============================================================================

/**
 * Main detection loop that runs continuously using requestAnimationFrame
 *
 * Flow:
 * 1. Run pose estimation on current video frame
 * 2. If calibrating: collect baseline samples
 * 3. If calibrated: analyze posture and track bad posture duration
 * 4. Draw pose overlay
 * 5. Send notification if bad posture persists for BAD_POSTURE_SECONDS
 * 6. Schedule next frame
 */
async function detectLoop() {
  try {
    // Ensure detector is ready
    if (!detector) {
      statusEl.innerText = "❌ Detector not ready";
      setTimeout(() => requestAnimationFrame(detectLoop), 1000);
      return;
    }

    //--- Run pose estimation ---
    const poses = await detector.estimatePoses(video, {
      maxPoses: 1, // Only detect one person
      flipHorizontal: false, // Don't flip (CSS handles mirroring)
    });

    const pose = poses[0];
    let result = { valid: false, currentDiff: 0 };

    //--- Process detected pose ---
    if (pose?.keypoints) {
      result = analyzePosture(pose.keypoints);
      drawPose(pose.keypoints, result.shoulderAngle, result.currentDiff);
    } else {
      // No pose detected - draw video with warning message
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ff4444";
      ctx.font = "20px Arial";
      ctx.fillText("No pose detected - Move into frame", 50, 50);
    }

    //--- Handle invalid detection ---
    if (!result.valid) {
      statusEl.innerText =
        "⏳ Adjust position - need to see head and shoulders clearly";
      statusEl.style.color = "#ffaa00";
      return requestAnimationFrame(detectLoop);
    }

    const now = Date.now();

    //--- Calibration phase ---
    if (!calibrated) {
      const progress = Math.min(baselineSamples.length, 30);
      statusEl.innerText = `Calibrating... ${progress}/30 - Sit naturally and hold still`;
      calibratePosture(result.shoulderMid, result.nose);
      return requestAnimationFrame(detectLoop);
    }

    //--- Posture monitoring phase ---
    if (result.bad) {
      // Bad posture detected - start or continue timer
      if (!badStart) badStart = now;
      const secs = Math.floor((now - badStart) / 1000);

      // Update status to show warning
      statusEl.innerText = `⚠️ Bad posture (${secs}s): ${result.reasons.join(
        ", "
      )}`;
      statusEl.style.color = "#ff4f4f";
      timerText.innerText = `${secs}s`;

      // Trigger notification after threshold
      if (secs >= BAD_POSTURE_SECONDS && !alerted) {
        alerted = true;
        showNotification(
          "⚠️ Fix Your Posture",
          `Detected: ${result.reasons.join(", ")}`
        );
        // Reset tracking after notification
        badStart = null;
        alerted = false;
        history = []; // Clear history to give fresh start
        timerText.innerText = "";
      }
    } else {
      // Good posture - reset tracking
      badStart = null;
      timerText.innerText = "";
      statusEl.innerText = "✅ Good posture";
      statusEl.style.color = "#00ff95";
    }
  } catch (error) {
    // Handle detection errors gracefully
    console.error("Detection error:", error);
    statusEl.innerText = "❌ Detection error - retrying...";
    statusEl.style.color = "#ff4f4f";
    setTimeout(() => requestAnimationFrame(detectLoop), 1000);
    return;
  }

  // Schedule next frame
  requestAnimationFrame(detectLoop);
}

//=============================================================================
// APPLICATION STARTUP
//=============================================================================

/**
 * Main entry point - initializes camera and model, then starts detection loop
 *
 * Initialization sequence:
 * 1. Set up camera and get video stream
 * 2. Load MoveNet pose detection model
 * 3. Start the continuous detection loop
 */
(async function main() {
  try {
    statusEl.innerText = "Setting up camera...";
    await setupCamera();

    statusEl.innerText = "Camera ready! Loading pose detection...";
    await loadModel();

    statusEl.innerText = "Ready! Sit naturally and click Calibrate";
    detectLoop(); // Start the detection loop
  } catch (error) {
    console.error("Startup error:", error);
    statusEl.innerText = "❌ Failed to start - check camera permissions";
    statusEl.style.color = "#ff4f4f";
  }
})();
