/** Human-readable byte count, e.g. `842 KB`, `3.4 MB`. */
export function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB']
    let value = bytes
    let unit = -1
    do {
        value /= 1024
        unit++
    } while (value >= 1024 && unit < units.length - 1)
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}
