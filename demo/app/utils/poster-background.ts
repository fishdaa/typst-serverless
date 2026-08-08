/**
 * Generates a full-bleed background PNG sized in pixels to exactly match the
 * poster's physical dimensions at the chosen PPI (e.g. 24in x 60in @ 150ppi =
 * 3600x9000px). Used as the poster's background image so PNG export runs the
 * fishdaa/typst fork's large-image resampling fast path against a
 * poster-sized raster, not a small thumbnail.
 */
export function generatePosterBackground(widthPx: number, heightPx: number, accent: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  const gradient = ctx.createLinearGradient(0, 0, widthPx, heightPx)
  gradient.addColorStop(0, accent)
  gradient.addColorStop(1, '#0f172a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, widthPx, heightPx)

  // Grid overlay so the resampling behavior (moire/aliasing on thin lines) is
  // visible when the background is scaled during layout/export.
  const step = Math.max(1, Math.round(widthPx / 24))
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = Math.max(1, widthPx / 1200)
  for (let x = 0; x <= widthPx; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, heightPx)
    ctx.stroke()
  }
  for (let y = 0; y <= heightPx; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(widthPx, y)
    ctx.stroke()
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas toBlob failed'))
    }, 'image/png')
  })
}
