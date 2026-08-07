<script setup lang="ts">
import { OUTPUT_FORMATS_DOC } from '~/utils/samples'
import { textToBase64, base64ToBlobUrl } from '~/utils/encoding'

const { compile } = useApi()

const source = ref(OUTPUT_FORMATS_DOC)
const outputFormat = ref<'pdf' | 'svg' | 'png'>('pdf')
const pdfStandard = ref('')
const loading = ref(false)
const error = ref('')
const previewUrl = ref('')
const previewKind = ref<'pdf' | 'svg' | 'png'>('pdf')

const PDF_STANDARDS = ['', '1.4', '1.5', '1.6', '1.7', 'a-2b', 'a-3b']

async function run() {
  loading.value = true
  error.value = ''
  previewUrl.value = ''
  try {
    const result = await compile({
      mainTyp: textToBase64(source.value),
      outputFormat: outputFormat.value,
      ...(outputFormat.value === 'pdf' && pdfStandard.value && { pdfStandard: pdfStandard.value })
    })
    if (result.pdf) {
      previewKind.value = (result.format as 'pdf' | 'svg' | 'png') || 'pdf'
      previewUrl.value = base64ToBlobUrl(result.pdf, result.format)
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="card">
    <h2>Output Formats &amp; PDF Standards</h2>
    <p class="desc">
      Same source, different <code>outputFormat</code> (pdf/svg/png) and, for PDF, an
      optional <code>pdfStandard</code> (e.g. PDF/A-2b for archival compliance).
    </p>
    <div class="grid-2">
      <div>
        <label>Typst source</label>
        <textarea v-model="source" />
        <div class="row" style="margin-top: 10px">
          <select v-model="outputFormat" style="width: auto">
            <option value="pdf">pdf</option>
            <option value="svg">svg</option>
            <option value="png">png</option>
          </select>
          <select v-if="outputFormat === 'pdf'" v-model="pdfStandard" style="width: auto">
            <option v-for="s in PDF_STANDARDS" :key="s" :value="s">{{ s || 'default' }}</option>
          </select>
          <button :disabled="loading" @click="run">{{ loading ? 'Compiling…' : 'Compile' }}</button>
        </div>
        <div v-if="error" class="status-line error">{{ error }}</div>
      </div>
      <div>
        <label>Preview</label>
        <div class="preview">
          <iframe v-if="previewUrl && previewKind === 'pdf'" :src="previewUrl" />
          <img v-else-if="previewUrl" :src="previewUrl" style="max-height:340px;object-fit:contain" />
          <span v-else style="color:#888">No output yet</span>
        </div>
      </div>
    </div>
  </div>
</template>
