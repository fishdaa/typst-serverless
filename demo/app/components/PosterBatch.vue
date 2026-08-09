<script setup lang="ts">
import { POSTER_SIZES, POSTER_BATCH_DATA, posterTyp, type PosterData } from '~/utils/samples'
import { textToBase64, base64ToBlobUrl } from '~/utils/encoding'
import { generatePosterBackground, generatePosterBackgroundSvg } from '~/utils/poster-background'
import type { AssetRef } from '~/composables/useApi'

const { compile, compileBatch, getStatus, uploadAssetDirect } = useApi()

const sizeKey = ref(POSTER_SIZES[0].key)
const size = computed(() => POSTER_SIZES.find((s) => s.key === sizeKey.value)!)
const ppi = ref(150)

// Caps typst's PNG render/encode memory to a fixed budget regardless of the
// poster's pixel dimensions (it renders in bands instead of the whole image
// at once) — keeps large-format exports within the Lambda's memory limit.
const MAX_MEMORY_MB = 512
// API Gateway HTTP APIs return after 30 seconds even though the Lambda timeout
// is longer. Warn before sending poster renders large enough to approach that limit.
const SYNC_WARNING_MP = 500

const pixelDims = computed(() => ({
  w: Math.round(size.value.widthIn * ppi.value),
  h: Math.round(size.value.heightIn * ppi.value)
}))
const megapixels = computed(() => ((pixelDims.value.w * pixelDims.value.h) / 1_000_000).toFixed(1))
const needsAsyncWarning = computed(() => (pixelDims.value.w * pixelDims.value.h) / 1_000_000 >= SYNC_WARNING_MP)
const backgroundExtension = computed(() => size.value.key === '2x5' ? 'png' : 'svg')

let logoBase64: string | undefined
async function loadLogo(): Promise<AssetRef> {
  if (!logoBase64) {
    const res = await fetch('/samples/logo.png')
    const buf = await res.arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte)
    logoBase64 = btoa(binary)
  }
  return { name: 'logo.png', base64: logoBase64 }
}

/**
 * The default 2 x 5 ft poster uses an exact-size PNG. Larger posters use a
 * resolution-independent SVG so the browser never allocates their print-sized
 * raster. Both assets are uploaded directly to S3 via a presigned URL.
 */
async function uploadBackground(accent: string): Promise<AssetRef> {
  const useSvg = size.value.key !== '2x5'
  const blob = useSvg
    ? generatePosterBackgroundSvg(pixelDims.value.w, pixelDims.value.h, accent)
    : await generatePosterBackground(pixelDims.value.w, pixelDims.value.h, accent)
  const extension = useSvg ? 'svg' : 'png'
  const contentType = useSvg ? 'image/svg+xml' : 'image/png'
  const assetPath = `demo/poster-bg-${crypto.randomUUID()}.${extension}`
  await uploadAssetDirect({ assetPath, blob, contentType })
  return { name: `background.${extension}`, assetPath }
}

// --- Single poster ---
const single = ref<PosterData>({ ...POSTER_BATCH_DATA[0] })
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')
const elapsedMs = ref(0)

async function runSingle() {
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  const started = performance.now()
  try {
    const logo = await loadLogo()
    const background = await uploadBackground(single.value.accent)
    const result = await compile({
      mainTyp: textToBase64(posterTyp(size.value, single.value, backgroundExtension.value)),
      outputFormat: 'png',
      ppi: ppi.value,
      maxMemory: MAX_MEMORY_MB,
      assets: [logo, background],
      storeToS3: true
    })
    elapsedMs.value = Math.round(performance.now() - started)
    if (result.s3Url) previewUrl.value = result.s3Url
    else if (result.pdf) previewUrl.value = base64ToBlobUrl(result.pdf, result.format)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// --- Dynamic batch ---
const rows = ref<PosterData[]>(POSTER_BATCH_DATA.map((d) => ({ ...d })))
const batchLoading = ref(false)
const batchError = ref('')
const batchId = ref('')
const results = ref<Array<{ documentId: string; status: string; s3Url?: string; error?: string }>>([])
const { start: startPolling, stop: stopPolling } = useBatchPolling()

function addRow() {
  rows.value.push({ title: `Booth ${rows.value.length + 1}`, subtitle: 'New exhibitor', accent: '#7c3aed' })
}
function removeRow(i: number) {
  rows.value.splice(i, 1)
}
async function runBatch() {
  batchLoading.value = true
  batchError.value = ''
  results.value = []
  batchId.value = ''
  stopPolling()
  try {
    const logo = await loadLogo()
    const docs = await Promise.all(rows.value.map(async (data) => ({
      mainTyp: textToBase64(posterTyp(size.value, data, backgroundExtension.value)),
      outputFormat: 'png' as const,
      ppi: ppi.value,
      maxMemory: MAX_MEMORY_MB,
      assets: [logo, await uploadBackground(data.accent)],
      storeToS3: true
    })))
    const enqueued = await compileBatch(docs, { storeToS3: true })
    batchId.value = enqueued.batchId
    results.value = enqueued.documentIds.map((id) => ({ documentId: id, status: 'pending' }))
    startPolling(
      () => getStatus(enqueued.batchId) as Promise<{ results: typeof results.value }>,
      (nextResults) => { results.value = nextResults },
      (pollError) => { batchError.value = pollError.message }
    )
  } catch (e) {
    batchError.value = (e as Error).message
  } finally {
    batchLoading.value = false
  }
}

</script>

<template>
  <div class="card">
    <h2>Large-Format Posters</h2>
    <p class="desc">
      Renders at true physical size (e.g. 24in x 60in) with a full-bleed
      background image generated in-browser with the poster's exact aspect ratio,
      then scaled and exported by Typst at print resolution — a multi-megapixel
      raster workload.
    </p>
    <div class="row" style="margin-bottom: 14px">
      <div>
        <label>Poster size</label>
        <select v-model="sizeKey" style="width: auto">
          <option v-for="s in POSTER_SIZES" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>
      <div>
        <label>PPI</label>
        <select v-model.number="ppi" style="width: auto">
          <option :value="72">72 (draft)</option>
          <option :value="150">150 (standard print)</option>
          <option :value="300">300 (high quality print)</option>
        </select>
      </div>
      <span class="status-line muted">
        {{ pixelDims.w }}&times;{{ pixelDims.h }}px (~{{ megapixels }} MP)
      </span>
    </div>
    <div v-if="needsAsyncWarning" class="status-line warning" role="alert">
      This is a large {{ megapixels }} MP render. The synchronous API request is
      limited to 30 seconds by API Gateway and may return 503 even if Lambda
      finishes successfully. Use <strong>Dynamic batch (SQS)</strong> below for
      asynchronous processing and status polling.
    </div>

    <h3>Single poster</h3>
    <div class="grid-2">
      <div>
        <label>Title</label>
        <input v-model="single.title" />
        <label style="margin-top: 8px">Subtitle</label>
        <input v-model="single.subtitle" />
        <label style="margin-top: 8px">Accent color</label>
        <input v-model="single.accent" type="color" style="width: auto" />
        <div class="row" style="margin-top: 10px">
          <button :disabled="loading" @click="runSingle">{{ loading ? 'Rendering…' : 'Generate poster PNG' }}</button>
          <span v-if="elapsedMs && !loading" class="status-line muted">{{ elapsedMs }}ms</span>
        </div>
        <div v-if="error" class="status-line error">{{ error }}</div>
      </div>
      <div>
        <label>Preview</label>
        <div class="preview">
          <img v-if="previewUrl" :src="previewUrl" style="max-height:340px;object-fit:contain" />
          <span v-else style="color:#888">No output yet</span>
        </div>
      </div>
    </div>

    <h3 style="margin-top: 20px">Dynamic batch (SQS)</h3>
    <p class="desc">
      Each row becomes its own poster at the same size/PPI, enqueued together via
      <code>POST /batch</code> with <code>storeToS3: true</code>.
    </p>
    <table>
      <thead>
        <tr><th>Title</th><th>Subtitle</th><th>Accent</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="i">
          <td><input v-model="row.title" /></td>
          <td><input v-model="row.subtitle" /></td>
          <td><input v-model="row.accent" type="color" style="width: auto" /></td>
          <td><button @click="removeRow(i)">Remove</button></td>
        </tr>
      </tbody>
    </table>
    <div class="row" style="margin: 10px 0">
      <button @click="addRow">+ Add poster</button>
      <button :disabled="batchLoading || !rows.length" @click="runBatch">
        {{ batchLoading ? 'Enqueuing…' : `Generate ${rows.length} posters` }}
      </button>
      <span v-if="batchId" class="status-line muted">batchId: {{ batchId }}</span>
    </div>
    <div v-if="batchError" class="status-line error">{{ batchError }}</div>
    <table v-if="results.length">
      <thead>
        <tr><th>Document</th><th>Status</th><th>Result</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in results" :key="r.documentId">
          <td>{{ r.documentId }}</td>
          <td><span class="pill" :class="r.status">{{ r.status }}</span></td>
          <td>
            <a v-if="r.s3Url" :href="r.s3Url" download rel="noopener">Download</a>
            <span v-else-if="r.error" class="status-line error">{{ r.error }}</span>
            <span v-else class="status-line muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
