const POLL_DELAYS_MS = [1000, 2000, 5000, 10000]
const MAX_POLL_TIME_MS = 10 * 60 * 1000

type BatchResult = { status: string }

export function useBatchPolling() {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false

  function stop() {
    cancelled = true
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  function start<T extends BatchResult>(
    fetchStatus: () => Promise<{ results: T[] }>,
    onResults: (results: T[]) => void,
    onError: (error: Error) => void
  ) {
    stop()
    cancelled = false
    const startedAt = Date.now()
    let attempt = 0

    const poll = async () => {
      if (cancelled) return
      try {
        const response = await fetchStatus()
        if (cancelled) return
        onResults(response.results)
        if (response.results.length > 0 && response.results.every((r) => r.status === 'completed' || r.status === 'failed')) {
          timer = undefined
          return
        }
        if (Date.now() - startedAt >= MAX_POLL_TIME_MS) {
          onError(new Error('Batch polling timed out after 10 minutes'))
          timer = undefined
          return
        }
        const delay = POLL_DELAYS_MS[Math.min(attempt++, POLL_DELAYS_MS.length - 1)]
        timer = setTimeout(poll, delay)
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error : new Error(String(error)))
        timer = undefined
      }
    }

    void poll()
  }

  onUnmounted(stop)
  return { start, stop }
}
