import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function getBangumiConfig(root = join(import.meta.dirname, '../..')) {
  try {
    const out = execSync('hugo config --format json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const cfg = JSON.parse(out)
    const bangumi = cfg.params?.bangumi || {}
    return {
      enabled: bangumi.enable === true,
      vmid: String(bangumi.vmid || '').trim(),
      quote: String(bangumi.quote || '').trim(),
    }
  } catch {
    return { enabled: false, vmid: '', quote: '' }
  }
}

export function writeEmptyBangumi(outputPath, vmid = '') {
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      vmid,
      wantWatch: [],
      watching: [],
      watched: [],
    }, null, 2)}\n`,
    'utf8',
  )
}
