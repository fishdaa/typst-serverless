<script setup lang="ts">
import { MULTI_FILE_MAIN, MULTI_FILE_EXTRA } from '~/utils/samples'
import { textToBase64, base64ToBlobUrl } from '~/utils/encoding'

const { compile } = useApi()

const main = ref(MULTI_FILE_MAIN)
const extra = ref(MULTI_FILE_EXTRA)
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')

async function run() {
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  try {
    const result = await compile({
      mainTyp: textToBase64(main.value),
      extraTyps: [{ name: 'helpers.typ', base64: textToBase64(extra.value) }]
    })
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
    <h2>Multi-file Project (#import)</h2>
    <p class="desc">
      Compile a main document that imports a second .typ file, sent alongside it via
      <code>extraTyps: [{ name, base64 }]</code>.
    </p>
    <div class="grid-2">
      <div>
        <label>main.typ</label>
        <textarea v-model="main" style="min-height: 120px" />
        <label>helpers.typ (extraTyps[0])</label>
        <textarea v-model="extra" style="min-height: 100px" />
        <div class="row" style="margin-top: 10px">
          <button :disabled="loading" @click="run">{{ loading ? 'Compiling…' : 'Compile' }}</button>
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
