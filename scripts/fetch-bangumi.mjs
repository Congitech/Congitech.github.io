import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBangumiConfig, writeEmptyBangumi } from './lib/bangumi-config.mjs'

const ROOT = join(import.meta.dirname, '..')
const OUTPUT = join(ROOT, 'data', 'bangumi.json')
const API_BASE = 'https://api.bilibili.com/x/space/bangumi/follow/list'
const PAGE_SIZE = 24
const FETCH_TIMEOUT_MS = 15000
const MAX_RETRIES = 3

const STATUS_KEYS = [
  { status: 1, key: 'wantWatch' },
  { status: 2, key: 'watching' },
  { status: 3, key: 'watched' },
]

function formatNumber(num) {
  if (!num) return '-'
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)} 亿`
  if (num >= 10000) return `${(num / 10000).toFixed(1)} 万`
  return String(num)
}

function formatTotal(count) {
  if (!count) return '-'
  if (count === -1) return '未完结'
  return `全 ${count} 话`
}

function normalizeCoverUrl(cover) {
  const raw = String(cover || '').replace(/^http:/, 'https:').trim()
  if (!raw) return ''
  if (/@\d+w_\d+h\.(webp|jpg|png)/i.test(raw)) return raw
  try {
    const parsed = new URL(raw)
    return `${parsed.origin}${parsed.pathname}@96w_128h.webp`
  } catch {
    return raw
  }
}

function normalizeItem(item) {
  const cover = normalizeCoverUrl(item?.cover)
  const newEp = item?.new_ep?.index_show || ''
  const totalCount = item?.total_count > 0
    ? formatTotal(item.total_count)
    : (newEp || '-')

  return {
    title: String(item?.title || '').trim(),
    cover,
    url: String(item?.url || item?.short_url || '').trim(),
    seasonTypeName: String(item?.season_type_name || '').trim(),
    area: String(item?.areas?.[0]?.name || '').trim(),
    score: item?.rating?.score ?? null,
    follow: formatNumber(item?.stat?.follow),
    view: formatNumber(item?.stat?.view),
    summary: String(item?.summary || item?.evaluate || '').trim(),
    totalCount,
    newEp,
    badge: String(item?.badge || '').trim(),
    styles: Array.isArray(item?.styles) ? item.styles.slice(0, 4) : [],
    seasonId: item?.season_id || 0,
  }
}

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIOVTUE-HugoBlog-Bangumi/1.0)',
          Referer: 'https://space.bilibili.com/',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json?.code !== 0) {
        throw new Error(json?.message || `API code ${json?.code}`)
      }
      return json.data
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function fetchStatusList(vmid, followStatus) {
  const first = await fetchJson(
    `${API_BASE}?playform=web&type=1&follow_status=${followStatus}&vmid=${vmid}&ps=1&pn=1`,
  )
  const total = Number(first?.total || 0)
  if (!total) return []

  const pages = Math.ceil(total / PAGE_SIZE)
  const items = []

  for (let pn = 1; pn <= pages; pn += 1) {
    const data = await fetchJson(
      `${API_BASE}?playform=web&type=1&follow_status=${followStatus}&vmid=${vmid}&ps=${PAGE_SIZE}&pn=${pn}`,
    )
    for (const item of data?.list || []) {
      const normalized = normalizeItem(item)
      if (normalized.title) items.push(normalized)
    }
  }

  return items
}

async function buildBangumiData(vmid) {
  const result = { wantWatch: [], watching: [], watched: [] }

  for (const { status, key } of STATUS_KEYS) {
    try {
      result[key] = await fetchStatusList(vmid, status)
      console.log(`[bangumi] ${key}: ${result[key].length} item(s)`)
    } catch (err) {
      console.warn(`[bangumi] skip status ${status}:`, err.message || err)
      result[key] = []
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    vmid,
    ...result,
  }
}

const config = getBangumiConfig(ROOT)

if (!config.enabled || !config.vmid) {
  writeEmptyBangumi(OUTPUT, config.vmid)
  console.log('[bangumi] disabled or missing vmid, wrote empty data/bangumi.json')
  process.exit(0)
}

const data = await buildBangumiData(config.vmid)
writeFileSync(OUTPUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
const total = data.wantWatch.length + data.watching.length + data.watched.length
console.log(`[bangumi] wrote ${total} item(s) -> data/bangumi.json`)
