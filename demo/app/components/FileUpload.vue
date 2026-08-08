<script setup lang="ts">
import { base64ToBlobUrl } from '~/utils/encoding'

const { compileMultipart } = useApi()

const DEFAULT_MAIN = `#set page(width: 260pt, height: 200pt, margin: 14pt)
#set text(font: "Roboto", size: 12pt)

= Uploaded via multipart
#figure(
  image("logo.png", width: 48pt),
  caption: [Uploaded as a file part]
)

This heading uses a custom font uploaded in the same request.
`

const assetFile = ref<File | null>(null)
const fontFile = ref<File | null>(null)
const mainText = ref(DEFAULT_MAIN)
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')

function onAssetPicked(e: Event) {
  assetFile.value = (e.target as HTMLInputElement).files?.[0] || null
}
function onFontPicked(e: Event) {
  fontFile.value = (e.target as HTMLInputElement).files?.[0] || null
}

async function useSampleAssets() {
  const [logoRes, fontRes] = await Promise.all([
    fetch('/samples/logo.png'),
    fetch('/samples/Roboto-Bold.ttf')
  ])
  assetFile.value = new File([await logoRes.blob()], 'logo.png', { type: 'image/png' })
  fontFile.value = new File([await fontRes.blob()], 'Roboto.ttf', { type: 'font/ttf' })
}

onMounted(() => {
  useSampleAssets()
})

async function run() {
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  try {
    const form = new FormData()
    const mainBlob = new Blob([mainText.value], { type: 'text/plain' })
    form.append('main', mainBlob, 'main.typ')
    if (assetFile.value) form.append('asset', assetFile.value, assetFile.value.name)
    if (fontFile.value) form.append('font', fontFile.value, fontFile.value.name)
    const result = await compileMultipart(form)
    if (result.pdf) previewUrl.value = base64ToBlobUrl(result.pdf, result.format)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="card">
    <h2>File Upload (multipart)</h2>
    <p class="desc">
      <code>POST /compile</code> as <code>multipart/form-data</code> with a <code>main</code>
      .typ part plus <code>asset</code>/<code>font</code> file parts — no base64 encoding
      required on the client.
    </p>
    <div class="grid-2">
      <div>
        <label>main.typ</label>
        <textarea v-model="mainText" />
        <label>Image asset (optional)</label>
        <input type="file" accept="image/*" @change="onAssetPicked">
        <label>Font file (optional)</label>
        <input type="file" @change="onFontPicked">
        <div class="row" style="margin-top: 10px">
          <button class="secondary" @click="useSampleAssets">Use sample logo + font</button>
          <button :disabled="loading" @click="run">{{ loading ? 'Compiling…' : 'Compile' }}</button>
        </div>
        <div v-if="assetFile || fontFile" class="status-line muted">
          {{ assetFile?.name }} {{ fontFile?.name }}
        </div>
        <div v-if="error" class="status-line error">{{ error }}</div>
      </div>
      <div>
        <label>Preview</label>
        <div class="preview">
          <iframe v-if="previewUrl" :src="previewUrl" />
          <span v-else style="color:#888">No PDF yet</span>
        </div>
      </div>
    </div>
  </div>
</template>
