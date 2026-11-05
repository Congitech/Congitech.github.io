import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function isLinksRssEnabled(root = join(import.meta.dirname, '../..')) {
  try {
    const out = execSync('hugo config --format json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const cfg = JSON.parse(out)
    return cfg.params?.links?.rssenable === true
  } catch {
    return false
  }
}

export function writeEmptyLinksRss(outputPath) {
  writeFileSync(
    outputPath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), feeds: [] }, null, 2)}\n`,
    'utf8',
  )
}
