import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const PORT = 3000;

  // Simulate Data Generation
  let pan = 0;
  let tilt = 0;
  let pressure = 1013;
  let commandedMode: string | null = null;
  let isEmergency = false;
  let primaryTargetId: string | null = 'UAV-01';

    const drones: any[] = [];

  io.on('connection', (socket) => {
    socket.on('follow_target', (id: string | null) => {
      primaryTargetId = id;
    });

    socket.on('quick_lock', (id: string) => {
      const target = drones.find(d => d.id === id);
      if (target) {
        pan = target.x;
        tilt = target.y;
      }
    });

    socket.on('calibrate', () => {
      drones.forEach(d => { d.x = 0; d.y = 0; });
      pan = 0;
      tilt = 0;
    });
    
    socket.on('return_to_home', () => {
      drones.forEach(d => { d.x = 0; d.y = 0; });
      pan = 0;
      tilt = 0;
      commandedMode = 'RTH';
      setTimeout(() => commandedMode = null, 5000);
    });

    socket.on('toggle_tracking', () => {
      trackingActive = !trackingActive;
    });

    socket.on('trigger_neutralization', () => {
      simulatedNeutralization = true;
      setTimeout(() => simulatedNeutralization = false, 3000);
    });

    socket.on('emergency_shutdown', () => {
      isEmergency = true;
      setTimeout(() => isEmergency = false, 5000);
    });
  });
  
  // Simulate Environment parameters at top level for persistence
  let env_temperature = 10;
  let env_humidity = 60;
  let env_windSpeed = 10;
  let trackingActive = true;
  let simulatedNeutralization = false;

  setInterval(() => {
    // High-altitude physics wander
    env_temperature += (Math.random() - 0.5) * 1.5; 
    if (env_temperature < -15) env_temperature = -15;
    if (env_temperature > 30) env_temperature = 30;
    
    env_humidity += (Math.random() - 0.5) * 2;
    if (env_humidity > 95) env_humidity = 95;
    if (env_humidity < 20) env_humidity = 20;

    pressure += (Math.random() - 0.5) * 10; 
    if (pressure < 600) pressure = 600;
    if (pressure > 1020) pressure = 1020;

    env_windSpeed += (Math.random() - 0.5) * 5;
    if (env_windSpeed < 0) env_windSpeed = 0;
    if (env_windSpeed > 60) env_windSpeed = 60;

    // Simulate IMU disturbance based on wind
    let imu_roll = (Math.random() - 0.5) * (env_windSpeed / 10);
    let imu_pitch = (Math.random() - 0.5) * (env_windSpeed / 10);

    // Derived states based on logic in PDF
    const thermalActive = env_temperature < 0;
    const fogRiskHigh = env_humidity > 80 && env_temperature < 5;
    const highAltitudeMode = pressure < 800;

    if (isEmergency) {
      drones.forEach(d => {
        d.x = 0;
        d.y = 0;
        d.conf = 0.1;
      });
    } else {
      // Random walk for targets
      drones.forEach(d => {
        d.x += (Math.random() - 0.5) * 10;
        d.y += (Math.random() - 0.5) * 10;
        
        let confPenalty = fogRiskHigh ? 0.2 : 0;
        if (highAltitudeMode) confPenalty -= 0.1; // Compensation

        d.conf = Math.min(1, Math.max(0, d.conf + (Math.random() - 0.5) * 0.1 - (confPenalty * 0.1)));
        d.bat = Math.max(0, d.bat - (Math.random() * 0.08) - (thermalActive ? 0.05 : 0)); // drain battery faster in cold
      });
    }
    
    // Simple proportional control simulation tracks the selected drone or the first one if none selected
    const primary = drones.find(d => d.id === primaryTargetId) || { id: "none", x: 0, y: 0, conf: 0, bat: 0, model: "none", isHighPriority: false };
    const errorX = primary.x - pan;
    const errorY = primary.y - tilt;
    
    const panCompensation = imu_roll * 5;
    const tiltCompensation = imu_pitch * 5;

    pan += (errorX + panCompensation) * 0.1;
    tilt += (errorY + tiltCompensation) * 0.1;
    
    const signalStrength = isEmergency ? -90 : -50 - Math.round(Math.random() * 40);

    const status = isEmergency ? 'SHUTDOWN' : (Math.abs(errorX) < 15 && Math.abs(errorY) < 15 ? 'LOCKED' : 'TRACKING');

    const data = {
      timestamp: new Date().toISOString(),
      primaryTargetId: primary.id,
      targets: drones.map(d => ({
        id: d.id,
        x: Math.round(d.x),
        y: Math.round(d.y),
        confidence: Math.round(d.conf * 100) / 100,
        battery: Math.round(d.bat),
        model: d.model,
        isHighPriority: d.isHighPriority,
        flightMode: isEmergency ? 'Shutdown' : (commandedMode || 'Evasive'),
        gps: {
          lat: 37.7749 + (d.y * 0.00005),
          lng: -122.4194 + (d.x * 0.00005)
        }
      })),
      tracking: {
        targetX: Math.round(primary.x),
        targetY: Math.round(primary.y),
        panAngle: Math.round(pan * 100) / 100,
        tiltAngle: Math.round(tilt * 100) / 100,
        errorX: Math.round(errorX),
        errorY: Math.round(errorY),
        status: trackingActive ? status : 'IDLE',
        neutralization: simulatedNeutralization ? 'POSITIVE' : 'NONE'
      },
      environment: {
        temperature: Math.round(env_temperature * 10) / 10,
        humidity: Math.round(env_humidity),
        pressure: Math.round(pressure),
        altitude: isEmergency ? 0 : Math.round((1013.25 - pressure) * 8.43),
        fogRisk: fogRiskHigh ? 'HIGH' : 'LOW',
        thermal: thermalActive ? 'ACTIVE' : 'INACTIVE',
        altitudeMode: highAltitudeMode ? 'HIGH-ALTITUDE MODE' : 'NORMAL MODE'
      },
      motion: {
        accelX: isEmergency ? 0 : (Math.random() - 0.5) * 0.1,
        accelY: isEmergency ? 0 : (Math.random() - 0.5) * 0.1,
        accelZ: isEmergency ? 0 : 9.81 + (Math.random() - 0.5) * 0.2,
        gyroX: isEmergency ? 0 : Math.round(imu_roll * 10) / 10,
        gyroY: isEmergency ? 0 : Math.round(imu_pitch * 10) / 10,
        gyroZ: isEmergency ? 0 : (Math.random() - 0.5) * 2,
        windSpeed: Math.round(env_windSpeed),
        disturbance: env_windSpeed > 30 ? 'HIGH' : (env_windSpeed > 15 ? 'MEDIUM' : 'LOW')
      },
      system: {
        cameraStatus: 'POSITIVE',
        sensorStatus: 'POSITIVE',
        esp32Status: 'POSITIVE',
        fps: isEmergency ? 0 : 25 + Math.round(Math.random() * 5),
        confidence: Math.round(primary.conf * 100) / 100,
        responseTimeMs: isEmergency ? 0 : 30 + Math.round(Math.random() * 20),
        signalStrength: signalStrength
      },
      droneDetails: {
        model: primary.model,
        battery: Math.round(primary.bat),
        flightMode: isEmergency ? 'Shutdown' : (commandedMode || (status === 'LOCKED' ? 'Evasive' : 'Hover')),
        gps: {
          lat: 37.7749 + (primary.y * 0.00005),
          lng: -122.4194 + (primary.x * 0.00005)
        }
      }
    };

    io.emit('telemetry', data);
  }, 100); // 10Hz updates for smooth UI

  // API routes
  app.use(express.json({ limit: '10mb' }));

  // Gemini Vision AI: Drone detection and classification from camera frame
  app.post("/api/analyze-frame", async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({ detected: false, droneType: null, reason: 'No API key' });
    }
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing imageBase64' });
    }
    try {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageBase64,
                },
              },
              {
                text: `You are an anti-drone detection system AI for a prototype demonstration. Analyze this camera frame carefully.

DETECT: Is there a drone (UAV/UAS) visible in this image? This includes:
- Real flying drones (quadcopters, hexacopters, octocopters, fixed-wing, VTOL, nano, military UAV, FPV, delivery, surveillance)
- Printed photos, posters, books, or screens SHOWING a drone image
- Drone models, toys, or prototypes
- Any unmanned aerial vehicle shape, even partially visible

If a drone or drone image is detected:
1. Classify the drone type
2. Estimate the bounding box as normalized coordinates (0.0 to 1.0 relative to image width/height)
   - x1,y1 = top-left corner
   - x2,y2 = bottom-right corner

Respond ONLY with valid JSON in this EXACT format (no markdown, no extra text):
{"detected": true, "droneType": "NANO DRONE", "confidence": 0.91, "bbox": {"x1": 0.35, "y1": 0.05, "x2": 0.85, "y2": 0.50}}
or if no drone:
{"detected": false, "droneType": null, "confidence": 0.05, "bbox": null}

Drone type must be one of: QUADCOPTER DRONE, HEXACOPTER DRONE, FIXED-WING DRONE, VTOL DRONE, FPV RACING DRONE, NANO DRONE, MILITARY UAV, DELIVERY DRONE, SURVEILLANCE DRONE, PAYLOAD DRONE, HYBRID DRONE, MULTI-ROTOR DRONE, UNKNOWN DRONE`
              }
            ]
          }
        ]
      });
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      // Extract JSON from response
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return res.json(parsed);
      }
      return res.json({ detected: false, droneType: null });
    } catch (err: any) {
      console.error('Gemini Vision error:', err?.message || err);
      return res.json({ detected: false, droneType: null, error: err?.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
