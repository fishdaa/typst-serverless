<script setup lang="ts">
import { BATCH_DOCS } from '~/utils/samples'
import { textToBase64 } from '~/utils/encoding'

const { compileBatch, getStatus } = useApi()

const docs = ref([...BATCH_DOCS])
const loading = ref(false)
const error = ref('')
const batchId = ref('')
const results = ref<Array<{ documentId: string; status: string; s3Url?: string; error?: string }>>([])
let pollHandle: ReturnType<typeof setInterval> | undefined

function stopPolling() {
  if (pollHandle) clearInterval(pollHandle)
  pollHandle = undefined
}

function allDone() {
  return results.value.length > 0 && results.value.every((r) => r.status === 'completed' || r.status === 'failed')
}

async function run() {
  loading.value = true
  error.value = ''
  results.value = []
  batchId.value = ''
  stopPolling()
  try {
    const enqueued = await compileBatch(
      docs.value.map((d) => ({ mainTyp: textToBase64(d), storeToS3: true })),
      { storeToS3: true }
    )
    batchId.value = enqueued.batchId
    results.value = enqueued.documentIds.map((id) => ({ documentId: id, status: 'pending' }))
    pollHandle = setInterval(async () => {
      const s = (await getStatus(enqueued.batchId)) as { results: typeof results.value }
      results.value = s.results
      if (allDone()) stopPolling()
    }, 1500)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onUnmounted(stopPolling)
</script>

<template>
  <div class="card">
    <h2>Batch Compile (SQS)</h2>
    <p class="desc">
      <code>POST /compile</code> with multiple <code>documents</code> and
      <code>storeToS3: true</code> enqueues each one to SQS and returns a
      <code>batchId</code> right away — poll <code>GET /status/{batchId}</code> for
      per-document results via the DynamoDB <code>batch_id</code> index.
    </p>
    <div class="row" style="margin-bottom: 10px">
      <button :disabled="loading" @click="run">{{ loading ? 'Enqueuing…' : `Compile ${docs.length} documents` }}</button>
      <span v-if="batchId" class="status-line muted">batchId: {{ batchId }}</span>
    </div>
    <div v-if="error" class="status-line error">{{ error }}</div>
    <table v-if="results.length">
      <thead>
        <tr><th>Document</th><th>Status</th><th>Result</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in results" :key="r.documentId">
          <td>{{ r.documentId }}</td>
          <td><span class="pill" :class="r.status">{{ r.status }}</span></td>
          <td>
            <a v-if="r.s3Url" :href="r.s3Url" target="_blank" rel="noopener">Download</a>
            <span v-else-if="r.error" class="status-line error">{{ r.error }}</span>
            <span v-else class="status-line muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
