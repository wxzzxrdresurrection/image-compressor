// Comprime una imagen fuera del hilo principal usando OffscreenCanvas.
// Mensaje de entrada: { id, file, maxSize, quality, format }
// Mensaje de salida:  { id, blob, width, height, keptOriginal } | { id, error }

const MIME = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png'
}

self.onmessage = async ({ data }) => {
  const { id, file, maxSize, quality, format } = data
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const type = format === 'original' ? file.type : MIME[format]
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')

    // JPEG no admite transparencia: fondo blanco en vez de negro
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await canvas.convertToBlob({ type, quality })

    // Si no se ganó nada y no cambiamos formato ni tamaño, conservar el original
    const sameOutput = type === file.type && scale === 1
    if (sameOutput && blob.size >= file.size) {
      self.postMessage({ id, blob: file, width, height, keptOriginal: true })
    } else {
      self.postMessage({ id, blob, width, height, keptOriginal: false })
    }
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) })
  } finally {
    bitmap?.close()
  }
}
