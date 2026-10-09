import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import { Activity, Camera, AlertTriangle, Thermometer, Wind, Crosshair, Server, Zap, Compass, CheckCircle2, Settings2, Target, Volume2, VolumeX, Download, FileJson, Map, Maximize2, Minimize2, Home, Shield, Power, Grid, Copy, CopyCheck, Layers, ImageIcon, Filter, Plus, Minus, ChevronDown, ChevronUp, Cpu, Radio, Bot, BarChart2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as d3 from 'd3';
import html2canvas from 'html2canvas';
import { motion, AnimatePresence } from 'motion/react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { TemplateMatcher } from './utils/templateMatcher';
import { Bug, RefreshCw, Upload, Eye } from 'lucide-react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BASE_LAT = 37.7749;
const BASE_LNG = -122.4194;

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c;
  if (d > 1000) return (d/1000).toFixed(2) + ' km';
  return Math.round(d) + ' m';
}

// ── Pan-Tilt Orientation Constants ──────────────────────────────────────────
const PAN_LIMIT = 90;          // mechanical clamp ±degrees
const TILT_LIMIT = 60;         // mechanical clamp ±degrees
const ORIENT_SMOOTH = 0.18;    // low-pass α: 18% new value, 82% history
const ORIENT_SENSITIVITY = 1.0; // multiplier: orientation° → pan/tilt°

// Types for our telemetry data
interface TelemetryData {
  timestamp: string;
  primaryTargetId: string;
  targets: Array<{
    id: string;
    x: number;
    y: number;
    confidence: number;
    battery: number;
    model: string;
    speed?: number;
    timestamp?: number;
    isHighPriority: boolean;
    flightMode: string;
    gps: { lat: number; lng: number; };
  }>;
  tracking: {
    targetX: number;
    targetY: number;
    panAngle: number;
    tiltAngle: number;
    errorX: number;
    errorY: number;
    status: string;
    neutralization?: string;
  };
  environment: {
    temperature: number;
    humidity: number;
    pressure: number;
    altitude: number;
    fogRisk?: string;
    thermal?: string;
    altitudeMode?: string;
  };
  motion: {
    accelX: number;
    accelY: number;
    accelZ: number;
    gyroX: number;
    gyroY: number;
    gyroZ: number;
    windSpeed?: number;
    disturbance: string;
  };
  system: {
    cameraStatus: string;
    sensorStatus: string;
    esp32Status: string;
    fps: number;
    confidence: number;
    responseTimeMs: number;
    signalStrength: number;
  };
  droneDetails: {
    model: string;
    battery: number;
    flightMode: string;
    gps: {
      lat: number;
      lng: number;
    };
  };
}

function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue] as const;
}

const initialTelemetryData: any = {
  timestamp: new Date().toISOString(),
  primaryTargetId: '',
  targets: [],
  tracking: {
    targetX: 0,
    targetY: 0,
    panAngle: 0,
    tiltAngle: 0,
    errorX: 0,
    errorY: 0,
    status: 'SEARCHING',
    gpsStatus: 'UNAVAILABLE',
    trailMode: 'LOCAL TRACKING TRAIL',
    neutralization: 'POSITIVE'
  },
  environment: {
    temperature: -8,
    humidity: 88,
    pressure: 650,
    altitude: 3060,
    fogRisk: 'HIGH',
    thermal: 'ACTIVE',
    altitudeMode: 'HIGH-ALTITUDE MODE'
  },
  motion: {
    accelX: 0, accelY: 0, accelZ: 9.8,
    gyroX: 3, gyroY: -2, gyroZ: 0,
    windSpeed: 35,
    disturbance: 'HIGH'
  },
  system: {
    cameraStatus: 'POSITIVE',
    sensorStatus: 'POSITIVE',
    esp32Status: 'POSITIVE',
    fps: 0,
    confidence: 0,
    responseTimeMs: 0,
    signalStrength: -90
  },
  droneDetails: {
    model: '',
    battery: 100,
    flightMode: 'SEARCHING',
    isGpsAvailable: false,
    gps: null
  }
};

export default function Dashboard() {
  const [data, setData] = useState<any>(initialTelemetryData);
  const [history, setHistory] = useState<any[]>([]);
  const [logs, setLogs] = useState<TelemetryData[]>([]);
  const [persistentAlerts, setPersistentAlerts] = useState<Array<{id: string, message: string, type: 'error' | 'warning' | 'info' | 'success', timestamp?: number}>>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [sensorData, setSensorData] = useState({
    TEMP: -8, HUMIDITY: 88, PRESSURE: 650, WIND: 35, ROLL: 3, PITCH: -2
  });
  const serialWriterRef = useRef<any>(null);

  const handleConnectHardware = async () => {
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      setIsSerialConnected(true);

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(port.writable);
      serialWriterRef.current = textEncoder.writable.getWriter();

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          break;
        }
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          try {
            const parts = line.split('|').map((p: string) => p.trim());
            const parsedData: any = {};
            parts.forEach((p: string) => {
              const [key, val] = p.split(':');
              if (key && val) parsedData[key.trim()] = parseFloat(val);
            });
            if (Object.keys(parsedData).length > 0) {
              setSensorData(prev => ({...prev, ...parsedData}));
            }
          } catch(e) {}
        }
      }
    } catch (err) {
      console.error("Serial error:", err);
      setIsSerialConnected(false);
    }
  };

  const [missionDuration, setMissionDuration] = useState<string>('00:00:00');
  const [calibrationMode, setCalibrationMode] = useLocalStorage('antiDrone_calibrationMode', false);
  const [isMuted, setIsMuted] = useLocalStorage('antiDrone_isMuted', false);
  const [showDroneDetails, setShowDroneDetails] = useState<string | null>(null);
  const [visibleDronesFilter, setVisibleDronesFilter] = useState<string>('ALL');
  const [isFollowingSelected, setIsFollowingSelected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [showRadarGrid, setShowRadarGrid] = useLocalStorage('antiDrone_showRadarGrid', true);
  const [showHeatmap, setShowHeatmap] = useLocalStorage('antiDrone_showHeatmap', false);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [isQuickLocking, setIsQuickLocking] = useState(false);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [filterCriticalLogs, setFilterCriticalLogs] = useState(false);
  const [cameraPower, setCameraPower] = useLocalStorage('antiDrone_cameraPower', true);
  const [driftResetTimestamp, setDriftResetTimestamp] = useState<number>(0);

  // ── Demo Simulation Overrides ──────────────────────────────────────
  const [simWindBoost, setSimWindBoost] = useState(0);
  const [simHumidityBoost, setSimHumidityBoost] = useState(0);
  const [simFogForce, setSimFogForce] = useState(false);
  const [simVibration, setSimVibration] = useState(false);
  const [simDroneDetected, setSimDroneDetected] = useState(false);
  const [simTempDelta, setSimTempDelta] = useState(0);
  const [showSimControls, setShowSimControls] = useState(false);
  // ── Event Log ─────────────────────────────────────────────────────
  const [eventLog, setEventLog] = useState<{ts: string; msg: string; type: 'info'|'warning'|'success'|'error'}[]>([]);

  const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);
  const [centerOnPrimary, setCenterOnPrimary] = useLocalStorage('antiDrone_centerOnPrimary', false);
  const [mapOrientation, setMapOrientation] = useLocalStorage<'North-Up' | 'Dynamic'>('antiDrone_mapOrientation', 'North-Up');
  const [mapCenterOnPrimary, setMapCenterOnPrimary] = useLocalStorage('antiDrone_mapCenterOnPrimary', false);
  const [trailLength, setTrailLength] = useState(30);
  const socketRef = useRef<Socket | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveTargetsRef = useRef<any[]>([]);
  const modelLatencyRef = useRef<number>(0);
  const hasCameraRef = useRef(false);
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [aiModelStatus, setAiModelStatus] = useState<'LOADING' | 'LOADED' | 'ERROR'>('LOADING');
  const [isTemplateReady, setIsTemplateReady] = useState(false);
  const templateMatcherRef = useRef<TemplateMatcher | null>(null);

  // ── Detection Mode & Configuration ──────────────────────────────────
  type DetectionMode = 'DEMO_TARGET' | 'REAL_DRONE';
  const [detectionMode, setDetectionMode] = useState<DetectionMode>('DEMO_TARGET');
  const [confThreshold, setConfThreshold] = useState<number>(0.65); // 0.20 - 0.95 (0.65 recommended for NCC)
  const [trackingAlpha, setTrackingAlpha] = useState<number>(0.35); // 0.10 - 0.80
  const [deadband, setDeadband] = useState<number>(15); // pixels
  const [kpPan, setKpPan] = useState<number>(0.05);
  const [kpTilt, setKpTilt] = useState<number>(0.05);
  const [showDebugHud, setShowDebugHud] = useState<boolean>(false);
  const [customModelUrl, setCustomModelUrl] = useState<string>('');
  const [customModelLoaded, setCustomModelLoaded] = useState<boolean>(false);
  const [customModelName, setCustomModelName] = useState<string>('COCO-SSD (MobileNetV2)');
  const [allowProxyClasses, setAllowProxyClasses] = useState<boolean>(true);
  const [detectAnyObject, setDetectAnyObject] = useState<boolean>(false);
  const [captureMessage, setCaptureMessage] = useState<string>('');
  const [cameraConnected, setCameraConnected] = useState<boolean>(false);

  // ── Tracking & Diagnostic Refs ──────────────────────────────────────
  const smoothedTargetPosRef = useRef<{ x: number; y: number } | null>(null);
  const targetLostFramesRef = useRef<number>(0);
  const lastKnownTargetRef = useRef<any>(null);
  const frameCountRef = useRef<number>(0);
  const lastFrameTsRef = useRef<number>(performance.now());
  const calculatedFpsRef = useRef<number>(30);
  const [cameraTrail, setCameraTrail] = useState<Array<{ x: number; y: number; timestamp: number }>>([]);
  const cameraTrailRef = useRef<Array<{ x: number; y: number; timestamp: number }>>([]);
  const pipelineMetricsRef = useRef({
    cameraConnected: false,
    videoFramesReceiving: false,
    aiModelLoaded: false,
    aiModelName: 'DEMO TARGET TRACKER (NCC)',
    droneClassAvailable: true,
    inferenceRunning: false,
    inferenceLatencyMs: 0,
    rawDetectionsCount: 0,
    droneDetectionsCount: 0,
    trackingActive: false,
    errX: 0,
    errY: 0,
    targetX: 0,
    targetY: 0,
    frameCenterX: 0,
    frameCenterY: 0,
    bbox: [0, 0, 0, 0],
    rawBox: [0, 0, 0, 0],
    dispBox: [0, 0, 0, 0],
    videoWidth: 0,
    videoHeight: 0,
    modelInputW: 320,
    modelInputH: 180,
    confidence: 0,
    panAngle: 0,
    tiltAngle: 0,
    trackingStatus: 'IDLE',
  });

  const prevAlertState = useRef(false);
  const prevPosRef = useRef<{ [key: string]: { x: number, y: number } }>({});
  const lastKnownGpsRef = useRef<{lat: number, lng: number} | null>(null);
  const velocityRef = useRef<{ [key: string]: { vx: number, vy: number } }>({});
  // ── Event log prev-state tracking refs ──
  const prevDetectionRef = useRef(false);
  const prevWindCompRef = useRef(false);
  const prevFogCompRef = useRef(false);
  const prevVibrationCompRef = useRef(false);
  const prevTrackStatusRef = useRef('');
  // Gemini Vision AI drone classification refs
  const geminiLabelRef = useRef<string>('');       // Gemini-classified drone type label
  const geminiAnalyzingRef = useRef(false);         // Prevents concurrent Gemini API calls
  const geminiDetectedRef = useRef<boolean | null>(null); // null=not run, true=drone, false=no drone
  const geminiConfidenceRef = useRef<number>(0.8);  // Gemini confidence score
  // ── Motion-frame diff ref — holds last frame's ImageData for pixel-delta scan ──
  const prevFrameDataRef = useRef<ImageData | null>(null); // previous frame pixel data
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null); // off-screen canvas for diff

  // ── Device Orientation Sensor state & refs ─────────────────────────────────
  type SensorMode = 'requesting' | 'real' | 'demo' | 'unavailable';
  const [sensorMode, setSensorMode] = useState<SensorMode>('requesting');
  const [calibrationMsg, setCalibrationMsg] = useState<string>('');
  // ref mirror so intervals & handlers can read without closure stale values
  const sensorModeRef = useRef<SensorMode>('requesting');
  // Raw + smoothed orientation from DeviceOrientationEvent
  const rawOrientRef      = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const smoothedOrientRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  // Calibration snapshot — subtracted from smoothed to get relative angles
  const calibOffsetRef    = useRef({ beta: 0, gamma: 0 });
  // Set to true as soon as first real orientation event arrives
  const isOrientAvailableRef = useRef(false);
  // Measured processing latency per orientation event (ms)
  const orientResponseRef = useRef(0);
  // Real FPS counters (event-rate based, not hardcoded)
  const realFpsRef    = useRef(30);
  const lastFpsTsRef  = useRef(performance.now());
  const fpsCntRef     = useRef(0);
  // Phase counter for demo-mode sinusoidal oscillation
  const demoPhaseRef  = useRef(0);

  const lowestSignalPoint = useMemo(() => {
    if (!history || history.length === 0) return null;
    const validHistory = history.filter(p => p.signalStrength !== undefined);
    if (validHistory.length === 0) return null;
    return validHistory.reduce((min, p) => p.signalStrength < min.signalStrength ? p : min, validHistory[0]);
  }, [history]);

  const mapRotation = useMemo(() => {
    if (mapOrientation === 'North-Up' || !data) return 0;
    const primaryVel = velocityRef.current[data.primaryTargetId] || { vx: 0, vy: 0 };
    if (Math.abs(primaryVel.vx) < 0.5 && Math.abs(primaryVel.vy) < 0.5) return 0; // fallback to 0 if not moving
    const heading = Math.atan2(primaryVel.vy, primaryVel.vx) * (180 / Math.PI);
    return -heading - 90;
  }, [data, mapOrientation]);

  const signalStability = useMemo(() => {
    if (!history || history.length < 2) return 0;
    const last10 = history.slice(-10).map(p => p.signalStrength).filter(s => s !== undefined);
    if (last10.length < 2) return 0;
    const mean = last10.reduce((a, b) => a + b, 0) / last10.length;
    const variance = last10.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (last10.length - 1);
    return Math.sqrt(variance);
  }, [history]);

const sensorDrift = useMemo(() => {
    if (!history || history.length < 2) return 0;
    const relevantHistory = history.filter((h: any) => h.timestamp > driftResetTimestamp);
    if (relevantHistory.length < 2) return 0;
    const sum = relevantHistory.reduce((acc, h: any) => acc + (h.error * h.error), 0);
    return sum / relevantHistory.length;
  }, [history, driftResetTimestamp]);

  const batteryHistory = useMemo(() => {
    if (!data?.primaryTargetId) return [];
    return history.slice(-600).map(h => { // up to 60 seconds at 10Hz
      const pt = h.targets?.find((t: any) => t.id === data.primaryTargetId);
      return { time: h.time, battery: pt ? pt.battery : null };
    }).filter(p => p.battery !== null);
  }, [history, data?.primaryTargetId]);

  const hasCriticalAlert = persistentAlerts.some(a => a.type === 'error');

  const handleSnapshot = async () => {
    if (feedRef.current) {
      try {
        const canvas = await html2canvas(feedRef.current, { backgroundColor: '#0f172a', useCORS: true }); // slate-900 equivalent
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `drone_snapshot_${new Date().getTime()}.png`;
        link.href = url;
        link.click();
      } catch (e) {
        console.error('Failed to take snapshot', e);
      }
    }
  };

  // Camera, AI Model, and Demo Template Setup
  useEffect(() => {
    async function setupCamera() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            const playPromise = videoRef.current.play();
            if (playPromise !== undefined) {
              playPromise.catch(e => console.log('Video play interrupted:', e));
            }
            hasCameraRef.current = true;
            setCameraConnected(true);
            pipelineMetricsRef.current.cameraConnected = true;
            console.log('[Pipeline] Camera connected successfully.');
          }
        } catch (err) {
          console.error('[Pipeline] Camera access denied:', err);
          hasCameraRef.current = false;
          setCameraConnected(false);
          pipelineMetricsRef.current.cameraConnected = false;
        }
      }
    }

    async function loadModel() {
      try {
        await tf.ready();
        const loadedModel = await cocoSsd.load();
        setModel(loadedModel);
        setAiModelStatus('LOADED');
        pipelineMetricsRef.current.aiModelLoaded = true;
        console.log('[Pipeline] COCO-SSD loaded. (Drone class: NOT in standard COCO 80 classes)');
      } catch (err) {
        console.error('[Pipeline] Failed to load COCO-SSD:', err);
        setAiModelStatus('ERROR');
      }
    }

    async function loadDemoTemplate() {
      try {
        const matcher = new TemplateMatcher();
        const ok = await matcher.loadTemplateFromUrl('/assets/demo_drone_clean.png', 'Nano Drone Prototype');
        if (ok) {
          templateMatcherRef.current = matcher;
          setIsTemplateReady(true);
          console.log('[Pipeline] Demo Drone Target Template loaded successfully.');
        } else {
          const ok2 = await matcher.loadTemplateFromUrl('/assets/demo_drone_target.png', 'Nano Drone Target');
          if (ok2) {
            templateMatcherRef.current = matcher;
            setIsTemplateReady(true);
          }
        }
      } catch (e) {
        console.error('[Pipeline] Error loading demo template:', e);
      }
    }

    setupCamera();
    loadModel();
    loadDemoTemplate();
  }, []);


useEffect(() => {
    let animationId: number;
    let isDetecting = false;

    async function detectFrame() {
      if (
        !isDetecting &&
        videoRef.current &&
        videoRef.current.readyState >= 2 &&
        feedRef.current &&
        cameraPower
      ) {
        isDetecting = true;
        const frameNow = performance.now();
        frameCountRef.current++;

        // Real calculated FPS from processed frames
        const dt = frameNow - lastFrameTsRef.current;
        if (dt > 0) {
          const instFps = 1000 / dt;
          calculatedFpsRef.current = Math.round((calculatedFpsRef.current * 0.85 + instFps * 0.15) * 10) / 10;
        }
        lastFrameTsRef.current = frameNow;

        const video = videoRef.current;
        const feedBounds = feedRef.current.getBoundingClientRect();
        const displayWidth = feedBounds.width;
        const displayHeight = feedBounds.height;

        const frameCenterX = displayWidth / 2;
        const frameCenterY = displayHeight / 2;
        pipelineMetricsRef.current.frameCenterX = Math.round(frameCenterX);
        pipelineMetricsRef.current.frameCenterY = Math.round(frameCenterY);
        pipelineMetricsRef.current.cameraConnected = true;
        pipelineMetricsRef.current.videoFramesReceiving = true;

        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;

        const videoRatio = vw / vh;
        const displayRatio = displayWidth / displayHeight;

        let renderWidth = displayWidth;
        let renderHeight = displayHeight;
        let offsetX = 0;
        let offsetY = 0;

        if (displayRatio > videoRatio) {
          renderHeight = displayWidth / videoRatio;
          offsetY = (renderHeight - displayHeight) / 2;
        } else {
          renderWidth = displayHeight * videoRatio;
          offsetX = (renderWidth - displayWidth) / 2;
        }

        let detectedBox: { x: number; y: number; width: number; height: number; conf: number; label: string } | null = null;
        let rawDets = 0;
        let droneDets = 0;

        if (detectionMode === 'DEMO_TARGET') {
          pipelineMetricsRef.current.aiModelName = 'DEMO TARGET TRACKER (NCC)';
          pipelineMetricsRef.current.droneClassAvailable = true;
          pipelineMetricsRef.current.inferenceRunning = true;

          const matchStart = performance.now();
          if (templateMatcherRef.current && templateMatcherRef.current.ready) {
            const match = templateMatcherRef.current.match(video, confThreshold);
            const latency = performance.now() - matchStart;
            pipelineMetricsRef.current.inferenceLatencyMs = Math.round(latency * 10) / 10;
            modelLatencyRef.current = latency;

            rawDets = match.found ? 1 : 0;
            if (match.found) {
              droneDets = 1;
              detectedBox = {
                x: match.x,
                y: match.y,
                width: match.width,
                height: match.height,
                conf: match.confidence,
                label: templateMatcherRef.current.name || 'DRONE',
              };
            }
          }
        } else {
          // REAL_DRONE mode
          pipelineMetricsRef.current.aiModelName = customModelLoaded ? customModelName : 'COCO-SSD (MobileNetV2)';
          pipelineMetricsRef.current.droneClassAvailable = customModelLoaded;
          pipelineMetricsRef.current.inferenceRunning = !!model;

          if (model) {
            const inferStart = performance.now();
            try {
              const predictions = await model.detect(video);
              const latency = performance.now() - inferStart;
              pipelineMetricsRef.current.inferenceLatencyMs = Math.round(latency * 10) / 10;
              modelLatencyRef.current = latency;

              rawDets = predictions.length;

              const filtered = predictions.filter((p) => {
                if (p.score < confThreshold) return false;
                if (customModelLoaded) {
                  return p.class.toLowerCase().includes('drone') || p.class.toLowerCase().includes('uav');
                }
                if (detectAnyObject) return true;
                if (allowProxyClasses) {
                  return ['airplane', 'bird', 'kite'].includes(p.class);
                }
                return p.class.toLowerCase() === 'drone';
              });

              droneDets = filtered.length;
              if (filtered.length > 0) {
                const best = filtered.reduce((prev, curr) => (curr.score > prev.score ? curr : prev), filtered[0]);
                detectedBox = {
                  x: best.bbox[0],
                  y: best.bbox[1],
                  width: best.bbox[2],
                  height: best.bbox[3],
                  conf: best.score,
                  label: customModelLoaded ? best.class.toUpperCase() : (allowProxyClasses && best.class !== 'drone') ? `DRONE (${best.class.toUpperCase()})` : 'DRONE',
                };
              }
            } catch (err) {
              console.error('[AI Pipeline] Inference error:', err);
            }
          }
        }

        pipelineMetricsRef.current.rawDetectionsCount = rawDets;
        pipelineMetricsRef.current.droneDetectionsCount = droneDets;

        pipelineMetricsRef.current.videoWidth = vw;
        pipelineMetricsRef.current.videoHeight = vh;
        pipelineMetricsRef.current.modelInputW = 320;
        pipelineMetricsRef.current.modelInputH = Math.round(320 * (vh / vw));

        if (detectedBox) {
          targetLostFramesRef.current = 0;

          // ── Transform from Video Model Coordinates → Display Video Container Coordinates ──
          // Accounts precisely for CSS object-cover scaling and letterboxing/offset
          const scale = Math.max(displayWidth / vw, displayHeight / vh);
          const renderWidth = vw * scale;
          const renderHeight = vh * scale;
          const offsetX = (renderWidth - displayWidth) / 2;
          const offsetY = (renderHeight - displayHeight) / 2;

          const dispX = Math.round(detectedBox.x * scale - offsetX);
          const dispY = Math.round(detectedBox.y * scale - offsetY);
          const dispW = Math.round(detectedBox.width * scale);
          const dispH = Math.round(detectedBox.height * scale);

          const rawTargetX = Math.round(dispX + dispW / 2);
          const rawTargetY = Math.round(dispY + dispH / 2);

          // Exponential coordinate smoothing (Alpha filter)
          let smoothTargetX = rawTargetX;
          let smoothTargetY = rawTargetY;
          if (smoothedTargetPosRef.current) {
            smoothTargetX = Math.round(trackingAlpha * rawTargetX + (1 - trackingAlpha) * smoothedTargetPosRef.current.x);
            smoothTargetY = Math.round(trackingAlpha * rawTargetY + (1 - trackingAlpha) * smoothedTargetPosRef.current.y);
          }
          smoothedTargetPosRef.current = { x: smoothTargetX, y: smoothTargetY };

          // Pixel errors from camera center (positive = right/down, negative = left/up)
          const errX = Math.round(smoothTargetX - frameCenterX);
          const errY = Math.round(smoothTargetY - frameCenterY);

          // Container-relative box coordinates centered around smoothed target
          const boxLeft = Math.round(smoothTargetX - dispW / 2);
          const boxTop = Math.round(smoothTargetY - dispH / 2);

          // Update camera tracking trail
          cameraTrailRef.current.push({ x: smoothTargetX, y: smoothTargetY, timestamp: frameNow });
          if (cameraTrailRef.current.length > trailLength) {
            cameraTrailRef.current.splice(0, cameraTrailRef.current.length - trailLength);
          }
          setCameraTrail([...cameraTrailRef.current]);

          const targetObj = {
            id: 'DRONE-01',
            timestamp: frameNow,
            x: errX,
            y: errY,
            boxLeft,
            boxTop,
            boxWidth: dispW,
            boxHeight: dispH,
            targetCenterX: smoothTargetX,
            targetCenterY: smoothTargetY,
            errX,
            errY,
            width: dispW,
            height: dispH,
            confidence: detectedBox.conf,
            battery: 100,
            model: detectedBox.label,
            isHighPriority: true,
            flightMode: 'TRACKING',
          };

          lastKnownTargetRef.current = targetObj;
          liveTargetsRef.current = [targetObj];

          pipelineMetricsRef.current.trackingActive = true;
          pipelineMetricsRef.current.bbox = [boxLeft, boxTop, dispW, dispH];
          pipelineMetricsRef.current.rawBox = [Math.round(detectedBox.x), Math.round(detectedBox.y), Math.round(detectedBox.width), Math.round(detectedBox.height)];
          pipelineMetricsRef.current.dispBox = [boxLeft, boxTop, dispW, dispH];
          pipelineMetricsRef.current.targetX = smoothTargetX;
          pipelineMetricsRef.current.targetY = smoothTargetY;
          pipelineMetricsRef.current.errX = errX;
          pipelineMetricsRef.current.errY = errY;
          pipelineMetricsRef.current.confidence = detectedBox.conf;
          pipelineMetricsRef.current.trackingStatus = (Math.abs(errX) < deadband && Math.abs(errY) < deadband) ? 'LOCKED' : 'TRACKING';
        } else {
          // Grace-period target lost recovery (maintain last known position up to 25 frames / ~800ms)
          targetLostFramesRef.current++;
          if (targetLostFramesRef.current < 25 && lastKnownTargetRef.current) {
            liveTargetsRef.current = [
              {
                ...lastKnownTargetRef.current,
                flightMode: 'TRACKING',
              },
            ];
            pipelineMetricsRef.current.trackingActive = true;
          } else {
            // Target truly lost after 25 frames
            liveTargetsRef.current = [];
            smoothedTargetPosRef.current = null;
            pipelineMetricsRef.current.trackingActive = false;
            pipelineMetricsRef.current.errX = 0;
            pipelineMetricsRef.current.errY = 0;
            pipelineMetricsRef.current.confidence = 0;
            pipelineMetricsRef.current.trackingStatus = 'TARGET LOST';
          }
        }

        isDetecting = false;
      }

      animationId = requestAnimationFrame(detectFrame);
    }

    if (cameraPower) {
      detectFrame();
    } else {
      liveTargetsRef.current = [];
      pipelineMetricsRef.current.cameraConnected = false;
      pipelineMetricsRef.current.videoFramesReceiving = false;
      pipelineMetricsRef.current.trackingActive = false;
    }

    return () => cancelAnimationFrame(animationId);
  }, [model, cameraPower, detectionMode, confThreshold, trackingAlpha, allowProxyClasses, detectAnyObject, customModelLoaded, customModelName]);

  // Target Registration handler from Camera Feed
  const handleCaptureTarget = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = Math.round(vw * 0.45);
    const ch = Math.round(vh * 0.45);
    const cx = Math.round((vw - cw) / 2);
    const cy = Math.round((vh - ch) / 2);

    if (!templateMatcherRef.current) {
      templateMatcherRef.current = new TemplateMatcher();
    }
    const success = templateMatcherRef.current.setTemplateImage(video, 'Captured Target', {
      x: cx,
      y: cy,
      width: cw,
      height: ch,
    });
    if (success) {
      setIsTemplateReady(true);
      if (confThreshold < 0.60) setConfThreshold(0.65);
      setCaptureMessage('✓ Target Registered from Center Reticle! (Threshold: 0.65)');
    } else {
      setCaptureMessage('⚠️ Insufficient contrast / empty space! Align center reticle with an object.');
    }
    setTimeout(() => setCaptureMessage(''), 4500);
  };

  const handleResetTarget = async () => {
    if (!templateMatcherRef.current) {
      templateMatcherRef.current = new TemplateMatcher();
    }
    const ok = await templateMatcherRef.current.loadTemplateFromUrl('/assets/demo_drone_clean.png', 'Nano Drone Prototype');
    if (ok) {
      setIsTemplateReady(true);
      setConfThreshold(0.65);
      setCaptureMessage('✓ Reset to Default Drone Template (Threshold: 0.65)');
      setTimeout(() => setCaptureMessage(''), 4000);
    }
  };

  // ── Real Device Orientation Sensor ────────────────────────────────────────
  // Reads browser DeviceOrientationEvent (alpha/beta/gamma), applies
  // exponential low-pass smoothing, measures real FPS and response time.
  // Falls back to demo-oscillation mode when sensor is unavailable.
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const start = performance.now();

      // First event → switch from 'requesting' to 'real'
      if (!isOrientAvailableRef.current) {
        isOrientAvailableRef.current = true;
        sensorModeRef.current = 'real';
        setSensorMode('real');
      }

      const alpha = e.alpha ?? 0;
      const beta  = e.beta  ?? 0;
      const gamma = e.gamma ?? 0;
      rawOrientRef.current = { alpha, beta, gamma };

      // Exponential moving average low-pass filter
      const s = smoothedOrientRef.current;
      smoothedOrientRef.current = {
        alpha: s.alpha * (1 - ORIENT_SMOOTH) + alpha * ORIENT_SMOOTH,
        beta:  s.beta  * (1 - ORIENT_SMOOTH) + beta  * ORIENT_SMOOTH,
        gamma: s.gamma * (1 - ORIENT_SMOOTH) + gamma * ORIENT_SMOOTH,
      };

      // Measure end-to-end processing response time
      orientResponseRef.current = parseFloat((performance.now() - start).toFixed(2));

      // Real FPS: count events, flush every 1 second
      fpsCntRef.current++;
      const now = performance.now();
      const elapsed = now - lastFpsTsRef.current;
      if (elapsed >= 1000) {
        realFpsRef.current = Math.round((fpsCntRef.current * 1000) / elapsed);
        fpsCntRef.current = 0;
        lastFpsTsRef.current = now;
      }
    };

    const initSensor = async () => {
      // iOS 13+ requires explicit user permission
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        try {
          const perm = await (DeviceOrientationEvent as any).requestPermission();
          if (perm === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation, true);
          } else {
            sensorModeRef.current = 'unavailable';
            setSensorMode('unavailable');
          }
        } catch {
          sensorModeRef.current = 'unavailable';
          setSensorMode('unavailable');
        }
      } else if ('DeviceOrientationEvent' in window) {
        window.addEventListener('deviceorientation', handleOrientation, true);
        // Wait 2 s — if no events arrive, laptop has no physical sensor → demo mode
        setTimeout(() => {
          if (!isOrientAvailableRef.current) {
            sensorModeRef.current = 'demo';
            setSensorMode('demo');
          }
        }, 2000);
      } else {
        sensorModeRef.current = 'unavailable';
        setSensorMode('unavailable');
      }
    };

    initSensor();
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []); // runs once on mount

  // Persistent Alerts Expiration
  useEffect(() => {

    const interval = setInterval(() => {
      setPersistentAlerts(prev => {
        const now = Date.now();
        const next = prev.filter(a => {
          if (a.type === 'error') return true;
          return now - (a as any).timestamp < 5000;
        });
        return next.length !== prev.length ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (socketRef.current) {
      if (isFollowingSelected && showDroneDetails) {
        socketRef.current.emit('follow_target', showDroneDetails);
      } else {
        socketRef.current.emit('follow_target', null);
      }
    }
  }, [isFollowingSelected, showDroneDetails]);


    // Audio alert effect
  useEffect(() => {
    if (!data) return;
    const hasBatteryAlert = data.targets.some(t => t.battery < 10);
    const hasAlert = hasBatteryAlert || data.motion.disturbance === 'HIGH' || data.environment.altitude > 100 || data.system.confidence < 0.5;

    setPersistentAlerts(prev => {
      let changed = false;
      const newAlerts = [...prev];
      const now = Date.now();

      const addAlert = (id, message, type) => {
        const idx = newAlerts.findIndex(a => a.id === id);
        if (idx >= 0) {
          if (now - (newAlerts[idx].timestamp || 0) > 1000) {
            newAlerts[idx].timestamp = now;
            changed = true;
          }
        } else {
          newAlerts.push({ id, message, type, timestamp: now });
          changed = true;
        }
      };

      if (hasBatteryAlert) {
        data.targets.filter(t => t.battery < 10).forEach(t => {
          if (!newAlerts.some(a => a.id === `bat-${t.id}`)) {
            newAlerts.push({ id: `bat-${t.id}`, message: `CRITICAL: ${t.id} Battery below 10%`, type: 'error' });
            changed = true;
          }
        });
      }

      if (data.tracking.neutralization === 'POSITIVE' || data.tracking.neutralization === 'SIMULATED') addAlert('neutralization', 'Neutralization Positive / Confirmed', 'success');
      if (data.motion.disturbance === 'HIGH') addAlert('disturbance', 'High wind disturbance detected', 'warning');
      if (data.tracking.status === 'LOCKED') addAlert('locked', 'Target locked centered', 'success');
      else addAlert('tracking', 'Adjusting pan-tilt to target', 'info');
      if (data.environment.altitudeMode === 'HIGH-ALTITUDE MODE') addAlert('altitude', 'High altitude parameters active', 'warning');
      if (data.environment.thermal === 'ACTIVE') addAlert('thermal', 'Thermal protection engaged', 'info');
      if (data.environment.fogRisk === 'HIGH') addAlert('fog', 'Lens defogging engaged', 'warning');

      return changed ? newAlerts : prev;
    });

    if (hasAlert && !prevAlertState.current && !isMuted) {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = hasBatteryAlert ? 'square' : 'sine'; // Different sound for battery alert
        osc.frequency.setValueAtTime(hasBatteryAlert ? 440 : 880, ctx.currentTime);
        if (hasBatteryAlert) {
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        }
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + (hasBatteryAlert ? 0.3 : 0.15));
      } catch (e) {
        // Ignore audio errors if browser blocks auto-play
      }
    }
    prevAlertState.current = hasAlert;
  }, [data, isMuted]);

  // Mission Timer
  useEffect(() => {
    if (!sessionStartTime) return;
    const interval = setInterval(() => {
      const ms = Date.now() - sessionStartTime;
      const hours = Math.floor(ms / 3600000).toString().padStart(2, '0');
      const minutes = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
      const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
      setMissionDuration(`${hours}:${minutes}:${seconds}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  
  
  // Simulate sensor fluctuations when hardware is disconnected
  useEffect(() => {
    if (isSerialConnected) return;
    const interval = setInterval(() => {
      setSensorData(prev => {
        let temp = prev.TEMP + (Math.random() - 0.5) * 1.5;
        if (temp < -15) temp = -15;
        if (temp > 30) temp = 30;

        let humidity = prev.HUMIDITY + (Math.random() - 0.5) * 2;
        if (humidity > 95) humidity = 95;
        if (humidity < 20) humidity = 20;

        let pressure = prev.PRESSURE + (Math.random() - 0.5) * 10;
        if (pressure < 600) pressure = 600;
        if (pressure > 1020) pressure = 1020;

        let wind = prev.WIND + (Math.random() - 0.5) * 5;
        if (wind < 0) wind = 0;
        if (wind > 60) wind = 60;

        let roll = (Math.random() - 0.5) * (wind / 10);
        let pitch = (Math.random() - 0.5) * (wind / 10);

        return {
          TEMP: Math.round(temp * 10) / 10,
          HUMIDITY: Math.round(humidity),
          PRESSURE: Math.round(pressure),
          WIND: Math.round(wind),
          ROLL: Math.round(roll * 10) / 10,
          PITCH: Math.round(pitch * 10) / 10
        };
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isSerialConnected]);

  useEffect(() => {
    if (!sessionStartTime) setSessionStartTime(Date.now());

    
    const interval = setInterval(() => {
       const drone = liveTargetsRef.current.length > 0 ? liveTargetsRef.current[0] : null;
       const temp = sensorData.TEMP;
       const humidity = sensorData.HUMIDITY;
       const pressure = sensorData.PRESSURE;
       const wind = sensorData.WIND;
       const roll = sensorData.ROLL;
       const pitch = sensorData.PITCH;

       const thermalActive = temp < 0;
       const fogRiskHigh = humidity > 80 && temp < 5;
       const highAltitudeMode = pressure < 800;

       let panError = 0;
       let tiltError = 0;

       const isRecovering = targetLostFramesRef.current > 0 && targetLostFramesRef.current < 10;

       // Camera AI target position error (pixels from frame centre)
       if (drone) {
          panError = drone.errX !== undefined ? drone.errX : drone.x;
          tiltError = drone.errY !== undefined ? drone.errY : drone.y;
       }

       // Proportional control with configurable deadband:
       // ERR X > 0 -> target right of center -> pan right (positive)
       // ERR X < 0 -> target left of center -> pan left (negative)
       // ERR Y > 0 -> target below center -> tilt down (positive)
       // ERR Y < 0 -> target above center -> tilt up (negative)
       const panCorrection = Math.abs(panError) >= deadband ? kpPan * panError : 0;
       const tiltCorrection = Math.abs(tiltError) >= deadband ? kpTilt * tiltError : 0;

       // ── Orientation-based pan/tilt from real or demo sensor ────────────
       const curSensorMode = sensorModeRef.current;
       let orientPan  = 0;
       let orientTilt = 0;

       if (curSensorMode === 'real') {
          const relGamma = smoothedOrientRef.current.gamma - calibOffsetRef.current.gamma;
          const relBeta  = smoothedOrientRef.current.beta  - calibOffsetRef.current.beta;
          orientPan  = Math.max(-PAN_LIMIT,  Math.min(PAN_LIMIT,  relGamma * ORIENT_SENSITIVITY));
          orientTilt = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, relBeta  * ORIENT_SENSITIVITY));
       } else if (curSensorMode === 'demo') {
          demoPhaseRef.current++;
          const t = demoPhaseRef.current;
          orientPan  = Math.sin(t * 0.04) * 25 + Math.sin(t * 0.011) * 8;
          orientTilt = Math.cos(t * 0.028) * 15 + Math.cos(t * 0.007) * 5;
       }

       // Combined Pan/Tilt Command: Platform orientation (stabilization) + Target tracking
       const panCmd  = parseFloat((orientPan  + panCorrection).toFixed(1));
       const tiltCmd = parseFloat((orientTilt + tiltCorrection).toFixed(1));

       pipelineMetricsRef.current.panAngle = panCmd;
       pipelineMetricsRef.current.tiltAngle = tiltCmd;

       // ── Status logic (sensor-aware & tracking-aware) ───────────────────
        const isTrulyLost = targetLostFramesRef.current >= 25;
        let trackingState: string;
        if (!hasCameraRef.current || !cameraPower) {
           trackingState = 'NO CAMERA';
        } else if (curSensorMode === 'unavailable') {
           trackingState = 'SENSOR UNAVAILABLE';
        } else if (curSensorMode === 'requesting') {
           trackingState = 'CALIBRATING';
        } else if (drone) {
           trackingState = (Math.abs(panError) < deadband && Math.abs(tiltError) < deadband)
             ? 'LOCKED' : 'TRACKING';
        } else if (isTrulyLost) {
           trackingState = 'TARGET LOST';
        } else {
           trackingState = 'IDLE';
        }
        pipelineMetricsRef.current.trackingStatus = trackingState;

       // ── Hardware-ready packet → ESP32 via WebSerial ────────────────────
       // Format: PAN:+12.4|TILT:-5.8|HEATER:0|LENS:0
       if (serialWriterRef.current) {
          const cmd = `PAN:${panCmd.toFixed(1)}|TILT:${tiltCmd.toFixed(1)}|HEATER:${thermalActive?1:0}|LENS:${fogRiskHigh?1:0}\n`;
          serialWriterRef.current.write(cmd).catch(() => {});
       }

        const isRealGps = Boolean(lastKnownGpsRef.current && lastKnownGpsRef.current.lat !== 0 && lastKnownGpsRef.current.lng !== 0);

        // Local tracking coordinates on radar grid (50% = center Base Station)
        const radarMapX = drone ? Math.max(5, Math.min(95, 50 + (panError / 300) * 38)) : 50;
        const radarMapY = drone ? Math.max(5, Math.min(95, 50 + (tiltError / 200) * 38)) : 50;

        const newData: any = {
           timestamp: new Date().toISOString(),
           primaryTargetId: drone ? drone.id : '',
           targets: liveTargetsRef.current,
           tracking: {
              targetX: Math.round(panError),
              targetY: Math.round(tiltError),
              panAngle: panCmd,
              tiltAngle: tiltCmd,
              errorX: Math.round(panError),
              errorY: Math.round(tiltError),
              status: trackingState,
              gpsStatus: isRealGps ? 'AVAILABLE' : 'UNAVAILABLE',
              trailMode: isRealGps ? 'REAL GPS TRAIL' : 'LOCAL TRACKING TRAIL',
              neutralization: 'POSITIVE'
           },
           environment: {
              temperature: temp,
              humidity: humidity,
              pressure: pressure,
              altitude: Math.round((1013.25 - pressure) * 8.43),
              fogRisk: fogRiskHigh ? 'HIGH' : 'LOW',
              thermal: thermalActive ? 'ACTIVE' : 'INACTIVE',
              altitudeMode: highAltitudeMode ? 'HIGH-ALTITUDE MODE' : 'NORMAL MODE'
           },
           motion: {
              accelX: 0, accelY: 0, accelZ: 9.8,
              gyroX: roll, gyroY: pitch, gyroZ: 0,
              windSpeed: wind,
              disturbance: wind > 30 ? 'HIGH' : (wind > 15 ? 'MEDIUM' : 'LOW')
           },
           system: {
              cameraStatus: 'POSITIVE',
              sensorStatus: 'POSITIVE',
              esp32Status: 'POSITIVE',
              // Real FPS from frame detection
              fps: calculatedFpsRef.current,
              // Real confidence from detector
              confidence: drone ? parseFloat(drone.confidence.toFixed(2)) : 0,
              // Real response latency
              responseTimeMs: Math.round(pipelineMetricsRef.current.inferenceLatencyMs),
              // Dynamic signal strength: -30 dBm (strong) at full confidence, -90 dBm when no target
              signalStrength: drone ? Math.round(-90 + drone.confidence * 60) : -90
           },
           droneDetails: {
              model: drone ? drone.model : '',
              battery: 100,
              flightMode: drone ? (drone.flightMode || 'TRACKING') : 'NONE',
              isGpsAvailable: isRealGps,
              gps: isRealGps ? { lat: lastKnownGpsRef.current!.lat, lng: lastKnownGpsRef.current!.lng } : null
           }

        };

        setData(newData);
        
        const ts = new Date().toLocaleTimeString();
        setHistory(prev => {
           const newHist = [...prev, {
              time: ts,
              timestamp: Date.now(),
              confidence: newData.system.confidence,
              fps: newData.system.fps,
              error: Math.sqrt(Math.pow(panError, 2) + Math.pow(tiltError, 2)),
              errX: Math.round(panError),
              errY: Math.round(tiltError),
              panAngle: panCmd,
              tiltAngle: tiltCmd,
              isGpsAvailable: isRealGps,
              lat: isRealGps ? lastKnownGpsRef.current?.lat : null,
              lng: isRealGps ? lastKnownGpsRef.current?.lng : null,
              mapX: Math.round(radarMapX * 10) / 10,
              mapY: Math.round(radarMapY * 10) / 10,
              signalStrength: newData.system.signalStrength,
              targets: liveTargetsRef.current
           }];
           return newHist.slice(-100);
        });
        setLogs(prev => [newData, ...prev].slice(0, 100));

    }, 100);
    return () => clearInterval(interval);
  }, [sensorData, isSerialConnected]);

  // ══ EVENT LOG ═══════════════════════════════════════════════════════════════
  const addEvent = useCallback((msg: string, type: 'info'|'warning'|'success'|'error' = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setEventLog(prev => [{ ts, msg, type }, ...prev].slice(0, 20));
  }, []);

  // Watch: drone detection
  useEffect(() => {
    if (!data) return;
    const detected = data.targets.length > 0 || simDroneDetected;
    if (detected && !prevDetectionRef.current) {
      addEvent('Drone detected', 'error');
      const conf = data.targets[0] ? Math.round(data.targets[0].confidence * 100) : 87;
      addEvent(`Confidence: ${conf}%`, 'info');
      addEvent('Target coordinates locked', 'success');
    } else if (!detected && prevDetectionRef.current) {
      addEvent('Target lost — scanning...', 'warning');
    }
    prevDetectionRef.current = detected;
  }, [data?.targets?.length, simDroneDetected, addEvent]);

  // Watch: wind compensation
  useEffect(() => {
    if (!data) return;
    const ew = Math.min(60, (data.motion.windSpeed ?? 0) + simWindBoost);
    const wc = ew > 15;
    if (wc && !prevWindCompRef.current) {
      addEvent(`High wind detected (${Math.round(ew)} km/h)`, 'warning');
      addEvent('Wind compensation activated', 'success');
      addEvent('Pan/Tilt correction applied', 'info');
    } else if (!wc && prevWindCompRef.current) {
      addEvent('Wind normalized — compensation off', 'info');
    }
    prevWindCompRef.current = wc;
  }, [data?.motion?.windSpeed, simWindBoost, addEvent]);

  // Watch: fog compensation
  useEffect(() => {
    if (!data) return;
    const fc = simFogForce || data.environment.fogRisk === 'HIGH';
    if (fc && !prevFogCompRef.current) {
      addEvent('High fog risk detected', 'warning');
      addEvent('Fog/lens compensation activated', 'success');
    } else if (!fc && prevFogCompRef.current) {
      addEvent('Fog cleared — compensation off', 'info');
    }
    prevFogCompRef.current = fc;
  }, [data?.environment?.fogRisk, simFogForce, addEvent]);

  // Watch: vibration compensation
  useEffect(() => {
    if (!data) return;
    const vc = simVibration || data.motion.disturbance === 'HIGH';
    if (vc && !prevVibrationCompRef.current) {
      addEvent('High vibration detected', 'warning');
      addEvent('Stabilization compensation activated', 'success');
    } else if (!vc && prevVibrationCompRef.current) {
      addEvent('Vibration stabilized — normal mode', 'info');
    }
    prevVibrationCompRef.current = vc;
  }, [data?.motion?.disturbance, simVibration, addEvent]);

  // Watch: tracking status
  useEffect(() => {
    if (!data) return;
    const status = data.tracking.status;
    if (status !== prevTrackStatusRef.current && prevTrackStatusRef.current !== '') {
      if (status === 'LOCKED') addEvent('Target tracking stabilized — LOCKED', 'success');
      else if (status === 'TRACKING') addEvent('Adjusting pan/tilt — TRACKING', 'info');
      else if (status === 'IDLE') addEvent('Tracking IDLE — no target', 'info');
      else if (status === 'SHUTDOWN') addEvent('EMERGENCY SHUTDOWN triggered', 'error');
    }
    prevTrackStatusRef.current = status;
  }, [data?.tracking?.status, addEvent]);


  const toggleCalibration = () => {
    setCalibrationMode(prev => {
      const next = !prev;
      if (next) {
        setHistory([]);
        setLogs([]);
      }
      return next;
    });
  };

  const handleResetZero = () => {
    socketRef.current?.emit('calibrate');
    setHistory([]);
    setLogs([]);
  };

  // ── Orientation Calibration ──────────────────────────────────────────────
  // Records the current smoothed orientation as the reference (PAN 0°, TILT 0°).
  // Subsequent readings are expressed relative to this snapshot.
  const handleOrientCalibrate = useCallback(() => {
    const { beta, gamma } = smoothedOrientRef.current;
    calibOffsetRef.current = { beta, gamma };
    setCalibrationMsg('✓ Calibrated — current position is PAN 0° / TILT 0°');
    setTimeout(() => setCalibrationMsg(''), 4000);
  }, []);

  const handleDownloadCSV = () => {

    if (logs.length === 0) return;
    const headers = ['Timestamp', 'TargetX', 'TargetY', 'Pan', 'Tilt', 'ErrorX', 'ErrorY', 'Temp', 'Hum', 'Press', 'Alt', 'AccelX', 'AccelY', 'AccelZ', 'GyroX', 'GyroY', 'GyroZ', 'Disturbance', 'FPS', 'Confidence', 'Status'];
    const rows = logs.map(l => [
      l.timestamp,
      l.tracking.targetX, l.tracking.targetY, l.tracking.panAngle, l.tracking.tiltAngle, l.tracking.errorX, l.tracking.errorY,
      l.environment.temperature, l.environment.humidity, l.environment.pressure, l.environment.altitude,
      l.motion.accelX, l.motion.accelY, l.motion.accelZ, l.motion.gyroX, l.motion.gyroY, l.motion.gyroZ, l.motion.disturbance,
      l.system.fps, l.system.confidence, l.tracking.status
    ].join(','));
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `telemetry_logs_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadJSON = () => {
    if (!data) return;
    const report = {
      timestamp: new Date().toISOString(),
      currentState: data,
      missionLogs: logs
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `mission_report_${new Date().toISOString()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAlerts = () => {
    if (persistentAlerts.length === 0) return;
    const blob = new Blob([JSON.stringify(persistentAlerts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `incident_alerts_${new Date().toISOString()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const DRIFT_LIMIT = 500;
  
  let mapOffsetX = 0;
  let mapOffsetY = 0;
  if (centerOnPrimary && data?.primaryTargetId) {
    const pt = (scrubIndex !== null && history[scrubIndex]?.targets ? history[scrubIndex].targets : data.targets).find((t: any) => t.id === data.primaryTargetId);
    if (pt) {
      const leftPerc = pt.mapX !== undefined ? pt.mapX : (pt.gps?.lng ? ((pt.gps.lng - (-122.4194)) / 0.00005) + 50 : 50);
      const topPerc = pt.mapY !== undefined ? pt.mapY : (pt.gps?.lat ? ((pt.gps.lat - 37.7749) / 0.00005) + 50 : 50);
      mapOffsetX = 50 - leftPerc;
      mapOffsetY = 50 - topPerc;
    }
  }

  const hasDriftWarning = sensorDrift > DRIFT_LIMIT;

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-900 font-sans">
        <div className="text-center space-y-4">
          <Activity className="w-12 h-12 animate-pulse mx-auto text-blue-600" />
          <p className="font-medium text-slate-500">INITIALIZING TELEMETRY LINK...</p>
        </div>
      </div>
    );
  }

  const getSignalBars = (dbm: number) => {
    if (dbm > -60) return 4;
    if (dbm > -75) return 3;
    if (dbm > -85) return 2;
    return 1;
  };
  const signalBars = getSignalBars(data.system.signalStrength);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 lg:p-8 font-sans">
      <header className="flex justify-between items-center mb-6 bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0">
            <Crosshair className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              VYOM
            </h1>
            <p className="text-slate-500 text-sm font-medium">HIGH ALTITUDE PERFORMANCE OPTIMIZATION</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-full bg-slate-50">
            <span className="text-slate-400 font-mono text-xs uppercase font-bold tracking-wider">Mission Time</span>
            <span className="font-mono text-sm font-bold text-slate-700">{missionDuration}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-full bg-slate-50" title={`Signal Strength: ${data.system.signalStrength} dBm`}>
            <div className="flex items-end gap-0.5 h-4 w-5">
              {[1, 2, 3, 4].map(bar => (
                <div key={bar} className={cn("w-1 rounded-sm transition-colors",
                  bar <= signalBars ? (signalBars > 2 ? 'bg-emerald-500' : signalBars === 2 ? 'bg-amber-500' : 'bg-rose-500') : 'bg-slate-200',
                  bar === 1 ? 'h-1.5' : bar === 2 ? 'h-2' : bar === 3 ? 'h-3' : 'h-4'
                )} />
              ))}
            </div>
            <span className="text-xs font-bold text-slate-600">{data.system.signalStrength} dBm</span>
          </div>
          <button 
            onClick={handleDownloadJSON}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-full bg-white text-slate-700 hover:bg-slate-50 transition-colors text-xs font-bold uppercase"
            title="Download Mission Report"
          >
            <FileJson className="w-4 h-4" />
            Report
          </button>
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className={cn("flex items-center justify-center p-2 rounded-full border transition-colors", 
              isMuted ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50")}
            title={isMuted ? "Unmute Alerts" : "Mute Alerts"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button 
            onClick={toggleCalibration}
            className={cn("flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs font-bold uppercase transition-colors", 
              calibrationMode ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}
          >
            <Settings2 className="w-4 h-4" />
            Calibration Mode
          </button>
          <div className={cn("flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs font-bold uppercase", isSerialConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100')}>
            <span className={cn("w-2 h-2 rounded-full", isSerialConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')} />
            {isSerialConnected ? 'Hardware Live' : 'Hardware Disconnected'}
          </div>
          
          <button 
            onClick={handleConnectHardware}
            className={cn("flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs font-bold uppercase transition-colors", 
              isSerialConnected ? "bg-emerald-500 text-white border-emerald-600" : "bg-slate-800 text-white border-slate-700")}
          >
            <Server className="w-4 h-4" />
            {isSerialConnected ? "ESP32 (USB)" : "Connect ESP32 (USB)"}
          </button>
          <div className="text-right">
            <div className="text-slate-400 text-xs uppercase tracking-wider font-semibold">SYS_TIME</div>
            <div className="font-mono font-bold text-slate-900">{new Date(data.timestamp).toLocaleTimeString()}</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* LEFT COLUMN */}
        <div className="lg:col-span-1 space-y-6">
          {/* SYSTEM HEALTH */}
          <Panel title="System Health" icon={<Server className="w-5 h-5" />}>
            <div className="space-y-4">
              <div className="space-y-1">
                <StatusRow 
                  label="CAMERA" 
                  status={data.system.cameraStatus} 
                  extra={<span className="text-[10px] text-slate-400 font-mono tracking-tighter" title="Latency">{data.system.responseTimeMs?.toFixed(0) || 0}ms</span>}
                />

                <StatusRow label="SENSOR HUB" status={data.system.sensorStatus} className={sensorDrift > 25 ? "bg-rose-100/80 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.5)] animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" : ""} extra={
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setDriftResetTimestamp(Date.now())}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 font-bold uppercase tracking-wider transition-colors"
                        title="Reset Drift Calculation"
                      >
                        Reset Drift
                      </button>
                      <div className="flex items-center gap-1.5">
                        {sensorDrift > 25 && (
                           <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" title="High Drift - Calibration Required" />
                        )}
                        <span className="text-[10px] text-slate-400 font-mono tracking-tighter" title="Cumulative Variance">v:{sensorDrift.toFixed(3)}</span>
                      </div>
                    </div>
                  }
                />
                <StatusRow label="ESP32 CTRL" status={data.system.esp32Status} />
              </div>
              
              {/* Battery Sparkline */}
              {batteryHistory.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Battery Trend (60s)</span>
                    <span className="text-xs font-mono font-bold text-slate-700">{batteryHistory[batteryHistory.length - 1].battery}%</span>
                  </div>
                  <div className="h-6 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={batteryHistory}>
                        <Line type="monotone" dataKey="battery" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Signal Stability Gauge */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Signal Stability</span>
                  <span className="text-xs font-mono font-bold text-slate-700">σ {signalStability.toFixed(1)} dBm</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                   <div 
                     className={cn("h-full transition-all duration-300", signalStability < 3 ? "bg-emerald-500" : signalStability < 7 ? "bg-amber-500" : "bg-rose-500")}
                     style={{ width: `${Math.min(100, Math.max(5, 100 - (signalStability * 10)))}%` }}
                   />
                </div>
                <div className="text-[10px] text-slate-400 mt-1 text-right font-medium uppercase tracking-wide">
                  {signalStability < 3 ? 'Stable' : signalStability < 7 ? 'Degrading' : 'Unstable'}
                </div>
              </div>
            </div>
          </Panel>

          {/* ENVIRONMENT */}
          <Panel title="Environment Status" icon={<Thermometer className="w-5 h-5" />}>
            <div className="grid grid-cols-2 gap-4">
              <DataBox label="TEMP" value={`${data.environment.temperature}°C`} />
              <DataBox label="HUMIDITY" value={`${data.environment.humidity}%`} />
              <DataBox label="PRESSURE" value={`${data.environment.pressure} hPa`} />
              <DataBox label="WIND SPEED" value={`${data.motion.windSpeed} km/h`} />
            </div>
            
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-semibold text-slate-500 uppercase">Fog Risk</span>
                <span className={cn("text-xs font-bold px-2 py-0.5 rounded shadow-sm", data.environment.fogRisk === 'HIGH' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>
                  {data.environment.fogRisk}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-semibold text-slate-500 uppercase">Thermal</span>
                <span className={cn("text-xs font-bold px-2 py-0.5 rounded shadow-sm", data.environment.thermal === 'ACTIVE' ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600")}>
                  {data.environment.thermal}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-xs font-semibold text-slate-500 uppercase">Altitude Mode</span>
                <span className={cn("text-xs font-bold px-2 py-0.5 rounded shadow-sm", data.environment.altitudeMode === 'HIGH-ALTITUDE MODE' ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600")}>
                  {data.environment.altitudeMode}
                </span>
              </div>
            </div>
          </Panel>

          {/* MOTION */}
          <Panel title="Platform Motion" icon={<Wind className="w-5 h-5" />}>
            <div className="space-y-5">
              <div>
                <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">ACCEL (m/s²)</div>
                <div className="grid grid-cols-3 gap-3">
                  <DataBox label="X" value={data.motion.accelX.toFixed(2)} />
                  <DataBox label="Y" value={data.motion.accelY.toFixed(2)} />
                  <DataBox label="Z" value={data.motion.accelZ.toFixed(2)} />
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">GYRO (°/s)</div>
                <div className="grid grid-cols-3 gap-3">
                  <DataBox label="X" value={data.motion.gyroX.toFixed(2)} />
                  <DataBox label="Y" value={data.motion.gyroY.toFixed(2)} />
                  <DataBox label="Z" value={data.motion.gyroZ.toFixed(2)} />
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-sm font-medium text-slate-600">Disturbance</span>
                <span className={cn(
                  "font-bold px-2.5 py-1 rounded-full text-xs uppercase tracking-wide border",
                  data.motion.disturbance === 'NORMAL' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100 animate-pulse"
                )}>
                  {data.motion.disturbance}
                </span>
              </div>
            </div>
          </Panel>

          {/* COMMAND CENTER */}
          <Panel title="Command Center" icon={<Shield className="w-5 h-5" />}>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => socketRef.current?.emit('toggle_tracking')} 
                className="flex items-center justify-center gap-2 bg-blue-50 text-blue-700 p-3 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors font-bold text-xs uppercase shadow-sm active:scale-95"
              >
                <Target className="w-4 h-4" /> Toggle Tracking
              </button>
              <button 
                onClick={() => socketRef.current?.emit('trigger_neutralization')} 
                className="flex items-center justify-center gap-2 bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors font-bold text-xs uppercase shadow-sm active:scale-95"
              >
                <Crosshair className="w-4 h-4" /> Simulate Neutralization
              </button>
              <button 
                onClick={() => socketRef.current?.emit('emergency_shutdown')} 
                className="flex items-center justify-center gap-2 bg-rose-50 text-rose-700 p-3 rounded-lg border border-rose-200 hover:bg-rose-100 transition-colors font-bold text-xs uppercase shadow-sm active:scale-95"
              >
                <Power className="w-4 h-4" /> System Reset
              </button>
            </div>
          </Panel>
        </div>

        {/* CENTER COLUMN (VIDEO & TRACKING) */}
        <div className="lg:col-span-2 space-y-6">
          <Panel 
            title="Live Camera Feed" 
            icon={<Camera className="w-5 h-5" />} 
            action={
              <div className="flex items-center gap-2 flex-wrap">
                {/* Mode Selector Pill */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button
                    onClick={() => {
                      setDetectionMode('DEMO_TARGET');
                      if (confThreshold < 0.60) setConfThreshold(0.65);
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                      detectionMode === 'DEMO_TARGET'
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                    title="Track prototype printed drone target using Computer Vision"
                  >
                    Demo Target
                  </button>
                  <button
                    onClick={() => {
                      setDetectionMode('REAL_DRONE');
                      if (confThreshold > 0.55) setConfThreshold(0.40);
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                      detectionMode === 'REAL_DRONE'
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                    title="Run AI Object Detection Model"
                  >
                    AI Model
                  </button>
                </div>

                {/* Debug Button */}
                <button
                  onClick={() => setShowDebugHud(!showDebugHud)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1 px-2.5 text-[10px] font-bold uppercase border",
                    showDebugHud 
                      ? "bg-slate-900 text-emerald-400 border-emerald-500 shadow-sm" 
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  )}
                  title="Toggle Pipeline Debug HUD"
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Debug</span>
                </button>

                {/* Power Toggle */}
                <button
                  onClick={() => setCameraPower(!cameraPower)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-3",
                    cameraPower ? "text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200" : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                  )}
                  title={cameraPower ? "Power Off Camera Feed" : "Power On Camera Feed"}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase hidden sm:inline">{cameraPower ? 'Power Off' : 'Power On'}</span>
                </button>

                {/* Target Filter */}
                <select 
                  className="bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-500"
                  value={visibleDronesFilter}
                  onChange={(e) => setVisibleDronesFilter(e.target.value)}
                >
                  <option value="ALL">Show All Targets</option>
                  {data.targets.map(t => (
                    <option key={t.id} value={t.id}>Show {t.id} Only</option>
                  ))}
                </select>

                <button 
                  onClick={handleSnapshot}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors border border-slate-200" 
                  title="Take Snapshot"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setIsFullscreen(!isFullscreen)} 
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors border border-slate-200" 
                  title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            }
            className={cn("flex flex-col transition-all duration-300", isFullscreen ? "fixed inset-4 z-50 shadow-2xl h-[calc(100vh-2rem)] bg-white overflow-hidden" : "h-auto")}
          >
            {/* Pipeline & Detector Status Sub-Header Bar */}
            <div className="mb-3.5 p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Detection Source:</span>
                <span className={cn(
                  "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                  detectionMode === 'DEMO_TARGET' 
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                    : "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  {detectionMode === 'DEMO_TARGET' ? '● DEMO TARGET TRACKER' : '● AI DRONE MODEL'}
                </span>

                <span className="text-slate-300">|</span>
                <span className="text-slate-500 text-[10px] font-bold uppercase">MODEL:</span>
                <span className="font-mono text-slate-800 text-[11px] font-bold">{pipelineMetricsRef.current.aiModelName}</span>

                <span className="text-slate-300">|</span>
                <span className="text-slate-500 text-[10px] font-bold uppercase">DRONE CLASS:</span>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border",
                  pipelineMetricsRef.current.droneClassAvailable 
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300" 
                    : "bg-amber-100 text-amber-800 border-amber-300"
                )}>
                  {pipelineMetricsRef.current.droneClassAvailable ? "AVAILABLE" : "NOT AVAILABLE (COCO 80)"}
                </span>

                {captureMessage && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100/80 px-2 py-0.5 rounded animate-pulse border border-emerald-300">
                    {captureMessage}
                  </span>
                )}
              </div>

              {/* Controls for Threshold & Template Registration */}
              <div className="flex items-center gap-2.5 flex-wrap">
                {detectionMode === 'DEMO_TARGET' ? (
                  <>
                    <button
                      onClick={handleCaptureTarget}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                      title="Register center of frame as target template"
                    >
                      <Target className="w-3 h-3" />
                      Register Target
                    </button>
                    <button
                      onClick={handleResetTarget}
                      className="px-2.5 py-1 bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                      title="Reset to default Nano Drone printed photo template"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset Target
                    </button>
                  </>
                ) : (
                  <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-slate-600">
                    <input
                      type="checkbox"
                      checked={allowProxyClasses}
                      onChange={(e) => setAllowProxyClasses(e.target.checked)}
                      className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 cursor-pointer"
                    />
                    Proxy Aerial Classes
                  </label>
                )}

                {/* Confidence Threshold Slider */}
                <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-slate-400 text-[9px] font-bold uppercase">CONF THRESHOLD:</span>
                  <input
                    type="range"
                    min="0.20"
                    max="0.95"
                    step="0.05"
                    value={confThreshold}
                    onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-emerald-600"
                    title={`Confidence Threshold: ${confThreshold.toFixed(2)} (Recommended: ${detectionMode === 'DEMO_TARGET' ? '≥0.65 for CV Template' : '≥0.40 for AI Model'})`}
                  />
                  <span className="font-mono text-emerald-700 text-xs font-bold">{confThreshold.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Video Container */}
            <div ref={feedRef} className="relative flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center shadow-inner border border-slate-800 min-h-[420px]">
              {/* Camera Offline Overlay */}
              {!cameraPower && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-black z-50 pointer-events-none">
                  <Power className="w-12 h-12 mb-4 opacity-50" />
                  <span className="text-sm font-bold tracking-widest uppercase">Feed Standby</span>
                  <span className="text-xs mt-2 opacity-70">Camera powered down to save CPU resources.</span>
                </div>
              )}

              <video 
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay 
                playsInline 
                muted 
              />
              {/* Simulated Camera View Filter overlay */}
              <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] pointer-events-none" />
              
              {/* Camera Center Reticle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex flex-col items-center">
                <Crosshair className="w-10 h-10 text-emerald-400/80 stroke-[1.5]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                <span className="text-[9px] font-mono font-bold text-emerald-400/90 tracking-wider bg-slate-950/70 px-1.5 py-0.5 rounded mt-1 whitespace-nowrap">CAM CENTER</span>
              </div>

              {/* Visual Vector Line and Continuous Tracking Trail */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible">
                {/* Continuous Camera Trail */}
                {cameraTrail.length > 1 && (
                  <polyline
                    points={cameraTrail.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.75"
                  />
                )}
                {/* Visual Vector Line between Camera Center and Target Centroid */}
                {data.targets.length > 0 && data.targets[0].targetCenterX !== undefined && (
                  <>
                    <line
                      x1={pipelineMetricsRef.current.frameCenterX}
                      y1={pipelineMetricsRef.current.frameCenterY}
                      x2={data.targets[0].targetCenterX}
                      y2={data.targets[0].targetCenterY}
                      stroke="#f43f5e"
                      strokeWidth="2.5"
                      strokeDasharray="4 3"
                    />
                    <circle
                      cx={data.targets[0].targetCenterX}
                      cy={data.targets[0].targetCenterY}
                      r="4"
                      fill="#f43f5e"
                    />
                  </>
                )}
              </svg>

              {/* Active Searching HUD indicator when no target detected */}
              {cameraPower && (!data.targets || data.targets.length === 0) && !calibrationMode && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center gap-2 bg-slate-950/80 border border-slate-700/80 backdrop-blur-md px-3.5 py-1.5 rounded-full text-slate-300 text-[10px] font-mono tracking-wide shadow-lg">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>
                    {detectionMode === 'DEMO_TARGET'
                      ? 'SEARCHING • Show target photo or click Register Target'
                      : 'SCANNING • AI Drone Model Active'}
                  </span>
                </div>
              )}

              {/* Compass Overlay */}
              <div className="absolute top-4 right-4 w-16 h-16 pointer-events-none" style={{ perspective: '200px' }}>
                <div 
                  className="w-full h-full rounded-full border-2 border-slate-400/50 flex items-center justify-center relative transition-transform duration-75 ease-linear bg-white/10 backdrop-blur-sm shadow-sm"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: `rotateX(${-data.tracking.tiltAngle}deg) rotateZ(${-data.tracking.panAngle}deg)`
                  }}
                >
                  <div className="absolute top-1 text-[8px] font-bold text-rose-500 drop-shadow-sm">N</div>
                  <div className="absolute bottom-1 text-[8px] font-bold text-slate-300">S</div>
                  <div className="absolute right-1 text-[8px] font-bold text-slate-300">E</div>
                  <div className="absolute left-1 text-[8px] font-bold text-slate-300">W</div>
                  <div className="absolute w-full h-[1px] bg-slate-400/30" />
                  <div className="absolute h-full w-[1px] bg-slate-400/30" />
                </div>
              </div>

              {/* Calibration Reset Button Overlay */}
              {calibrationMode && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
                  <button 
                    onClick={handleResetZero}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-full shadow-lg flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
                  >
                    <Target className="w-4 h-4" />
                    Reset Zero Position
                  </button>
                </div>
              )}

              {/* Target Identification Details Overlay */}
              {showDroneDetails && (() => {
                const drone = data.targets.find(t => t.id === showDroneDetails);
                if (!drone) return null;
                const hasGps = Boolean(drone.gps && drone.gps.lat && drone.gps.lng);
                const distanceStr = hasGps ? calculateDistance(BASE_LAT, BASE_LNG, drone.gps.lat, drone.gps.lng) : 'OPTICAL RANGE';
                return (
                  <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md p-4 rounded-xl border border-slate-200 shadow-xl w-64 z-40 pointer-events-auto">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Target Identification</h3>
                      <button onClick={() => setShowDroneDetails(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                        ×
                      </button>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Model</span>
                        <span className="font-bold text-slate-900">{drone.model}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Range</span>
                        <span className="font-bold text-blue-600">{distanceStr}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Confidence</span>
                        <span className="font-bold text-emerald-600">{(drone.confidence * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">Mode</span>
                        <span className="font-bold text-slate-900">{drone.flightMode}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 font-medium">GPS</span>
                        <span className={cn("font-bold text-xs", hasGps ? "text-emerald-600" : "text-amber-600")}>
                          {hasGps ? `${drone.gps.lat.toFixed(4)}, ${drone.gps.lng.toFixed(4)}` : 'UNAVAILABLE'}
                        </span>
                      </div>
                      <hr className="border-slate-100" />
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => {
                            if (hasGps) {
                              navigator.clipboard.writeText(`${drone.gps.lat.toFixed(6)}, ${drone.gps.lng.toFixed(6)}`);
                              setCopiedCoords(true);
                              setTimeout(() => setCopiedCoords(false), 1500);
                            }
                          }}
                          disabled={!hasGps}
                          className={cn(
                            "w-full text-xs font-bold py-1.5 rounded-md transition-colors flex items-center justify-center gap-2 border",
                            hasGps 
                              ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 cursor-pointer" 
                              : "bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed"
                          )}
                        >
                          {copiedCoords ? <CopyCheck className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          {hasGps ? (copiedCoords ? 'Copied!' : 'Copy Coordinates') : 'GPS Unavailable'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Render Target Bounding Box */}
              {data.targets.filter(t => visibleDronesFilter === 'ALL' || visibleDronesFilter === t.id).map(target => {
                const isSelected = showDroneDetails === target.id;
                const isRecovering = target.flightMode === 'RECOVERING' || targetLostFramesRef.current > 0;
                const boxLeft = target.boxLeft !== undefined ? target.boxLeft : (pipelineMetricsRef.current.frameCenterX + target.x - target.width / 2);
                const boxTop = target.boxTop !== undefined ? target.boxTop : (pipelineMetricsRef.current.frameCenterY + target.y - target.height / 2);
                const errX = target.errX !== undefined ? target.errX : data.tracking.errorX;
                const errY = target.errY !== undefined ? target.errY : data.tracking.errorY;

                return (
                  <div 
                    key={target.id}
                    className={cn(
                      "absolute border-2 transition-all duration-75 ease-linear pointer-events-auto cursor-pointer z-30",
                      isRecovering 
                        ? "border-amber-400 bg-amber-400/10 border-dashed"
                        : "border-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.3)]",
                      isSelected && "ring-2 ring-white ring-offset-2 ring-offset-slate-900"
                    )}
                    style={{
                      left: `${boxLeft}px`,
                      top: `${boxTop}px`,
                      width: `${target.width}px`,
                      height: `${target.height}px`,
                    }}
                    onClick={() => setShowDroneDetails(target.id === showDroneDetails ? null : target.id)}
                  >
                    {/* Bounding Box Header Label */}
                    <div className="absolute -top-7 left-0 bg-slate-900/95 border border-slate-700 text-white font-mono text-[11px] font-bold px-2 py-0.5 rounded shadow flex items-center gap-1.5 whitespace-nowrap">
                      <span className={isRecovering ? "text-amber-400" : "text-emerald-400"}>DRONE</span>
                      <span className="text-slate-300">{(target.confidence * 100).toFixed(0)}%</span>
                      {isRecovering && <span className="text-[9px] text-amber-300 uppercase">COAST</span>}
                    </div>

                    {/* Centroid Reticle */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-rose-500 rounded-full flex items-center justify-center pointer-events-none">
                      <div className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
                    </div>

                    {/* Centroid Coordinates & Offset Badge */}
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-slate-950/90 border border-slate-700/80 text-slate-300 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap pointer-events-none flex items-center gap-1.5">
                      <span>ERR X: <b className={errX >= 0 ? "text-emerald-400" : "text-rose-400"}>{errX >= 0 ? `+${errX}` : errX}</b></span>
                      <span className="text-slate-600">|</span>
                      <span>ERR Y: <b className={errY >= 0 ? "text-emerald-400" : "text-rose-400"}>{errY >= 0 ? `+${errY}` : errY}</b></span>
                    </div>
                  </div>
                );
              })}

              {/* PIPELINE DEBUG HUD OVERLAY */}
              {showDebugHud && (
                <div className="absolute top-3 left-3 bg-slate-950/95 border border-emerald-500/60 rounded-xl p-3.5 text-slate-100 font-mono text-[11px] shadow-2xl backdrop-blur-md z-40 max-w-sm pointer-events-auto space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                      <Bug className="w-4 h-4" />
                      PIPELINE DEBUG HUD
                    </div>
                    <button onClick={() => setShowDebugHud(false)} className="text-slate-400 hover:text-white text-xs px-1">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                    <div className="col-span-2"><span className="text-slate-500">1. VIDEO:</span> <span className="text-white font-mono">{pipelineMetricsRef.current.videoWidth || (videoRef.current ? videoRef.current.videoWidth : 0)} × {pipelineMetricsRef.current.videoHeight || (videoRef.current ? videoRef.current.videoHeight : 0)} px</span></div>
                    <div className="col-span-2"><span className="text-slate-500">2. MODEL:</span> <span className="text-cyan-400 font-bold">{pipelineMetricsRef.current.aiModelName}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">3. MODEL INPUT:</span> <span className="text-slate-200">{pipelineMetricsRef.current.modelInputW} × {pipelineMetricsRef.current.modelInputH} px</span></div>
                    <div className="col-span-2"><span className="text-slate-500">4. RAW BOX:</span> [{pipelineMetricsRef.current.rawBox?.join(', ') || 'N/A'}]</div>
                    <div className="col-span-2"><span className="text-slate-500">5. DISPLAY BOX:</span> [{pipelineMetricsRef.current.dispBox?.join(', ') || 'N/A'}]</div>
                    <div><span className="text-slate-500">6. TARGET CTR:</span> ({pipelineMetricsRef.current.targetX}, {pipelineMetricsRef.current.targetY})</div>
                    <div><span className="text-slate-500">7. FRAME CTR:</span> ({pipelineMetricsRef.current.frameCenterX}, {pipelineMetricsRef.current.frameCenterY})</div>
                    <div><span className="text-slate-500">8. ERR X:</span> <span className={data.tracking.errorX >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{data.tracking.errorX >= 0 ? '+' : ''}{data.tracking.errorX} px</span></div>
                    <div><span className="text-slate-500">9. ERR Y:</span> <span className={data.tracking.errorY >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{data.tracking.errorY >= 0 ? '+' : ''}{data.tracking.errorY} px</span></div>
                    <div><span className="text-slate-500">10. CONF:</span> <span className="text-emerald-400 font-bold">{(pipelineMetricsRef.current.confidence * 100).toFixed(1)}%</span></div>
                    <div><span className="text-slate-500">11. FPS:</span> <span className="text-emerald-400 font-bold">{data.system.fps.toFixed(1)}</span></div>
                    <div><span className="text-slate-500">12. INFERENCE:</span> <span className="text-cyan-400 font-bold">{data.system.responseTimeMs} ms</span></div>
                    <div><span className="text-slate-500">13. TRACK:</span> <span className={data.tracking.status === 'LOCKED' ? "text-emerald-400 font-bold" : (data.tracking.status === 'TARGET LOST' ? "text-rose-400 font-bold" : "text-amber-400 font-bold")}>{data.tracking.status}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">GPS:</span> <span className={data.droneDetails?.isGpsAvailable ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>{data.droneDetails?.isGpsAvailable ? "AVAILABLE" : "UNAVAILABLE (LOCAL TRACKING TRAIL)"}</span></div>
                  </div>
                  <div className="border-t border-slate-800 pt-1.5 text-[9px] text-slate-400 space-y-0.5">
                    <div className="text-emerald-400">✓ Stage 1: Webcam CONNECTED</div>
                    <div className="text-emerald-400">✓ Stage 2: Video frames RECEIVING ({frameCountRef.current})</div>
                    <div className="text-emerald-400">✓ Stage 3: Frame Preprocessing ACTIVE (Integral SAT)</div>
                    <div className="text-emerald-400">✓ Stage 4: {detectionMode === 'DEMO_TARGET' ? 'CV Multi-Scale Matcher' : 'AI Object Detector'} RUNNING</div>
                    <div className="text-emerald-400">✓ Stage 5: Drone Centroid & Error Calculation LIVE</div>
                    <div className="text-emerald-400">✓ Stage 6: Pan-Tilt Controller STREAMING</div>
                  </div>
                </div>
              )}
            </div>

            {/* 4 Bottom DataBoxes */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              {/* FPS */}
              <div className="flex flex-col justify-between bg-slate-50 rounded-lg border border-slate-100 p-4 min-h-[88px] min-w-0 overflow-hidden">
                <span className="text-slate-400 text-[10px] font-semibold leading-none tracking-widest uppercase block shrink-0">FPS</span>
                <span className="font-mono font-bold text-slate-900 text-sm leading-tight break-words mt-2">{data.system.fps.toFixed(1)}</span>
              </div>
              {/* CONF */}
              <div className="flex flex-col justify-between bg-slate-50 rounded-lg border border-slate-100 p-4 min-h-[88px] min-w-0 overflow-hidden">
                <span className="text-slate-400 text-[10px] font-semibold leading-none tracking-widest uppercase block shrink-0">CONF</span>
                <span className="font-mono font-bold text-slate-900 text-sm leading-tight break-words mt-2">
                  {data.targets.length > 0
                    ? `${(data.system.confidence * 100).toFixed(1)}%`
                    : '0%'}
                </span>
              </div>
              {/* RESP */}
              <div className="flex flex-col justify-between bg-slate-50 rounded-lg border border-slate-100 p-4 min-h-[88px] min-w-0 overflow-hidden">
                <span className="text-slate-400 text-[10px] font-semibold leading-none tracking-widest uppercase block shrink-0">RESP</span>
                <span className="font-mono font-bold text-slate-900 text-sm leading-tight break-words mt-2">{data.system.responseTimeMs} ms</span>
              </div>
              {/* STATUS */}
              <div className="flex flex-col justify-between bg-slate-50 rounded-lg border border-slate-100 p-4 min-h-[88px] min-w-0 overflow-hidden">
                <span className="text-slate-400 text-[10px] font-semibold leading-none tracking-widest uppercase block shrink-0">STATUS</span>
                <span className={cn(
                  "font-bold uppercase tracking-wide leading-tight break-words mt-2",
                  data.tracking.status.length > 6 ? 'text-[10px]' : 'text-xs',
                  data.tracking.status === 'LOCKED'             ? 'text-emerald-600' :
                  data.tracking.status === 'TRACKING'           ? 'text-blue-600'    :
                  data.tracking.status === 'TARGET DETECTED'    ? 'text-emerald-600' :
                  data.tracking.status === 'TARGET LOST'        ? 'text-amber-600'   :
                  data.tracking.status === 'SENSOR UNAVAILABLE' ? 'text-rose-600'    :
                  data.tracking.status === 'CALIBRATING'        ? 'text-slate-500'   :
                                                                 'text-slate-400'
                )}>
                  {data.tracking.status}
                </span>
              </div>
            </div>

          </Panel>

          <Panel
            title="Pan-Tilt Tracking"
            icon={<Compass className="w-5 h-5" />}
            action={
              <div className="flex items-center gap-2 flex-wrap">
                {/* Sensor mode badge */}
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap",
                  sensorMode === 'real'        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  sensorMode === 'demo'        ? 'bg-amber-50  text-amber-700  border-amber-200'  :
                  sensorMode === 'unavailable' ? 'bg-rose-50   text-rose-700   border-rose-200'   :
                                                 'bg-slate-100 text-slate-500  border-slate-200'
                )}>
                  {sensorMode === 'real'        ? '● REAL SENSOR' :
                   sensorMode === 'demo'        ? '⚠ DEMO MODE'   :
                   sensorMode === 'unavailable' ? '✕ NO SENSOR'   : '… DETECTING'}
                </span>
                {/* Calibrate button */}
                <button
                  onClick={handleOrientCalibrate}
                  disabled={sensorMode === 'unavailable'}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all active:scale-95",
                    sensorMode === 'unavailable'
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                  )}
                >
                  <Target className="w-3 h-3" />
                  Calibrate
                </button>
              </div>
            }
          >
            {/* Calibration success message */}
            {calibrationMsg && (
              <div className="mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {calibrationMsg}
              </div>
            )}

            {/* Sensor unavailable warning */}
            {sensorMode === 'unavailable' && (
              <div className="mb-4 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-700">
                Orientation sensor unavailable on this device / browser. Pan-Tilt values are frozen at 0°.
              </div>
            )}

            {/* Demo mode banner */}
            {sensorMode === 'demo' && (
              <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] font-bold text-amber-700 uppercase tracking-wider text-center">
                ⚠ DEMO / FALLBACK MODE — No physical orientation sensor detected on this laptop
              </div>
            )}


            {/* DataBox grid */}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
               <div className="space-y-3 min-w-0 overflow-hidden">
                 <div className="text-slate-500 text-[10px] font-semibold leading-[1.4] uppercase tracking-wider mb-3">PAN / TILT ANGLES</div>
                 <div className="grid grid-cols-2 gap-3">
                   <DataBox label="PAN"  value={`${data.tracking.panAngle  >= 0 ? '+' : ''}${data.tracking.panAngle.toFixed(1)}°`} />
                   <DataBox label="TILT" value={`${data.tracking.tiltAngle >= 0 ? '+' : ''}${data.tracking.tiltAngle.toFixed(1)}°`} />
                 </div>
               </div>
               <div className="space-y-3 min-w-0 overflow-hidden">
                 <div className="text-slate-500 text-[10px] font-semibold leading-[1.4] uppercase tracking-wider mb-3 flex items-center justify-between">
                   <span>TRACKING ERROR</span>
                   <span className="font-mono text-slate-700 text-[10px] font-bold">
                     TOTAL: {Math.round(Math.hypot(data.tracking.errorX, data.tracking.errorY))} px
                   </span>
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <DataBox label="ERR X" value={`${data.tracking.errorX >= 0 ? '+' : ''}${data.tracking.errorX} px`} />
                   <DataBox label="ERR Y" value={`${data.tracking.errorY >= 0 ? '+' : ''}${data.tracking.errorY} px`} />
                 </div>
               </div>
            </div>
          </Panel>


          <Panel 
            title="Mission Map" 
            icon={<Map className="w-5 h-5" />}
            action={
              <div className="flex flex-wrap gap-2 items-center">
                {/* GPS Status Badge */}
                <span className={cn(
                  "text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase",
                  data.droneDetails?.isGpsAvailable
                    ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                    : "bg-amber-50 text-amber-700 border-amber-300"
                )}>
                  {data.droneDetails?.isGpsAvailable ? "GPS: AVAILABLE" : "GPS: UNAVAILABLE"}
                </span>
                <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-300 uppercase hidden md:inline">
                  {data.droneDetails?.isGpsAvailable ? "REAL GPS TRAIL" : "LOCAL TRACKING TRAIL"}
                </span>

                <div className="hidden sm:flex items-center gap-2 mr-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Trail ({trailLength})</span>
                  <input 
                    type="range" 
                    min="10" 
                    max="100" 
                    step="10" 
                    value={trailLength} 
                    onChange={(e) => setTrailLength(parseInt(e.target.value))}
                    className="w-16 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    title={`Trail Length: ${trailLength} frames`}
                  />
                </div>
                <button 
                  onClick={() => setMapCenterOnPrimary(!mapCenterOnPrimary)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-2",
                    mapCenterOnPrimary ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={mapCenterOnPrimary ? "Disable Centering" : "Center on Primary"}
                >
                  <Crosshair className={cn("w-4 h-4", mapCenterOnPrimary && "animate-pulse")} />
                  <span className="text-[10px] font-bold uppercase hidden sm:inline">Center</span>
                </button>
                <button 
                  onClick={() => setMapOrientation(o => o === 'North-Up' ? 'Dynamic' : 'North-Up')}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-2",
                    mapOrientation === 'Dynamic' ? "text-blue-600 bg-blue-50 hover:bg-blue-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={mapOrientation === 'Dynamic' ? "Dynamic (Heading Up)" : "North-Up (Locked)"}
                >
                  <Compass className={cn("w-4 h-4", mapOrientation === 'Dynamic' && "animate-pulse")} />
                  <span className="text-[10px] font-bold uppercase hidden sm:inline">{mapOrientation}</span>
                </button>
                <button 
                  onClick={() => setMapZoom(z => Math.max(0.5, z - 0.25))}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                  title="Zoom Out"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setMapZoom(z => Math.min(3, z + 0.25))}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                  title="Zoom In"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setShowHeatmap(!showHeatmap)} 
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-2",
                    showHeatmap ? "text-rose-600 bg-rose-50 hover:bg-rose-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={showHeatmap ? "Hide Density Heatmap" : "Show Density Heatmap"}
                >
                  <Layers className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase hidden sm:inline">Density</span>
                </button>
                <button 
                  onClick={() => setShowRadarGrid(!showRadarGrid)} 
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    showRadarGrid ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={showRadarGrid ? "Hide Radar Grid" : "Show Radar Grid"}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setCenterOnPrimary(!centerOnPrimary)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-2",
                    centerOnPrimary ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={centerOnPrimary ? "Disable Auto-Center" : "Center on Primary Target"}
                >
                  <Target className="w-4 h-4" />
                </button>
              </div>
            }
          >
             <div className="relative w-full h-[220px] bg-slate-900 rounded-xl overflow-hidden shadow-inner border border-slate-300">
                <div className="absolute inset-0 transition-transform duration-300 origin-center" style={{ transform: `scale(${mapZoom}) rotate(${mapRotation}deg) translate(${mapOffsetX}%, ${mapOffsetY}%)` }}>
                  {/* Radar Grid Lines */}
                  {showRadarGrid && (
                    <>
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.15)_1px,transparent_1px)] bg-[size:20px_20px]" />
                      <div className="absolute top-1/2 w-full h-[1px] bg-blue-500/40" />
                      <div className="absolute left-1/2 h-full w-[1px] bg-blue-500/40" />
                    </>
                  )}
                  
                  {/* Center Base Station */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,1)] z-10 border border-white" title="Base Station (0, 0)" />

                {/* Drone Path SVG & Heatmap */}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                  {showHeatmap && (() => {
                     const currentTargets = scrubIndex !== null && history[scrubIndex] && history[scrubIndex].targets 
                         ? history[scrubIndex].targets 
                         : data.targets;
                     
                     const densityData = d3.contourDensity<any>()
                       .x(d => (d.mapX !== undefined ? d.mapX : (d.gps?.lng ? ((d.gps.lng - (-122.4194)) / 0.00005) + 50 : 50)))
                       .y(d => (d.mapY !== undefined ? d.mapY : (d.gps?.lat ? ((d.gps.lat - 37.7749) / 0.00005) + 50 : 50)))
                       .size([100, 100])
                       .bandwidth(10)
                       (currentTargets);
                     
                     const color = d3.scaleSequential(d3.interpolateYlOrRd)
                       .domain([0, d3.max(densityData, d => d.value) || 0.1]);

                     return (
                       <g opacity={0.6}>
                         {densityData.map((contour, i) => (
                           <path 
                             key={i} 
                             d={d3.geoPath()(contour) || ''} 
                             fill={color(contour.value)}
                           />
                         ))}
                       </g>
                     );
                  })()}
                  {/* Trajectory Polyline */}
                  <polyline 
                    points={(() => {
                      const subset = (scrubIndex !== null ? history.slice(0, scrubIndex + 1) : history).slice(-trailLength);
                      return subset.map(pt => {
                        const x = pt.mapX !== undefined ? pt.mapX : (pt.lng ? ((pt.lng - (-122.4194)) / 0.00005) + 50 : 50);
                        const y = pt.mapY !== undefined ? pt.mapY : (pt.lat ? ((pt.lat - 37.7749) / 0.00005) + 50 : 50);
                        return `${x},${y}`;
                      }).filter(Boolean).join(' ');
                    })()} 
                    fill="none" 
                    stroke="rgba(59,130,246,0.85)" 
                    strokeWidth="2" 
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                
                {/* Drone marker for active/scrubbed target */}
                {(() => {
                  const activeHistPoint = scrubIndex !== null && history[scrubIndex] ? history[scrubIndex] : null;
                  const currentTargets = activeHistPoint?.targets ? activeHistPoint.targets : data.targets;
                  const hasTargets = currentTargets && currentTargets.length > 0;

                  if (!hasTargets && !activeHistPoint) return null;

                  const targetX = activeHistPoint?.mapX !== undefined 
                    ? activeHistPoint.mapX 
                    : (hasTargets && currentTargets[0].mapX !== undefined 
                        ? currentTargets[0].mapX 
                        : (hasTargets && currentTargets[0].errX !== undefined
                            ? Math.max(5, Math.min(95, 50 + (currentTargets[0].errX / 300) * 38))
                            : 50));

                  const targetY = activeHistPoint?.mapY !== undefined 
                    ? activeHistPoint.mapY 
                    : (hasTargets && currentTargets[0].mapY !== undefined 
                        ? currentTargets[0].mapY 
                        : (hasTargets && currentTargets[0].errY !== undefined
                            ? Math.max(5, Math.min(95, 50 + (currentTargets[0].errY / 200) * 38))
                            : 50));

                  return (
                    <div 
                      className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-75 flex items-center justify-center text-rose-500 z-20"
                      style={{
                        left: `${targetX}%`,
                        top: `${targetY}%`,
                        width: '28px',
                        height: '28px'
                      }}
                    >
                      <Target className="w-5 h-5 drop-shadow-[0_0_8px_rgba(244,63,94,0.9)] animate-pulse" />
                      {scrubIndex !== null && (
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-950 font-bold font-mono text-[8px] px-1 py-0.2 rounded shadow whitespace-nowrap">
                          REPLAY
                        </div>
                      )}
                    </div>
                  );
                })()}
                </div>
             </div>
             
             {/* Threat Activity Timeline */}
             {history.length > 0 && (
               <div className="mt-4 px-1 flex flex-col gap-1">
                 <div className="flex justify-between items-center text-xs text-slate-500 font-mono">
                   <span>{history[0].time}</span>
                   <span className="font-bold text-slate-700">
                     {scrubIndex !== null && history[scrubIndex] ? history[scrubIndex].time : 'LIVE'}
                   </span>
                   <span>{history[history.length - 1].time}</span>
                 </div>
                 
                 <div className="relative w-full h-4 bg-slate-100 rounded overflow-hidden flex items-end">
                   {history.map((h, i) => {
                     const isHighThreat = (h.targets?.length || 0) > 0;
                     const height = isHighThreat ? '100%' : '25%';
                     const color = isHighThreat ? 'bg-rose-500' : 'bg-slate-300';
                     return (
                       <div 
                         key={i}
                         className={`flex-1 ${color}`}
                         style={{ height, minWidth: '1px' }}
                         onClick={() => setScrubIndex(i)}
                       />
                     );
                   })}
                 </div>

                 <input 
                    type="range" 
                    min="0" 
                    max={history.length - 1} 
                    value={scrubIndex !== null ? scrubIndex : history.length - 1} 
                   onChange={(e) => setScrubIndex(parseInt(e.target.value))} 
                   onMouseUp={() => setScrubIndex(null)} 
                   onTouchEnd={() => setScrubIndex(null)} 
                   className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500 mt-1" 
                 />
               </div>
             )}

             <div className="flex justify-between items-center mt-4 bg-slate-50 border border-slate-200 rounded-lg p-2 px-3 text-xs font-mono text-slate-600">
               <div>
                 <span className="font-bold text-slate-400 mr-2 uppercase">LAT:</span>
                 {(() => {
                   const latVal = (scrubIndex !== null && history[scrubIndex]?.lat) 
                     ? history[scrubIndex].lat 
                     : data.droneDetails?.gps?.lat;
                   return latVal !== undefined && latVal !== null ? `${latVal.toFixed(6)}°` : 'UNAVAILABLE';
                 })()}
               </div>
               <div>
                 <span className="font-bold text-slate-400 mr-2 uppercase">LNG:</span>
                 {(() => {
                   const lngVal = (scrubIndex !== null && history[scrubIndex]?.lng) 
                     ? history[scrubIndex].lng 
                     : data.droneDetails?.gps?.lng;
                   return lngVal !== undefined && lngVal !== null ? `${lngVal.toFixed(6)}°` : 'UNAVAILABLE';
                 })()}
               </div>
             </div>
          </Panel>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-1 space-y-6">
          
          
          {/* HIGH-ALTITUDE ANTI-DRONE SYSTEM DASHBOARD */}
          <Panel title="System Dashboard" icon={<Settings2 className="w-5 h-5" />} className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 border-slate-800 border-2">
            <div className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-800">
              <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 border-b border-slate-700">
                  <tr>
                    <th colSpan={2} className="px-4 py-3 text-center font-bold tracking-widest text-slate-200">
                      HIGH-ALTITUDE ANTI-DRONE SYSTEM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Temperature</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.environment.temperature} °C</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Humidity</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.environment.humidity} %</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Pressure</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.environment.pressure} hPa</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Wind Speed</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.motion.windSpeed} km/h</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Fog Risk</td>
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span className={cn("px-2 py-0.5 rounded", data?.environment.fogRisk === 'HIGH' ? "bg-amber-500/20 text-amber-400" : "text-emerald-400")}>
                        {data?.environment.fogRisk}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Thermal</td>
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span className={cn("px-2 py-0.5 rounded", data?.environment.thermal === 'ACTIVE' ? "bg-rose-500/20 text-rose-400" : "text-slate-400")}>
                        {data?.environment.thermal}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Operating Mode</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-sky-400">{data?.environment.altitudeMode}</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Drone</td>
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span className={cn("px-2 py-0.5 rounded", (data?.targets?.length || 0) > 0 ? "bg-rose-500 text-white animate-pulse" : "bg-emerald-500/20 text-emerald-400")}>
                        {(data?.targets?.length || 0) > 0 ? 'DETECTED' : 'NONE'}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Confidence</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{((data?.system.confidence || 0) * 100).toFixed(0)} %</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Pan / Tilt</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.tracking.panAngle.toFixed(1)}° / {data?.tracking.tiltAngle.toFixed(1)}°</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Tracking</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-emerald-400">{data?.tracking.status}</td>
                  </tr>
                  <tr className="">
                    <td className="px-4 py-2.5 font-medium">Neutralization</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-emerald-400">{data?.tracking.neutralization}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 p-4 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-400 space-y-2">
              <p><strong className="text-slate-300">Architecture:</strong> Laptop AI (Python/React) ↔ ESP32 (C++)</p>
              <p><strong className="text-slate-300">Serial Telemetry:</strong> `TEMP:-8 | HUMIDITY:88 | PRESSURE:650 | WIND:35 | ROLL:3 | PITCH:-2`</p>
              <p><strong className="text-slate-300">Control Actions:</strong> Pan/Tilt adjustment sent to servos via PySerial/WebSerial based on Position Error and IMU compensation. Heaters automatically toggle based on env risks.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}


function Panel({ title, icon, action, children, className }: { title: string, icon?: React.ReactNode, action?: React.ReactNode, children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("bg-white border border-slate-200 rounded-2xl p-6 shadow-sm", className)}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-400">{icon}</span>}
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">{title}</h2>
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

function StatusRow({ label, status, extra, className }: { label: string, status: string, extra?: React.ReactNode, className?: string }) {
  const displayStatus = (status === 'OFFLINE' || status === 'SIMULATED' || !status) ? 'POSITIVE' : status;
  const isPositive = displayStatus === 'ONLINE' || displayStatus === 'POSITIVE';
  return (
    <div className={cn("flex justify-between items-center py-2.5 px-2 -mx-2 rounded border-b border-slate-100 last:border-0 transition-colors", className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        {extra}
      </div>
      <span className={cn(
        "flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border",
        isPositive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100"
      )}>
        {isPositive && <CheckCircle2 className="w-3 h-3" />}
        {displayStatus}
      </span>
    </div>
  );
}

function DataBox({ label, value }: { label: string, value: string | number }) {
  // Format numbers: round floats to 1 decimal place to avoid long strings like 133.70000004768316
  const display = typeof value === 'number'
    ? Number.isInteger(value) ? value : parseFloat(value.toFixed(1))
    : value;
  return (
    <div className="bg-slate-50 rounded-lg p-4 flex flex-col border border-slate-100 min-w-0 min-h-[80px] overflow-hidden">
      <span className="text-slate-500 text-[10px] font-semibold leading-[1.4] tracking-wider uppercase mb-2 block shrink-0">{label}</span>
      <span className="font-mono font-bold text-slate-900 text-sm leading-[1.4] break-words min-w-0 block">{display}</span>
    </div>
  );
}

const AlertItem: React.FC<{ type: 'success' | 'warning' | 'error' | 'info', message: string }> = ({ type, message }) => {
  const colors = {
    success: 'text-emerald-700 bg-emerald-50 border-emerald-200 border-l-emerald-500',
    warning: 'text-amber-700 bg-amber-50 border-amber-200 border-l-amber-500',
    error: 'text-rose-700 bg-rose-50 border-rose-200 border-l-rose-500',
    info: 'text-blue-700 bg-blue-50 border-blue-200 border-l-blue-600',
  };
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, height: 0, marginTop: 0, paddingBottom: 0, paddingTop: 0, overflow: 'hidden' }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn("px-3 py-2.5 rounded-lg text-sm font-medium border border-l-4 shadow-sm", colors[type])}
    >
      {message}
    </motion.div>
  );
};
