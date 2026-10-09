/**
 * Real-Time Computer Vision Multi-Scale Template Matcher
 * 
 * Uses Normalized Cross-Correlation (NCC) on luminance representations.
 * NCC is invariant to linear brightness and contrast changes:
 *   NCC(u, v) = sum((I - mean_I) * (T - mean_T)) / (std_I * std_T * N)
 * 
 * Runs efficiently in browser Canvas at 30+ FPS (~5-12ms per frame).
 */

export interface MatchResult {
  found: boolean;
  x: number;          // Top-left X in source video coordinates
  y: number;          // Top-left Y in source video coordinates
  width: number;      // Width in source video coordinates
  height: number;     // Height in source video coordinates
  centerX: number;    // Centroid X in source video coordinates
  centerY: number;    // Centroid Y in source video coordinates
  confidence: number; // Normalized score 0.0 - 1.0 (e.g. 0.82 = 82%)
  scale: number;
}

interface ScaledTemplate {
  scale: number;
  width: number;
  height: number;
  pixels: Float32Array; // Mean-centered luminance
  std: number;          // Standard deviation of template
}

export class TemplateMatcher {
  private scaledTemplates: ScaledTemplate[] = [];
  private workCanvas: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D;
  private templateCanvas: HTMLCanvasElement;
  private templateCtx: CanvasRenderingContext2D;
  private isReady = false;
  private templateName = 'Drone Prototype Target';
  private originalWidth = 0;
  private originalHeight = 0;

  constructor() {
    this.workCanvas = document.createElement('canvas');
    this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true })!;
    this.templateCanvas = document.createElement('canvas');
    this.templateCtx = this.templateCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  public get ready(): boolean {
    return this.isReady;
  }

  public get name(): string {
    return this.templateName;
  }

  /**
   * Load template from an image URL or image element
   */
  public async loadTemplateFromUrl(url: string, name = 'Drone Prototype Target'): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.setTemplateImage(img, name);
        resolve(true);
      };
      img.onerror = () => {
        console.error('Failed to load template from:', url);
        resolve(false);
      };
      img.src = url;
    });
  }

  /**
   * Set template directly from an Image, Video, or Canvas element
   */
  public setTemplateImage(
    source: CanvasImageSource,
    name = 'Custom Target',
    cropRect?: { x: number; y: number; width: number; height: number }
  ): boolean {
    let sw = cropRect?.width || (source as any).videoWidth || (source as any).naturalWidth || (source as any).width;
    let sh = cropRect?.height || (source as any).videoHeight || (source as any).naturalHeight || (source as any).height;
    let sx = cropRect?.x || 0;
    let sy = cropRect?.y || 0;

    if (!sw || !sh) return false;

    this.originalWidth = sw;
    this.originalHeight = sh;
    this.templateName = name;

    // In working frame (width 320px), calibrated base width allows matching
    // the full drone silhouette rather than just a small rotor slice.
    const vw = (source as any).videoWidth || (source as any).naturalWidth || 1280;
    let baseWidth = Math.round((sw / vw) * 320);
    // Constrain base width to realistic drone working dimensions (80 - 180px)
    if (baseWidth < 70 || isNaN(baseWidth)) baseWidth = 110;
    if (baseWidth > 180) baseWidth = 180;
    const baseHeight = Math.max(24, Math.round(baseWidth * (sh / sw)));

    this.scaledTemplates = [];

    // Multi-scale pyramid from far (0.45x) to close-up (2.1x)
    const scales = [0.45, 0.6, 0.75, 0.9, 1.0, 1.2, 1.45, 1.75, 2.1];

    for (const s of scales) {
      const tw = Math.round(baseWidth * s);
      const th = Math.round(baseHeight * s);
      if (tw < 20 || th < 20 || tw > 260 || th > 200) continue;

      this.templateCanvas.width = tw;
      this.templateCanvas.height = th;
      this.templateCtx.clearRect(0, 0, tw, th);
      this.templateCtx.drawImage(source, sx, sy, sw, sh, 0, 0, tw, th);

      const imgData = this.templateCtx.getImageData(0, 0, tw, th);
      const { pixels, std } = this.extractLuminanceNormalized(imgData.data, tw, th);

      // Require meaningful contrast in the template (std >= 8 on 0-255 scale)
      if (std >= 8) {
        this.scaledTemplates.push({
          scale: s,
          width: tw,
          height: th,
          pixels,
          std,
        });
      }
    }

    this.isReady = this.scaledTemplates.length > 0;
    return this.isReady;
  }

  /**
   * Run multi-scale Normalized Cross-Correlation on a video frame
   */
  public match(video: HTMLVideoElement, threshold = 0.65): MatchResult {
    if (!this.isReady || !video.videoWidth || !video.videoHeight) {
      return {
        found: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        centerX: 0,
        centerY: 0,
        confidence: 0,
        scale: 1,
      };
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Working scale for real-time video processing (width: 320px)
    const workW = 320;
    const workH = Math.round(workW * (vh / vw));

    this.workCanvas.width = workW;
    this.workCanvas.height = workH;
    this.workCtx.drawImage(video, 0, 0, workW, workH);

    const frameImgData = this.workCtx.getImageData(0, 0, workW, workH);
    const frameLum = this.extractLuminance(frameImgData.data, workW, workH);

    // ── Precompute Integral Images (SAT & SAT_SQ) for O(1) window stats ──
    const stride = workW + 1;
    const sat = new Float64Array(stride * (workH + 1));
    const satSq = new Float64Array(stride * (workH + 1));

    for (let y = 0; y < workH; y++) {
      let rowSum = 0;
      let rowSumSq = 0;
      const yOffset = y * workW;
      const satY = (y + 1) * stride;
      const satPrevY = y * stride;

      for (let x = 0; x < workW; x++) {
        const val = frameLum[yOffset + x];
        rowSum += val;
        rowSumSq += val * val;
        sat[satY + x + 1] = sat[satPrevY + x + 1] + rowSum;
        satSq[satY + x + 1] = satSq[satPrevY + x + 1] + rowSumSq;
      }
    }

    let bestScore = -1;
    let bestX = 0;
    let bestY = 0;
    let bestTw = 0;
    let bestTh = 0;
    let bestScale = 1;

    // Search across scale pyramid
    for (const t of this.scaledTemplates) {
      const tw = t.width;
      const th = t.height;
      if (tw >= workW || th >= workH) continue;

      const tPixels = t.pixels;
      const tStd = t.std;
      const nPixels = tw * th;

      // Contrast floor: reject windows with variance < 144 (std < 12) or < 25% of template std
      const minRequiredVar = Math.max(144, (tStd * 0.25) * (tStd * 0.25));

      // Dynamic search step based on template width for maximum responsiveness (~8ms latency)
      const step = Math.max(2, Math.floor(tw / 18));
      const sampleStep = tw > 60 ? 2 : 1;

      for (let y = 0; y <= workH - th; y += step) {
        const y2 = y + th;
        const rowTop = y * stride;
        const rowBottom = y2 * stride;

        for (let x = 0; x <= workW - tw; x += step) {
          const x2 = x + tw;

          // O(1) Sum and SumSq lookup from integral image
          const winSum = sat[rowBottom + x2] - sat[rowTop + x2] - sat[rowBottom + x] + sat[rowTop + x];
          const winSumSq = satSq[rowBottom + x2] - satSq[rowTop + x2] - satSq[rowBottom + x] + satSq[rowTop + x];

          const winMean = winSum / nPixels;
          const winVar = winSumSq / nPixels - winMean * winMean;

          // Instant O(1) rejection of empty space / flat walls / smooth shadows
          if (winVar < minRequiredVar) continue;
          const winStd = Math.sqrt(winVar);

          // Compute cross-correlation
          let crossCorr = 0;
          let sampledCount = 0;

          for (let dy = 0; dy < th; dy += sampleStep) {
            const rowOffset = (y + dy) * workW + x;
            const tRowOffset = dy * tw;
            for (let dx = 0; dx < tw; dx += sampleStep) {
              const fVal = frameLum[rowOffset + dx] - winMean;
              const tVal = tPixels[tRowOffset + dx];
              crossCorr += fVal * tVal;
              sampledCount++;
            }
          }

          const score = crossCorr / (sampledCount * winStd * tStd);
          if (score > bestScore) {
            bestScore = score;
            bestX = x;
            bestY = y;
            bestTw = tw;
            bestTh = th;
            bestScale = t.scale;
          }
        }
      }
    }

    // Fine search refinement (step 1) around best peak
    if (bestScore > 0.40 && bestTw > 0) {
      const fineRadius = 4;
      const matchT = this.scaledTemplates.find((t) => t.width === bestTw && t.height === bestTh);
      if (matchT) {
        const tw = matchT.width;
        const th = matchT.height;
        const tPixels = matchT.pixels;
        const tStd = matchT.std;
        const nPixels = tw * th;
        const minRequiredVar = Math.max(144, (tStd * 0.25) * (tStd * 0.25));

        const startY = Math.max(0, bestY - fineRadius);
        const endY = Math.min(workH - th, bestY + fineRadius);
        const startX = Math.max(0, bestX - fineRadius);
        const endX = Math.min(workW - tw, bestX + fineRadius);

        for (let y = startY; y <= endY; y++) {
          const y2 = y + th;
          const rowTop = y * stride;
          const rowBottom = y2 * stride;

          for (let x = startX; x <= endX; x++) {
            const x2 = x + tw;

            const winSum = sat[rowBottom + x2] - sat[rowTop + x2] - sat[rowBottom + x] + sat[rowTop + x];
            const winSumSq = satSq[rowBottom + x2] - satSq[rowTop + x2] - satSq[rowBottom + x] + satSq[rowTop + x];

            const winMean = winSum / nPixels;
            const winVar = winSumSq / nPixels - winMean * winMean;
            if (winVar < minRequiredVar) continue;
            const winStd = Math.sqrt(winVar);

            let crossCorr = 0;
            for (let dy = 0; dy < th; dy++) {
              const rowOffset = (y + dy) * workW + x;
              const tRowOffset = dy * tw;
              for (let dx = 0; dx < tw; dx++) {
                const fVal = frameLum[rowOffset + dx] - winMean;
                const tVal = tPixels[tRowOffset + dx];
                crossCorr += fVal * tVal;
              }
            }

            const score = crossCorr / (nPixels * winStd * tStd);
            if (score > bestScore) {
              bestScore = score;
              bestX = x;
              bestY = y;
            }
          }
        }
      }
    }

    // Scale back to source video coordinates
    const scaleFactorX = vw / workW;
    const scaleFactorY = vh / workH;

    const finalX = bestX * scaleFactorX;
    const finalY = bestY * scaleFactorY;
    const finalW = bestTw * scaleFactorX;
    const finalH = bestTh * scaleFactorY;
    const finalCx = finalX + finalW / 2;
    const finalCy = finalY + finalH / 2;

    const normalizedConfidence = Math.max(0, Math.min(1, bestScore));

    return {
      found: normalizedConfidence >= threshold,
      x: Math.round(finalX),
      y: Math.round(finalY),
      width: Math.round(finalW),
      height: Math.round(finalH),
      centerX: Math.round(finalCx),
      centerY: Math.round(finalCy),
      confidence: parseFloat(normalizedConfidence.toFixed(3)),
      scale: bestScale,
    };
  }

  private extractLuminance(data: Uint8ClampedArray, w: number, h: number): Float32Array {
    const total = w * h;
    const lum = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      // Perceptual luminance standard Rec. 709
      lum[i] = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
    }
    return lum;
  }

  private extractLuminanceNormalized(
    data: Uint8ClampedArray,
    w: number,
    h: number
  ): { pixels: Float32Array; std: number } {
    const total = w * h;
    const lum = this.extractLuminance(data, w, h);

    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < total; i++) {
      sum += lum[i];
      sumSq += lum[i] * lum[i];
    }
    const mean = sum / total;
    const variance = sumSq / total - mean * mean;
    const std = Math.sqrt(Math.max(0.0001, variance));

    const normalized = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      normalized[i] = lum[i] - mean;
    }

    return { pixels: normalized, std };
  }
}
