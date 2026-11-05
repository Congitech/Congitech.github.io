const JIFFIES_PER_MS = 1000 / 60

function unpackUint32LE(buffer, offset) {
  return (
    buffer[offset]
    | (buffer[offset + 1] << 8)
    | (buffer[offset + 2] << 16)
    | (buffer[offset + 3] << 24)
  ) >>> 0
}

function unpackArray(buffer, start, end) {
  const values = []
  for (let i = start; i < end; i += 4) {
    values.push(unpackUint32LE(buffer, i))
  }
  return values
}

function unpackString(buffer, start, end) {
  let out = ''
  for (let i = start; i < end; i += 1) {
    if (buffer[i] === 0) break
    out += String.fromCharCode(buffer[i])
  }
  return out
}

class RIFFFile {
  constructor() {
    this.head = 0
    this.supportedContainers = ['RIFF', 'RIFX']
  }

  setSignature(bytes) {
    this.head = 0
    this.container = unpackString(bytes, 0, 4)
    if (!this.supportedContainers.includes(this.container)) {
      throw new Error('Not a supported RIFF container.')
    }
    this.chunkSize = unpackUint32LE(bytes, 4)
    this.format = unpackString(bytes, 8, 12)
    this.head = 12
    this.signature = {
      format: this.format,
      subChunks: this.readChunks(bytes),
    }
  }

  findChunk(chunkId, multiple = false) {
    const chunks = this.signature.subChunks
    const matches = []
    for (let i = 0; i < chunks.length; i += 1) {
      if (chunks[i].chunkId === chunkId) {
        if (multiple) matches.push(chunks[i])
        else return chunks[i]
      }
    }
    return chunkId === 'LIST' && matches.length ? matches : null
  }

  readChunks(buffer) {
    const chunks = []
    let offset = this.head
    while (offset <= buffer.length - 8) {
      const chunk = this.readChunk(buffer, offset)
      chunks.push(chunk)
      offset += 8 + chunk.chunkSize
      if (offset % 2) offset += 1
    }
    return chunks
  }

  readChunk(buffer, offset) {
    const chunk = {
      chunkId: unpackString(buffer, offset, offset + 4),
      chunkSize: unpackUint32LE(buffer, offset + 4),
    }
    if (chunk.chunkId === 'LIST') {
      chunk.format = unpackString(buffer, offset + 8, offset + 12)
      this.head = offset + 12
      chunk.subChunks = this.readChunks(buffer)
    } else {
      this.head = offset + 8 + chunk.chunkSize + (chunk.chunkSize % 2)
      chunk.chunkData = { start: offset + 8, end: this.head }
    }
    return chunk
  }
}

export function readIconHotspot(bytes) {
  const type = bytes[2] | (bytes[3] << 8)
  if (type !== 2 || bytes.length < 14) {
    return { x: 0, y: 0 }
  }
  return {
    x: bytes[10] | (bytes[11] << 8),
    y: bytes[12] | (bytes[13] << 8),
  }
}

export function parseAni(arr) {
  const riff = new RIFFFile()
  riff.setSignature(arr)
  if (riff.signature.format !== 'ACON') {
    throw new Error(`Expected format "ACON", got "${riff.signature.format}"`)
  }

  function mapChunk(chunkId, mapper) {
    const chunk = riff.findChunk(chunkId)
    return chunk == null ? null : mapper(chunk)
  }

  function readImages(chunk, frameCount) {
    return chunk.subChunks.slice(0, frameCount).map((c) => {
      if (c.chunkId !== 'icon') {
        throw new Error(`Unexpected chunk type in fram: ${c.chunkId}`)
      }
      return Buffer.from(arr.slice(c.chunkData.start, c.chunkData.end))
    })
  }

  const metadata = mapChunk('anih', (c) => {
    const words = unpackArray(arr, c.chunkData.start, c.chunkData.end)
    return {
      nFrames: words[1],
      iDispRate: words[7],
    }
  })

  if (metadata == null) {
    throw new Error('Did not find anih')
  }

  const rate = mapChunk('rate', (c) => unpackArray(arr, c.chunkData.start, c.chunkData.end))
  const seq = mapChunk('seq ', (c) => unpackArray(arr, c.chunkData.start, c.chunkData.end))
  const lists = riff.findChunk('LIST', true)
  const imageChunk = lists?.find((c) => c.format === 'fram')
  if (imageChunk == null) {
    throw new Error('Did not find fram LIST')
  }

  let images = readImages(imageChunk, metadata.nFrames)
  const infoChunk = lists?.find((c) => c.format === 'INFO')
  if (infoChunk != null) {
    infoChunk.subChunks.forEach((c) => {
      if (c.chunkId === 'LIST' && c.format === 'fram') {
        images = readImages(c, metadata.nFrames)
      }
    })
  }

  return { images, rate, seq, metadata }
}

export function buildAnimationTimeline(ani) {
  const rate = ani.rate ?? ani.images.map(() => ani.metadata.iDispRate)
  const duration = rate.reduce((total, value) => total + value, 0)
  const frames = ani.images.map((_, index) => ({ index, percents: [] }))

  let elapsed = 0
  rate.forEach((step, i) => {
    const frameIdx = ani.seq ? ani.seq[i] : i
    frames[frameIdx].percents.push((elapsed / duration) * 100)
    elapsed += step
  })

  return {
    duration: duration * JIFFIES_PER_MS,
    frames: frames.filter((frame) => frame.percents.length > 0),
  }
}
