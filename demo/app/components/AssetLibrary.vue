<script setup lang="ts">
import { ASSET_DOC } from '~/utils/samples'
import { fileToBase64, textToBase64, base64ToBlobUrl } from '~/utils/encoding'
import type { AssetEntry } from '~/composables/useApi'

const { uploadAsset, listAssets, downloadAsset, deleteAsset, compile } = useApi()

const assets = ref<AssetEntry[]>([])
const assetPath = ref('demo/logo.png')
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref('')
const compilePath = ref('demo/logo.png')
const previewUrl = ref('')

const assetCountLabel = computed(() => `${assets.value.length} ${assets.value.length === 1 ? 'asset' : 'assets'}`)

function formatBytes(bytes: number) {
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

async function refresh() {
  const res = await listAssets()
  assets.value = res.assets
}

function onFilePicked(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null
}

async function useSampleLogo() {
  const res = await fetch('/samples/logo.png')
  file.value = new File([await res.blob()], 'logo.png', { type: 'image/png' })
}

async function upload() {
  if (!file.value) return
  busy.value = true
  error.value = ''
  try {
    const base64 = await fileToBase64(file.value)
    await uploadAsset({ assetPath: assetPath.value, base64, contentType: file.value.type })
    await refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function remove(path: string) {
  busy.value = true
  error.value = ''
  try {
    await deleteAsset(path)
    await refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function download(path: string) {
  busy.value = true
  error.value = ''
  try {
    const { downloadUrl } = await downloadAsset(path)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = path.split('/').pop() || 'asset'
    link.target = '_blank'
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function compileWithAsset() {
  busy.value = true
  error.value = ''
  previewUrl.value = ''
  try {
    const result = await compile({
      mainTyp: textToBase64(ASSET_DOC),
      assets: [{ name: 'logo.png', assetPath: compilePath.value }]
    })
    if (result.pdf) previewUrl.value = base64ToBlobUrl(result.pdf, result.format)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="card">
    <div class="asset-heading">
      <div>
        <h2>Asset Library</h2>
        <p class="desc">
          Keep reusable images and files here so you can reference them by path without uploading them again.
        </p>
      </div>
      <span v-if="assets.length" class="pill">{{ assetCountLabel }}</span>
    </div>
    <div class="grid-2">
      <div class="asset-panel">
        <h3>Upload a file</h3>
        <p class="helper">Choose a friendly path for this reusable asset.</p>
        <label for="asset-path">Asset path</label>
        <input id="asset-path" v-model="assetPath" type="text" placeholder="demo/logo.png">
        <label for="asset-file">File</label>
        <input id="asset-file" type="file" @change="onFilePicked">
        <div v-if="file" class="selected-file">Selected: <strong>{{ file.name }}</strong></div>
        <div class="row upload-actions">
          <button class="secondary" :disabled="busy" @click="useSampleLogo">Use sample logo</button>
          <button :disabled="busy || !file || !assetPath" @click="upload">Upload file</button>
        </div>
        <div v-if="error" class="status-line error">{{ error }}</div>
      </div>
      <div class="asset-panel compile-panel">
        <h3>Use an asset</h3>
        <p class="helper">Compile a sample document using an asset already in the library.</p>
        <label for="compile-path">Asset path</label>
        <input id="compile-path" v-model="compilePath" type="text" placeholder="demo/logo.png">
        <div class="row upload-actions">
          <button :disabled="busy || !compilePath" @click="compileWithAsset">Compile with this asset</button>
        </div>
        <div class="preview">
          <iframe v-if="previewUrl" :src="previewUrl" title="Compiled PDF preview" />
          <span v-else class="muted">Your PDF preview will appear here</span>
        </div>
      </div>
    </div>
    <div class="asset-list">
      <div class="asset-list-heading">
        <div>
          <h3>Stored assets</h3>
          <p class="helper">All cached assets</p>
        </div>
        <button class="secondary refresh-button" :disabled="busy" @click="refresh">Refresh</button>
      </div>
      <table v-if="assets.length">
        <thead><tr><th>Asset</th><th>Size</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="a in assets" :key="a.assetPath">
            <td class="asset-path" :title="a.assetPath">{{ a.assetPath }}</td>
            <td class="asset-size">{{ formatBytes(a.size) }}</td>
            <td class="asset-action">
              <button class="secondary" :disabled="busy" @click="download(a.assetPath)">Download</button>
              <button class="secondary" :disabled="busy" @click="remove(a.assetPath)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-state">
        <span class="empty-icon">◌</span>
        <strong>No assets yet</strong>
        <span class="muted">Upload a file above to see it here.</span>
      </div>
    </div>
  </div>
</template>
