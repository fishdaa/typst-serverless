export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            const comma = result.indexOf(',')
            resolve(comma >= 0 ? result.slice(comma + 1) : result)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
}

export function textToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
}

const MIME_BY_FORMAT: Record<string, string> = {
    pdf: 'application/pdf',
    svg: 'image/svg+xml',
    png: 'image/png'
}

export function mimeForFormat(format: string | undefined): string {
    return MIME_BY_FORMAT[format || 'pdf'] || 'application/octet-stream'
}

export function base64ToBlobUrl(base64: string, format: string | undefined): string {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: mimeForFormat(format) })
    return URL.createObjectURL(blob)
}
