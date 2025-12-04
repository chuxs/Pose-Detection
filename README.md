# Posture Monitoring Anya 🧘

A real-time posture monitoring desktop application built with Electron and TensorFlow.js. The app uses your webcam to detect body pose and alerts you when poor posture is detected for an extended period.

![Electron](https://img.shields.io/badge/Electron-39.0.0-47848F?logo=electron)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-3.21.0-FF6F00?logo=tensorflow)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## ✨ Features

- **Real-time Pose Detection** – Uses Google's MoveNet SINGLEPOSE_THUNDER model for accurate pose estimation
- **Auto-Calibration** – Automatically calibrates to your natural sitting posture on startup
- **Visual Feedback** – Displays keypoints (nose, shoulders) and deviation lines on a canvas overlay
- **Posture Analysis** – Detects bad posture based on:
  - Head/shoulder deviation from baseline
  - Shoulder tilt angle (horizontal alignment)
- **Desktop Notifications** – Sends system notifications after 10 seconds of continuous bad posture
- **Smoothed Detection** – Uses historical averaging to prevent false positives from momentary movements

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|------------|
| Desktop Framework | Electron 39.x |
| ML Framework | TensorFlow.js 3.21 |
| Pose Model | MoveNet (SINGLEPOSE_THUNDER) |
| MediaPipe | Pose Detection Backend |
| Frontend | HTML5 Canvas, CSS3, Vanilla JS |

---

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm (comes with Node.js)
- Webcam access

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/Pose-Detection.git
   cd Pose-Detection
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the application**
   ```bash
   npm start
   ```

---

## 🚀 Usage

1. **Launch the app** – Run `npm start` to open the application window
2. **Grant camera permission** – Allow the app to access your webcam when prompted
3. **Calibration phase** – Sit in your natural, comfortable posture and hold still
   - The app will collect 30 samples to establish your baseline
   - Status will show "Calibrating... X/30"
4. **Monitoring phase** – Once calibrated, the app continuously monitors your posture
   - ✅ **Green status** = Good posture
   - ⚠️ **Red status** = Bad posture detected
5. **Notification** – After 10 seconds of continuous bad posture, a desktop notification will alert you

---

## 📁 Project Structure

```
Pose-Detection/
├── main.js          # Electron main process – creates the application window
├── renderer.js      # Renderer process – pose detection & posture analysis logic
├── index.html       # Application UI structure
├── style.css        # Application styling
├── package.json     # Project configuration and dependencies
└── README.md        # This file
```

---

## ⚙️ Configuration

Key parameters can be adjusted in `renderer.js`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `BAD_POSTURE_SECONDS` | `10` | Seconds of bad posture before notification triggers |
| `leanThreshold` | `35` | Pixel deviation threshold for forward/backward lean |
| Shoulder angle threshold | `10°` | Maximum acceptable shoulder tilt angle |
| Calibration samples | `30` | Number of frames collected during calibration |
| History buffer size | `12` | Frames used for smoothing posture detection |

### MoveNet Model Options

The app uses `SINGLEPOSE_THUNDER` by default (more accurate). You can switch to `SINGLEPOSE_LIGHTNING` for faster but less accurate detection:

```javascript
// In renderer.js, loadModel() function
modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER  // Accurate
// modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING  // Fast
```

---

## 🎯 How It Works

### Pose Detection Pipeline

```
Webcam Feed → TensorFlow.js → MoveNet Model → Keypoint Extraction
                                                      ↓
                                        Posture Analysis Algorithm
                                                      ↓
                                   Visual Feedback + Notifications
```

### Posture Analysis

1. **Keypoint Extraction** – The model identifies nose (index 0) and shoulders (indices 5, 6)
2. **Baseline Calibration** – Calculates average nose-to-shoulder-midpoint distance when you sit properly
3. **Deviation Detection** – Compares current position against baseline:
   - Forward lean: `deviation > 35px`
   - Backward lean: `deviation < -60px`
4. **Shoulder Tilt** – Calculates angle between shoulders; triggers alert if `|angle| > 10°`
5. **Smoothing** – Uses 12-frame rolling average to reduce false positives

### Visual Indicators

- **Cyan dots** – Detected keypoints (nose, left/right shoulders)
- **Green line** – Shoulder connection
- **Dashed green line** – Baseline reference (calibrated position)
- **Yellow/Orange line** – Current head position relative to baseline

---

## 🔔 Notifications

The app uses the Web Notifications API for desktop alerts. On first run, you'll be prompted to allow notifications. Notifications include:

- Title: "⚠️ Fix Your Posture"
- Body: Description of detected posture issues

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Camera not detected | Check if another app is using the webcam. Restart the app. |
| Model fails to load | Ensure you have an internet connection (models load from CDN). |
| False positives | Ensure good lighting and minimal background movement. |
| No notifications | Check system notification permissions for the app. |
| Low detection accuracy | Ensure your full upper body (head + shoulders) is visible in frame. |

---

## 🔧 Development

### Enable DevTools

Uncomment line 19 in `main.js` to open Chrome DevTools for debugging:

```javascript
win.webContents.openDevTools();
```

### Debug Information

The app displays real-time debug info at the bottom:
- **Baseline** – Calibrated nose-shoulder distance
- **Deviation** – Current deviation from baseline
- **History avg** – Rolling average of posture quality

---

## 📄 License

This project is licensed under the ISC License.

---

## 🙏 Acknowledgments

- [TensorFlow.js](https://www.tensorflow.org/js) – Machine learning in JavaScript
- [MoveNet](https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html) – Fast and accurate pose detection model
- [Electron](https://www.electronjs.org/) – Cross-platform desktop apps with JavaScript

---

## 🚧 Future Improvements

- [ ] Manual re-calibration button
- [ ] Adjustable notification threshold via UI
- [ ] Posture history/statistics tracking
- [ ] Multiple posture profiles (standing, sitting, etc.)
- [ ] Audio alerts option
- [ ] Minimize to system tray

