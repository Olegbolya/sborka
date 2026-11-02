import { existsSync } from 'node:fs';
import path from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';
import sharp from 'sharp';

/**
 * TS-22 · NSFW image classifier based on an open ONNX model.
 *
 * Model format: Falconsai/nsfw_image_detection (ViT-based 5-class classifier)
 *   input  — pixel_values: float32[1, 3, 224, 224], ImageNet normalisation
 *             mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]
 *   output — logits: float32[1, 5]
 *             classes: drawings, hentai, neutral, porn, sexy
 *
 * Model download (add to server-setup.sh):
 *   wget -q -O ~/blokum/models/nsfw.onnx \
 *     https://huggingface.co/Falconsai/nsfw_image_detection/resolve/main/model.onnx
 *
 * Threshold rules (TS-22):
 *   score ≥ HIGH_THRESHOLD  → BLOCK  + flag category A/B for manual review
 *   score ≥ MID_THRESHOLD   → flag for manual review only (status stays PROCESSING)
 *   score < MID_THRESHOLD   → pass
 */

const MODEL_PATH = process.env.NSFW_MODEL_PATH ?? path.join(process.env.HOME ?? '/root', 'blokum', 'models', 'nsfw.onnx');

export const NSFW_HIGH_THRESHOLD = 0.85;
export const NSFW_MID_THRESHOLD = 0.5;

const INPUT_SIZE = 224;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const NSFW_CLASSES = ['drawings', 'hentai', 'neutral', 'porn', 'sexy'] as const;
type NsfwClass = (typeof NSFW_CLASSES)[number];

export interface NsfwResult {
  score: number;
  topClass: NsfwClass;
  /** TS-22 classification: 'block' | 'flag' | 'pass' */
  verdict: 'block' | 'flag' | 'pass';
  scores: Record<NsfwClass, number>;
}

let modelLoaded: Promise<InferenceSession> | null = null;

export function isNsfwModelAvailable(): boolean {
  return existsSync(MODEL_PATH);
}

async function getModel(): Promise<InferenceSession> {
  if (!modelLoaded) {
    const ort = await import('onnxruntime-node');
    modelLoaded = ort.InferenceSession.create(MODEL_PATH);
  }
  return modelLoaded;
}

/**
 * Preprocess image: resize to 224×224 and apply ImageNet normalisation.
 * Returns a Float32Array of shape [1, 3, 224, 224] in CHW order.
 */
async function preprocessImage(imagePath: string): Promise<Float32Array> {
  const { data, info } = await sharp(imagePath, { failOn: 'none' })
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = info.width * info.height;
  const tensor = new Float32Array(3 * pixels);

  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) {
      const raw = (data[i * 3 + c] ?? 0) / 255;
      tensor[c * pixels + i] = (raw - (IMAGENET_MEAN[c] ?? 0)) / (IMAGENET_STD[c] ?? 1);
    }
  }
  return tensor;
}

function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exp = Array.from(logits).map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return new Float32Array(exp.map((v) => v / sum));
}

/** TS-22: classify an image. Returns null when the model is unavailable. */
export async function classifyNsfw(imagePath: string): Promise<NsfwResult | null> {
  if (!isNsfwModelAvailable()) return null;

  const session = await getModel();
  const tensor = await preprocessImage(imagePath);

  const ort = await import('onnxruntime-node');
  const feed = { pixel_values: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]) };
  const output = await session.run(feed);

  const logits = output['logits']?.data as Float32Array;
  if (!logits || logits.length !== NSFW_CLASSES.length) return null;

  const probs = softmax(logits);
  const scores = Object.fromEntries(NSFW_CLASSES.map((cls, i) => [cls, probs[i]])) as Record<NsfwClass, number>;

  // The nsfw score is the sum of the explicitly sexual classes.
  const nsfwScore = scores.hentai + scores.porn + scores.sexy;
  let topClass: NsfwClass = 'neutral';
  let topP = -1;
  for (const [cls, p] of Object.entries(scores)) {
    if (p > topP) { topP = p; topClass = cls as NsfwClass; }
  }

  let verdict: NsfwResult['verdict'] = 'pass';
  if (nsfwScore >= NSFW_HIGH_THRESHOLD) verdict = 'block';
  else if (nsfwScore >= NSFW_MID_THRESHOLD) verdict = 'flag';

  return { score: nsfwScore, topClass, verdict, scores };
}
