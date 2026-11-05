import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import decodeIco from 'decode-ico'
import { buildAnimationTimeline, parseAni, readIconHotspot } from './lib/parse-ani.mjs'
import { MOUSE_STYLE_RULES } from './lib/mouse-style-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SOURCE = 'D:/user/desktop/团团猫动态鼠标指针'
const SOURCE_DIR = process.env.MOUSE_SOURCE_DIR ?? DEFAULT_SOURCE
const DEST_DIR = join(ROOT, 'static/mouse/tuantuanma')
const WEBP_QUALITY = Number.parseInt(process.env.MOUSE_WEBP_QUALITY ?? '72', 10)

function readMouseScale() {
  if (process.env.MOUSE_SCALE !== undefined && process.env.MOUSE_SCALE !== '') {
    const scale = Number.parseFloat(process.env.MOUSE_SCALE)
    if (Number.isFinite(scale)) {
      return Math.min(1, Math.max(0.1, scale))
    }
  }

  try {
    const toml = readFileSync(join(ROOT, 'hugo.toml'), 'utf8')
    const match = toml.match(/\[params\.mouse\][\s\S]*?scale\s*=\s*([\d.]+)/)
    if (match) {
      const scale = Number.parseFloat(match[1])
      if (Number.isFinite(scale)) return Math.min(1, Math.max(0.1, scale))
    }
  } catch {
    // ignore
  }

  return 0.25
}

function resolveAniSourceDir() {
  if (existsSync(SOURCE_DIR) && readdirSync(SOURCE_DIR).some((name) => name.endsWith('.ani'))) {
    return SOURCE_DIR
  }
  return null
}

function hashBuffer(buffer) {
  return createHash('sha1').update(buffer).digest('hex').slice(0, 12)
}

async function encodeIconFrame(iconBytes, scale) {
  const hotspot = readIconHotspot(iconBytes)
  const decoded = decodeIco(iconBytes)
  const image = decoded.at(-1) ?? decoded[0]
  if (!image?.data?.length) {
    throw new Error('failed to decode icon frame')
  }

  const sourceWidth = image.width
  const sourceHeight = image.height
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const webp = await sharp(image.data, {
    raw: {
      width: sourceWidth,
      height: sourceHeight,
      channels: 4,
    },
  })
    .resize(width, height, { fit: 'fill' })
    .webp({ quality: WEBP_QUALITY, alphaQuality: 80, effort: 6 })
    .toBuffer()

  return {
    webp,
    hotspot: {
      x: Math.max(0, Math.round(hotspot.x * (width / sourceWidth))),
      y: Math.max(0, Math.round(hotspot.y * (height / sourceHeight))),
    },
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function sumDirBytes(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const relativePath of readdirSync(dir, { recursive: true })) {
    const filePath = join(dir, relativePath)
    try {
      const stat = statSync(filePath)
      if (stat.isFile()) total += stat.size
    } catch {
      // ignore
    }
  }
  return total
}

function validateManifest(manifest) {
  const names = new Set(MOUSE_STYLE_RULES.map((rule) => rule.name))
  for (const rule of manifest.rules ?? []) {
    if (!names.has(rule.name)) {
      throw new Error(`unexpected manifest rule: ${rule.name}`)
    }
    if (!rule.keyframes?.length) {
      throw new Error(`rule has no keyframes: ${rule.name}`)
    }
    for (const frame of rule.keyframes) {
      const filePath = join(DEST_DIR, frame.file)
      if (!existsSync(filePath)) {
        throw new Error(`missing webp asset: ${frame.file}`)
      }
      if (frame.x == null || frame.y == null) {
        throw new Error(`missing hotspot: ${rule.name}/${frame.file}`)
      }
    }
  }
  if (manifest.rules.length !== MOUSE_STYLE_RULES.length) {
    throw new Error(`expected ${MOUSE_STYLE_RULES.length} rules, got ${manifest.rules.length}`)
  }
}

async function buildRuleAssets(rule, aniBuffer, scale) {
  const ani = parseAni(aniBuffer)
  const timeline = buildAnimationTimeline(ani)
  const ruleDir = join(DEST_DIR, rule.name)
  mkdirSync(ruleDir, { recursive: true })

  const frameCache = new Map()
  const keyframes = []

  for (const frame of timeline.frames) {
    const iconBytes = ani.images[frame.index]
    const digest = hashBuffer(iconBytes)
    let asset = frameCache.get(digest)

    if (!asset) {
      const encoded = await encodeIconFrame(iconBytes, scale)
      const fileName = `${digest}.webp`
      writeFileSync(join(ruleDir, fileName), encoded.webp)
      asset = {
        file: `${rule.name}/${fileName}`,
        x: encoded.hotspot.x,
        y: encoded.hotspot.y,
      }
      frameCache.set(digest, asset)
    }

    keyframes.push({
      file: asset.file,
      x: asset.x,
      y: asset.y,
      percents: frame.percents.map((value) => Math.round(value * 1000) / 1000),
    })
  }

  return {
    name: rule.name,
    selector: rule.selector,
    hover: rule.hover,
    priority: rule.priority,
    duration: Math.round(timeline.duration),
    keyframes,
  }
}

async function compressMouseAssets() {
  const sourceDir = resolveAniSourceDir()
  if (!sourceDir) {
    console.error('[compress-mouse-assets] 未找到 .ani 源目录')
    console.error('[compress-mouse-assets] 请设置 MOUSE_SOURCE_DIR 指向原始指针包目录')
    process.exit(1)
  }

  const scale = readMouseScale()
  mkdirSync(DEST_DIR, { recursive: true })

  const prepared = MOUSE_STYLE_RULES.map((rule) => {
    const aniPath = join(sourceDir, rule.file)
    if (!existsSync(aniPath)) {
      throw new Error(`missing source file: ${rule.file}`)
    }
    return { rule, buffer: readFileSync(aniPath) }
  })

  const beforeBytes = sumDirBytes(DEST_DIR)

  for (const entry of readdirSync(DEST_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      rmSync(join(DEST_DIR, entry.name), { recursive: true, force: true })
    } else {
      rmSync(join(DEST_DIR, entry.name), { force: true })
    }
  }

  const rules = []
  for (const { rule, buffer } of prepared) {
    rules.push(await buildRuleAssets(rule, buffer, scale))
  }

  const manifest = {
    version: 1,
    scale,
    rules,
  }
  writeFileSync(join(DEST_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  validateManifest(manifest)

  const afterBytes = sumDirBytes(DEST_DIR)
  console.log(
    `[compress-mouse-assets] 已写入 static/mouse/tuantuanma（scale=${scale}，${rules.length} 组）`
    + `，${formatBytes(beforeBytes)} → ${formatBytes(afterBytes)}`,
  )
}

await compressMouseAssets()
