import { existsSync } from 'node:fs';
import path from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';
import sharp from 'sharp';

/**
 * TS-22 · NSFW image classifier based on an open ONNX model.
 *
 * Default format (`NSFW_MODEL_FORMAT=falconsai`): Falconsai/nsfw_image_detection, Apache-2.0 (checked 16.11.2026 on the model card;
 * ViT, config.json: id2label {0: normal, 1: nsfw}, preprocessor_config.json: 224×224, mean = std = 0.5 for all channels).
 *   input  — pixel_values: float32[1, 3, 224, 224]
 *   output — logits: float32[1, 2]  (normal, nsfw)
 * The original repository holds PyTorch/safetensors weights, not an ONNX file: the ONNX file is made once with
 * `optimum-cli export onnx --model Falconsai/nsfw_image_detection <dir>` and put at NSFW_MODEL_PATH (see docs/DECISIONS.md, ADR-103).
 *
 * Other format (`NSFW_MODEL_FORMAT=five-class`): a 5-class model drawings / hentai / neutral / porn / sexy, ImageNet normalisation.
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

export type NsfwFormat = 'falconsai' | 'five-class';
const FORMATS = {
  falconsai: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], classes: ['normal', 'nsfw'], sexual: ['nsfw'] },
  'five-class': { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], classes: ['drawings', 'hentai', 'neutral', 'porn', 'sexy'], sexual: ['hentai', 'porn', 'sexy'] },
} as const;
const format = (): NsfwFormat => (process.env.NSFW_MODEL_FORMAT === 'five-class' ? 'five-class' : 'falconsai');

export interface NsfwResult {
  score: number;
  topClass: string;
  /** TS-22 classification: 'block' | 'flag' | 'pass' */
  verdict: 'block' | 'flag' | 'pass';
  scores: Record<string, number>;
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
async function preprocessImage(imagePath: string, fmt: (typeof FORMATS)[NsfwFormat]): Promise<Float32Array> {
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
      tensor[c * pixels + i] = (raw - (fmt.mean[c] ?? 0)) / (fmt.std[c] ?? 1);
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

/**
 * TS-22: from the model's logits to a verdict. The score is the probability of the sexual classes; a model whose output does not match
 * the chosen format gives null (the check is then skipped, see processor.ts).
 */
export function interpretLogits(logits: ArrayLike<number>, fmtName: NsfwFormat = 'falconsai'): NsfwResult | null {
  const fmt = FORMATS[fmtName];
  if (logits.length !== fmt.classes.length) return null;
  const probs = softmax(Float32Array.from(logits));
  const scores: Record<string, number> = Object.fromEntries(fmt.classes.map((cls, i) => [cls, probs[i] ?? 0]));
  const nsfwScore = fmt.sexual.reduce((sum, cls) => sum + (scores[cls] ?? 0), 0);
  let topClass: string = fmt.classes[0];
  let topP = -1;
  for (const [cls, p] of Object.entries(scores)) {
    if (p > topP) {
      topP = p;
      topClass = cls;
    }
  }
  let verdict: NsfwResult['verdict'] = 'pass';
  if (nsfwScore >= NSFW_HIGH_THRESHOLD) verdict = 'block';
  else if (nsfwScore >= NSFW_MID_THRESHOLD) verdict = 'flag';
  return { score: nsfwScore, topClass, verdict, scores };
}

/** TS-22: classify an image. Returns null when the model is unavailable. */
export async function classifyNsfw(imagePath: string): Promise<NsfwResult | null> {
  if (!isNsfwModelAvailable()) return null;
  const fmtName = format();
  const session = await getModel();
  const tensor = await preprocessImage(imagePath, FORMATS[fmtName]);
  const ort = await import('onnxruntime-node');
  const output = await session.run({ pixel_values: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]) });
  const logits = output['logits']?.data as Float32Array | undefined;
  return logits ? interpretLogits(logits, fmtName) : null;
}
