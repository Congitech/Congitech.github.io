import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isLinksRssEnabled, writeEmptyLinksRss } from './lib/links-rss-config.mjs'
import { hasEnoughRssBody } from './lib/rss-article-body.mjs'

const ROOT = join(import.meta.dirname, '..')
const LINKS_YAML = join(ROOT, 'data', 'links.yaml')
const OUTPUT = join(ROOT, 'data', 'links_rss.json')
const FETCH_COUNT = 4
const MIN_BODY_LENGTH = 80
const FETCH_TIMEOUT_MS = 15000

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveAbsoluteUrl(url, base) {
  if (!url) return ''
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

function pickTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = block.match(re)
  return match?.[1]?.trim() || ''
}

function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i')
  return block.match(re)?.[1]?.trim() || ''
}

function extractCover(block, html, baseUrl) {
  const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i)
  if (enclosure) {
    const type = block.match(/<enclosure[^>]+type=["']([^"']+)["']/i)?.[1] || ''
    if (!type || type.startsWith('image/')) {
      return resolveAbsoluteUrl(enclosure[1], baseUrl)
    }
  }

  const media = block.match(/<(?:media:)?(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i)
  if (media) return resolveAbsoluteUrl(media[1], baseUrl)

  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (img) return resolveAbsoluteUrl(img[1], baseUrl)
  return ''
}

function parseRssItems(xml, feedUrl) {
  if (/<feed[\s>]/i.test(xml)) {
    const baseLink = pickAttr(xml, 'link', 'href') || feedUrl
    return [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((match) => {
      const block = match[0]
      const title = stripHtml(pickTag(block, 'title'))
      const link = pickAttr(block, 'link', 'href') || pickTag(block, 'link')
      const rawHtml = pickTag(block, 'content') || pickTag(block, 'summary')
      const summary = pickTag(block, 'summary') || rawHtml
      const plain = stripHtml(rawHtml || summary)
      const descPlain = stripHtml(summary)
      return {
        title,
        link: resolveAbsoluteUrl(link, baseLink || feedUrl),
        content: plain,
        description: descPlain.length > 120 ? descPlain.slice(0, 120) : descPlain,
        cover: extractCover(block, rawHtml || summary, link || feedUrl),
      }
    }).filter((item) => item.title && item.link)
  }

  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0]
    const title = stripHtml(pickTag(block, 'title'))
    const link = pickTag(block, 'link') || pickAttr(block, 'link', 'href')
    const rawHtml = pickTag(block, 'encoded') || pickTag(block, 'description')
    const summary = pickTag(block, 'description') || rawHtml
    const plain = stripHtml(rawHtml || summary)
    const descPlain = stripHtml(summary)
    return {
      title,
      link: resolveAbsoluteUrl(link, feedUrl),
      content: plain,
      description: descPlain.length > 120 ? descPlain.slice(0, 120) : descPlain,
      cover: extractCover(block, rawHtml || summary, link || feedUrl),
    }
  }).filter((item) => item.title && item.link)
}

function pickArticlesWithMinBody(items, maxCount, minLen = MIN_BODY_LENGTH) {
  const picked = []
  for (const item of items) {
    if (picked.length >= maxCount) break
    if (hasEnoughRssBody(item, minLen)) picked.push(item)
  }
  return picked
}

async function fetchText(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AIOVTUE-HugoBlog-RSS-Fetcher/1.0' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!text.trim() || text.trim().startsWith('<!DOCTYPE')) {
      throw new Error('invalid response body')
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

function unquote(value) {
  const text = String(value || '').trim()
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

function parseFirstGroupRssLinks(yamlText) {
  const lines = yamlText.split('\n')
  let groupCount = 0
  let inLinks = false
  let current = null
  const links = []

  for (const line of lines) {
    if (/^\s*- name:/.test(line)) {
      if (current?.rss) links.push(current)
      current = null
      groupCount += 1
      inLinks = false
      if (groupCount > 1) break
      continue
    }

    if (groupCount !== 1) continue

    if (/^\s*links:\s*$/.test(line)) {
      inLinks = true
      continue
    }

    if (!inLinks) continue

    const urlMatch = line.match(/^\s*- url:\s*(.+)\s*$/)
    if (urlMatch) {
      if (current?.rss) links.push(current)
      current = {
        url: unquote(urlMatch[1]),
        name: '',
        blog: '',
        desc: '',
        color: '#0078e7',
        avatar: '',
        rss: '',
      }
      continue
    }

    if (!current) continue

    const pairs = [
      ['name', /^\s*name:\s*(.+)\s*$/],
      ['blog', /^\s*blog:\s*(.+)\s*$/],
      ['desc', /^\s*desc:\s*(.+)\s*$/],
      ['color', /^\s*color:\s*(.+)\s*$/],
      ['avatar', /^\s*avatar:\s*(.+)\s*$/],
      ['rss', /^\s*rss:\s*(.+)\s*$/],
    ]

    for (const [key, re] of pairs) {
      const match = line.match(re)
      if (match) current[key] = unquote(match[1])
    }
  }

  if (current?.rss) links.push(current)

  return links.filter((item) => /^https?:\/\//i.test(String(item.rss || '').trim()))
}

async function buildLinksRssData() {
  const yamlText = readFileSync(LINKS_YAML, 'utf8')
  const sources = parseFirstGroupRssLinks(yamlText)
  const feeds = []

  for (const source of sources) {
    try {
      const xml = await fetchText(source.rss)
      const articles = pickArticlesWithMinBody(parseRssItems(xml, source.rss), FETCH_COUNT)
      if (!articles.length) {
        console.warn(`[links-rss] empty feed: ${source.rss}`)
        continue
      }
      feeds.push({
        name: source.name,
        blog: source.blog || source.name,
        desc: source.desc || '',
        url: source.url,
        color: source.color,
        avatar: source.avatar,
        rss: source.rss,
        articles,
      })
      console.log(`[links-rss] ok: ${source.name} (${articles.length})`)
    } catch (err) {
      console.warn(`[links-rss] skip ${source.rss}:`, err.message || err)
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    feeds,
  }
}

if (!isLinksRssEnabled(ROOT)) {
  writeEmptyLinksRss(OUTPUT)
  process.exit(0)
}

const data = await buildLinksRssData()
writeFileSync(OUTPUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
console.log(`[links-rss] wrote ${data.feeds.length} feed(s) -> data/links_rss.json`)
