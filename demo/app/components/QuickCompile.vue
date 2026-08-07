<script setup lang="ts">
import { SIMPLE_DOC } from '~/utils/samples'
import { textToBase64, base64ToBlobUrl } from '~/utils/encoding'

const { compile } = useApi()

const source = ref(SIMPLE_DOC)
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')

async function run() {
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  try {
    const result = await compile({ mainTyp: textToBase64(source.value) })
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
    <h2>Quick Compile</h2>
    <p class="desc">
      Edit Typst source and compile it to a PDF in one request — this is the simplest
      possible call: <code>POST /compile</code> with a base64 <code>mainTyp</code>.
    </p>
    <div class="grid-2">
      <div>
        <label>Typst source</label>
        <textarea v-model="source" />
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
