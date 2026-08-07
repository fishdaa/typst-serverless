<script setup lang="ts">
import { DATA_BINDING_DOC, DATA_BINDING_JSON } from '~/utils/samples'
import { textToBase64, base64ToBlobUrl } from '~/utils/encoding'

const { compile } = useApi()

const template = ref(DATA_BINDING_DOC)
const data = ref(DATA_BINDING_JSON)
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')

async function run() {
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  try {
    JSON.parse(data.value) // client-side sanity check before sending
    const result = await compile({
      mainTyp: textToBase64(template.value),
      data: textToBase64(data.value),
      dataFile: 'data.json'
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
    <h2>Data Binding</h2>
    <p class="desc">
      Bind JSON into a template with Typst's <code>json()</code>, sent via
      <code>data</code> (base64) + <code>dataFile: "data.json"</code>.
    </p>
    <div class="grid-2">
      <div>
        <label>Template (reads data.json)</label>
        <textarea v-model="template" style="min-height: 120px" />
        <label>data.json</label>
        <textarea v-model="data" style="min-height: 100px" />
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
