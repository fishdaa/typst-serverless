<script setup lang="ts">
import {
  POSTER_SIZES,
  CAMPAIGN_POSTER_DATA,
  campaignPosterTyp,
  type CampaignPosterData,
  type PosterSize
} from '~/utils/samples'
import { textToBase64 } from '~/utils/encoding'
import { formatBytes } from '~/utils/format'
import { generatePosterBackground } from '~/utils/poster-background'
import type { AssetRef, CompileDoc } from '~/composables/useApi'

const { compileBatch, getStatus, uploadAssetsDirect, listAssets, deleteAsset } = useApi()

// Caps typst's PNG render/encode memory regardless of the poster's pixel
// dimensions — same budget the Posters tab uses.
const MAX_MEMORY_MB = 512
// API Gateway caps a request body at 10MB; base64 inflates bytes by ~33%.
const REST_BODY_LIMIT = 10 * 1024 * 1024
/** Where campaign caches live in the asset library. */
const CACHE_PREFIX = 'campaign/'
/** Objects that make up one cached campaign. */
const CACHE_FILES = ['template.typ', 'background.png', 'logo.png'] as const

const sizeKey = ref(POSTER_SIZES[1]!.key)
const size = computed(() => POSTER_SIZES.find((s) => s.key === sizeKey.value)!)
const longEdge = ref(4000)
const ppi = ref(72)
const pngCompression = ref<'no-compression' | 'fastest' | 'fast' | 'balanced' | 'high'>('fastest')

/**
 * Pixel size of the background raster. It is deliberately decoupled from the
 * poster's print resolution: the background is a bounded, reusable raster that
 * Typst rescales to the page, so a 3ft x 4ft poster at 300 PPI does not need a
 * 130-megapixel canvas allocated in the browser.
 */
const backgroundDims = computed(() => {
  const { widthIn, heightIn } = size.value
  const scale = longEdge.value / Math.max(widthIn, heightIn)
  return { w: Math.round(widthIn * scale), h: Math.round(heightIn * scale) }
})
const pageDims = computed(() => ({
  w: Math.round(size.value.widthIn * ppi.value),
  h: Math.round(size.value.heightIn * ppi.value)
}))
const pageMegapixels = computed(() => ((pageDims.value.w * pageDims.value.h) / 1_000_000).toFixed(1))

interface CachedCampaign {
  id: string
  sizeKey: string
  longEdge: number
  backgroundBytes: number
  templateBytes: number
  logoBytes: number
  adopted: boolean
}

const cache = ref<CachedCampaign | null>(null)
const staging = ref(false)
const stageError = ref('')
const stageLog = ref<string[]>([])

/** The cache is bound to the page geometry it was built for. */
const cacheStale = computed(
  () => !!cache.value && (cache.value.sizeKey !== sizeKey.value || cache.value.longEdge !== longEdge.value)
)
function assetPathFor(id: string, name: string) {
  return `${CACHE_PREFIX}${id}/${name}`
}

let logoBlob: Blob | null = null
async function loadLogo(): Promise<Blob> {
  if (!logoBlob) logoBlob = await (await fetch('/samples/logo.png')).blob()
  return logoBlob
}

/**
 * Uploads the three shared inputs once, straight to S3 through a single
 * `POST /assets/presign` call. They land under `assets/` — the persistent
 * namespace — so they survive this page load and are reused by every
 * subsequent batch until deleted.
 */
async function stageCache() {
  staging.value = true
  stageError.value = ''
  stageLog.value = []
  cache.value = null
  try {
    const id = `${sizeKey.value}-${longEdge.value}-${crypto.randomUUID().slice(0, 8)}`
    const { w, h } = backgroundDims.value

    stageLog.value.push(`Rendering a ${w}x${h}px background in the browser…`)
    const background = await generatePosterBackground(w, h, '#0f172a')
    const template = new Blob([campaignPosterTyp(size.value)], { type: 'text/plain' })
    const logo = await loadLogo()
    stageLog.value.push(
      `background.png is ${formatBytes(background.size)} — ${formatBytes(
        Math.round(background.size * 1.34)
      )} base64-encoded.`
    )

    stageLog.value.push('POST /assets/presign — 3 signed PUT URLs in one call…')
    await uploadAssetsDirect([
      { assetPath: assetPathFor(id, 'template.typ'), blob: template, contentType: 'text/plain' },
      { assetPath: assetPathFor(id, 'background.png'), blob: background, contentType: 'image/png' },
      { assetPath: assetPathFor(id, 'logo.png'), blob: logo, contentType: 'image/png' }
    ])
    stageLog.value.push('Uploaded directly to S3 — the bytes never passed through the API.')

    cache.value = {
      id,
      sizeKey: sizeKey.value,
      longEdge: longEdge.value,
      backgroundBytes: background.size,
      templateBytes: template.size,
      logoBytes: logo.size,
      adopted: false
    }
    await refreshCached()
  } catch (e) {
    stageError.value = (e as Error).message
  } finally {
    staging.value = false
  }
}

// --- Existing caches in the library ---
interface CacheEntry {
  id: string
  sizeKey: string
  longEdge: number
  bytes: number
  complete: boolean
}
const cached = ref<CacheEntry[]>([])
const listing = ref(false)
const listError = ref('')

/**
 * Groups `assets/campaign/<id>/*` back into campaigns. The geometry is encoded
 * in the id, so a cache staged in an earlier session can be adopted without
 * re-uploading anything.
 */
async function refreshCached() {
  listing.value = true
  listError.value = ''
  try {
    const { assets } = await listAssets(CACHE_PREFIX)
    const groups = new Map<string, { bytes: number; names: Set<string> }>()
    for (const a of assets) {
      const rest = a.assetPath.slice(CACHE_PREFIX.length)
      const slash = rest.indexOf('/')
      if (slash <= 0) continue
      const id = rest.slice(0, slash)
      const group = groups.get(id) || { bytes: 0, names: new Set<string>() }
      group.bytes += a.size
      group.names.add(rest.slice(slash + 1))
      groups.set(id, group)
    }
    cached.value = [...groups.entries()]
      .map(([id, group]) => {
        const [key, edge] = id.split('-')
        return {
          id,
          sizeKey: POSTER_SIZES.some((s) => s.key === key) ? key! : '',
          longEdge: Number(edge) || 0,
          bytes: group.bytes,
          complete: CACHE_FILES.every((f) => group.names.has(f))
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch (e) {
    listError.value = (e as Error).message
  } finally {
    listing.value = false
  }
}

/** Reuses a cache already in the library — no upload, no background render. */
function adopt(entry: CacheEntry) {
  if (entry.sizeKey) sizeKey.value = entry.sizeKey
  if (entry.longEdge) longEdge.value = entry.longEdge
  cache.value = {
    id: entry.id,
    sizeKey: entry.sizeKey || sizeKey.value,
    longEdge: entry.longEdge || longEdge.value,
    backgroundBytes: 0,
    templateBytes: 0,
    logoBytes: 0,
    adopted: true
  }
  stageError.value = ''
  stageLog.value = [`Adopted ${entry.id} from the library (${formatBytes(entry.bytes)}) — nothing uploaded.`]
}

async function evict(entry: CacheEntry) {
  listError.value = ''
  try {
    for (const name of CACHE_FILES) {
      await deleteAsset(assetPathFor(entry.id, name)).catch(() => undefined)
    }
    if (cache.value?.id === entry.id) cache.value = null
    await refreshCached()
  } catch (e) {
    listError.value = (e as Error).message
  }
}

// --- Dynamic content per poster ---
const rows = ref<CampaignPosterData[]>(CAMPAIGN_POSTER_DATA.map((d) => ({ ...d })))
const batchLoading = ref(false)
const batchError = ref('')
const batchId = ref('')
const results = ref<Array<{ documentId: string; status: string; s3Url?: string; error?: string }>>([])
const { start: startPolling, stop: stopPolling } = useBatchPolling()

function addRow() {
  rows.value.push({
    title: `Track ${rows.value.length + 1}`,
    subtitle: 'New session',
    tagline: 'Details to follow',
    booth: `E${rows.value.length + 1}`,
    accent: '#7c3aed'
  })
}
function removeRow(i: number) {
  rows.value.splice(i, 1)
}

/** One document: three cached references plus this poster's own JSON. */
function docFor(data: CampaignPosterData, current: CachedCampaign): CompileDoc {
  const assets: AssetRef[] = [
    { name: 'background.png', assetPath: assetPathFor(current.id, 'background.png') },
    { name: 'logo.png', assetPath: assetPathFor(current.id, 'logo.png') }
  ]
  return {
    mainTypAssetPath: assetPathFor(current.id, 'template.typ'),
    data: textToBase64(JSON.stringify(data)),
    dataFile: 'poster.json',
    assets,
    outputFormat: 'png',
    ppi: ppi.value,
    maxMemory: MAX_MEMORY_MB,
    pngCompression: pngCompression.value,
    storeToS3: true
  }
}

const docPreview = computed(() => {
  const current = cache.value
  const first = rows.value[0]
  if (!current || !first) return ''
  return JSON.stringify(docFor(first, current), null, 2)
})

/** What the same batch would cost if the shared inputs went inline as base64. */
const payloadComparison = computed(() => {
  const current = cache.value
  const first = rows.value[0]
  if (!current || !first) return null
  const perDoc = JSON.stringify(docFor(first, current)).length
  const cachedTotal = perDoc * rows.value.length
  const sharedBytes = current.backgroundBytes + current.templateBytes + current.logoBytes
  if (!sharedBytes) return { cachedTotal, inlineTotal: 0, perDoc, exceeds: false }
  const inlineTotal = Math.round(sharedBytes * 1.34 * rows.value.length) + cachedTotal
  return { cachedTotal, inlineTotal, perDoc, exceeds: inlineTotal > REST_BODY_LIMIT }
})

async function runBatch() {
  const current = cache.value
  if (!current) return
  batchLoading.value = true
  batchError.value = ''
  results.value = []
  batchId.value = ''
  stopPolling()
  try {
    const enqueued = await compileBatch(
      rows.value.map((data) => docFor(data, current)),
      { storeToS3: true }
    )
    batchId.value = enqueued.batchId
    if (!Array.isArray(enqueued.documentIds)) {
      throw new Error('Batch response did not include document IDs')
    }
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

onMounted(refreshCached)
onBeforeUnmount(stopPolling)

function sizeLabel(key: string): string {
  return POSTER_SIZES.find((s: PosterSize) => s.key === key)?.label || key
}
</script>

<template>
  <div class="card">
    <h2>Cached Campaign Posters</h2>
    <p class="desc">
      The heavy inputs — a multi-megabyte background PNG, the logo, and the poster
      template itself — are presigned and uploaded <strong>once</strong> to the
      persistent asset library, then referenced by <code>assetPath</code> from every
      compile. Each poster's own content travels as a few hundred bytes of JSON bound
      in as <code>poster.json</code>, so the whole campaign is enqueued asynchronously
      through <code>POST /batch</code> with no image bytes in the request at all.
    </p>

    <h3>1. Stage the cache</h3>
    <div class="row" style="margin-bottom: 10px">
      <div>
        <label>Poster size</label>
        <select v-model="sizeKey" style="width: auto">
          <option v-for="s in POSTER_SIZES" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>
      <div>
        <label>Background raster (long edge)</label>
        <select v-model.number="longEdge" style="width: auto">
          <option :value="2000">2000px</option>
          <option :value="4000">4000px</option>
          <option :value="6000">6000px</option>
        </select>
      </div>
      <span class="status-line muted">
        background {{ backgroundDims.w }}&times;{{ backgroundDims.h }}px, rescaled by Typst to
        {{ pageDims.w }}&times;{{ pageDims.h }}px (~{{ pageMegapixels }} MP) at export
      </span>
    </div>
    <div class="row" style="margin-bottom: 10px">
      <button :disabled="staging" @click="stageCache">
        {{ staging ? 'Uploading…' : cache && !cacheStale ? 'Re-stage cache' : 'Render + presign + upload' }}
      </button>
      <button class="secondary" :disabled="listing" @click="refreshCached">
        {{ listing ? 'Listing…' : 'Refresh library' }}
      </button>
    </div>
    <div v-if="stageLog.length" class="cache-log">
      <div v-for="(line, i) in stageLog" :key="i">{{ line }}</div>
    </div>
    <div v-if="stageError" class="status-line error">{{ stageError }}</div>
    <div v-if="cache && !cacheStale" class="status-line muted">
      Cache <code>{{ cache.id }}</code> ready
      <template v-if="cache.backgroundBytes">
        &middot; background {{ formatBytes(cache.backgroundBytes) }}
      </template>
      <template v-else> &middot; reused from the library</template>
    </div>
    <div v-if="cacheStale" class="status-line warning" role="alert">
      The staged cache was built for {{ sizeLabel(cache!.sizeKey) }} at {{ cache!.longEdge }}px. The
      template hard-codes the page geometry, so re-stage before enqueuing at the new size.
    </div>

    <div v-if="cached.length" style="margin-top: 12px">
      <label>Caches in the asset library (<code>assets/campaign/</code>)</label>
      <table>
        <thead>
          <tr><th>Cache</th><th>Size</th><th>Bytes</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in cached" :key="entry.id">
            <td><code>{{ entry.id }}</code></td>
            <td>{{ entry.sizeKey ? sizeLabel(entry.sizeKey) : '—' }}</td>
            <td>{{ formatBytes(entry.bytes) }}</td>
            <td>
              <button
                :disabled="!entry.complete || cache?.id === entry.id"
                @click="adopt(entry)"
              >
                {{ cache?.id === entry.id ? 'In use' : entry.complete ? 'Reuse' : 'Incomplete' }}
              </button>
              <button class="secondary" @click="evict(entry)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="helper">
        These persist until deleted — that is the difference from
        <code>POST /uploads</code>, whose keys an S3 lifecycle rule expires after a day.
      </p>
    </div>
    <div v-if="listError" class="status-line error">{{ listError }}</div>

    <h3 style="margin-top: 20px">2. Dynamic content per poster</h3>
    <p class="desc">
      Every row below compiles the same cached template against its own
      <code>poster.json</code>. Nothing here is interpolated into Typst source
      client-side — the template calls <code>json("poster.json")</code>.
    </p>
    <div class="row" style="margin-bottom: 10px">
      <div>
        <label>PPI</label>
        <select v-model.number="ppi" style="width: auto">
          <option :value="72">72 (draft)</option>
          <option :value="150">150 (standard print)</option>
          <option :value="300">300 (high quality print)</option>
        </select>
      </div>
      <div>
        <label>PNG compression</label>
        <select v-model="pngCompression" style="width: auto">
          <option value="no-compression">None (fastest)</option>
          <option value="fastest">Fastest (recommended)</option>
          <option value="fast">Fast</option>
          <option value="balanced">Balanced</option>
          <option value="high">High (smallest file)</option>
        </select>
      </div>
    </div>
    <table>
      <thead>
        <tr><th>Title</th><th>Subtitle</th><th>Tagline</th><th>Booth</th><th>Accent</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="i">
          <td><input v-model="row.title" /></td>
          <td><input v-model="row.subtitle" /></td>
          <td><input v-model="row.tagline" /></td>
          <td><input v-model="row.booth" style="width: 80px" /></td>
          <td><input v-model="row.accent" type="color" style="width: auto" /></td>
          <td><button @click="removeRow(i)">Remove</button></td>
        </tr>
      </tbody>
    </table>
    <div class="row" style="margin: 10px 0">
      <button @click="addRow">+ Add poster</button>
      <button :disabled="batchLoading || !rows.length || !cache || cacheStale" @click="runBatch">
        {{ batchLoading ? 'Enqueuing…' : `Enqueue ${rows.length} posters` }}
      </button>
      <span v-if="!cache" class="status-line muted">Stage or reuse a cache first.</span>
      <span v-if="batchId" class="status-line muted">batchId: {{ batchId }}</span>
    </div>

    <div v-if="payloadComparison" class="status-line muted">
      Request body: {{ formatBytes(payloadComparison.cachedTotal) }} for
      {{ rows.length }} posters ({{ payloadComparison.perDoc }} B per document).
      <template v-if="payloadComparison.inlineTotal">
        Inlining the shared inputs as base64 instead would send
        {{ formatBytes(payloadComparison.inlineTotal) }}<template v-if="payloadComparison.exceeds">
          — past API Gateway's 10MB body limit</template>.
      </template>
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

    <details v-if="docPreview" style="margin-top: 16px">
      <summary class="helper">Document sent for the first poster</summary>
      <pre class="doc-preview">{{ docPreview }}</pre>
    </details>
  </div>
</template>

<style scoped>
.cache-log {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 3px solid #7c3aed;
  background: rgba(127, 127, 140, 0.08);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.doc-preview {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(127, 127, 140, 0.08);
  font-size: 12px;
  overflow-x: auto;
}
</style>
