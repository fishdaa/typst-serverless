<script setup lang="ts">
import { ASSET_DOC } from '~/utils/samples'
import { fileToBase64, textToBase64, base64ToBlobUrl } from '~/utils/encoding'
import type { AssetEntry } from '~/composables/useApi'

const { uploadAsset, listAssets, deleteAsset, compile } = useApi()

const assets = ref<AssetEntry[]>([])
const assetPath = ref('demo/logo.png')
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref('')
const compilePath = ref('demo/logo.png')
const previewUrl = ref('')

async function refresh() {
  const res = await listAssets('demo/')
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
    <h2>Asset Library</h2>
    <p class="desc">
      Upload reusable files to a shared cache keyed by <code>assetPath</code>, list and
      delete them via <code>/assets</code>, then reference one by path in a compile
      instead of re-sending its bytes.
    </p>
    <div class="grid-2">
      <div>
        <label>Asset path</label>
        <input v-model="assetPath" type="text">
        <label>File</label>
        <input type="file" @change="onFilePicked">
        <div class="row" style="margin-top: 10px">
          <button class="secondary" @click="useSampleLogo">Use sample logo</button>
          <button :disabled="busy || !file" @click="upload">Upload</button>
        </div>
        <div v-if="error" class="status-line error">{{ error }}</div>
        <table v-if="assets.length">
          <thead><tr><th>Path</th><th>Size</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in assets" :key="a.assetPath">
              <td>{{ a.assetPath }}</td>
              <td>{{ a.size }} B</td>
              <td><button class="secondary" :disabled="busy" @click="remove(a.assetPath)">Delete</button></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="status-line muted">No assets under demo/ yet</div>
      </div>
      <div>
        <label>Compile using an asset by path</label>
        <input v-model="compilePath" type="text">
        <div class="row" style="margin-top: 10px">
          <button :disabled="busy" @click="compileWithAsset">Compile with this asset</button>
        </div>
        <div class="preview" style="margin-top: 10px">
          <iframe v-if="previewUrl" :src="previewUrl" />
          <span v-else style="color:#888">No PDF yet</span>
        </div>
      </div>
    </div>
  </div>
</template>
