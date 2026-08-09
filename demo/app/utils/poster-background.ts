/** Generates a full-bleed raster background at the requested pixel dimensions. */
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

/**
 * Generates a resolution-independent full-bleed SVG background.
 *
 * Keeping this as SVG avoids allocating a huge browser canvas. The SVG is
 * uploaded directly to S3, then Typst rasterizes it at the poster's requested
 * physical dimensions/PPI during PNG export.
 */
export function generatePosterBackgroundSvg(widthPx: number, heightPx: number, accent: string): Blob {
    // The accent normally comes from <input type="color">, but keep the SVG
    // safe if this helper is reused with arbitrary input later.
    const safeAccent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#2563eb'
    const step = Math.max(1, Math.round(widthPx / 24))
    const lineWidth = Math.max(1, widthPx / 1200)

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${safeAccent}"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
    <pattern id="grid" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
      <path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="white" stroke-opacity="0.10" stroke-width="${lineWidth}"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#background)"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
</svg>`

    return new Blob([svg], { type: 'image/svg+xml' })
}
