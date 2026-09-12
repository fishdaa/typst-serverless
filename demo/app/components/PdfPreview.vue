<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const props = defineProps<{ url: string }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const loading = ref(false)
const error = ref('')
let mounted = false
let renderGeneration = 0

async function renderPdf() {
  const generation = ++renderGeneration
  error.value = ''
  if (!props.url || !canvas.value) return

  loading.value = true
  try {
    const response = await fetch(props.url)
    if (!response.ok) throw new Error(`Unable to load PDF (${response.status})`)

    const pdf = await pdfjsLib.getDocument({ data: await response.arrayBuffer() }).promise
    if (generation !== renderGeneration || !canvas.value) {
      await pdf.destroy()
      return
    }

    const page = await pdf.getPage(1)
    if (generation !== renderGeneration || !canvas.value) {
      await pdf.destroy()
      return
    }

    const baseViewport = page.getViewport({ scale: 1 })
    const availableWidth = canvas.value.parentElement?.clientWidth || baseViewport.width
    const scale = Math.min(2, Math.max(1, availableWidth / baseViewport.width))
    const pixelRatio = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * pixelRatio })
    const displayWidth = viewport.width / pixelRatio
    const displayHeight = viewport.height / pixelRatio

    canvas.value.width = viewport.width
    canvas.value.height = viewport.height
    canvas.value.style.width = `${displayWidth}px`
    canvas.value.style.height = `${displayHeight}px`

    const context = canvas.value.getContext('2d')
    if (!context) throw new Error('Canvas rendering is unavailable in this browser')
    await page.render({ canvasContext: context, viewport }).promise
    await pdf.destroy()
  } catch (e) {
    if (generation === renderGeneration) {
      error.value = (e as Error).message
    }
  } finally {
    if (generation === renderGeneration) loading.value = false
  }
}

onMounted(() => {
  mounted = true
  renderPdf()
})

watch(() => props.url, () => {
  if (mounted) renderPdf()
})

onBeforeUnmount(() => {
  renderGeneration++
})
</script>

<template>
  <div class="pdf-preview">
    <canvas ref="canvas" aria-label="First page of compiled PDF" />
    <span v-if="loading" class="pdf-preview-status">Rendering preview…</span>
    <span v-if="error" class="pdf-preview-status error">{{ error }}</span>
    <a :href="url" target="_blank" rel="noopener">Open PDF</a>
  </div>
</template>
