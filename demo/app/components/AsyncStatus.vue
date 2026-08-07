<script setup lang="ts">
import { SIMPLE_DOC } from '~/utils/samples'
import { textToBase64 } from '~/utils/encoding'

const { compile, getStatus } = useApi()

const source = ref(SIMPLE_DOC)
const loading = ref(false)
const error = ref('')
const documentId = ref('')
const status = ref('')
const s3Url = ref('')
let pollHandle: ReturnType<typeof setInterval> | undefined

function stopPolling() {
  if (pollHandle) clearInterval(pollHandle)
  pollHandle = undefined
}

async function run() {
  loading.value = true
  error.value = ''
  status.value = ''
  s3Url.value = ''
  documentId.value = ''
  stopPolling()
  try {
    const result = await compile({ mainTyp: textToBase64(source.value), storeToS3: true })
    documentId.value = result.documentId
    status.value = result.status
    if (result.s3Url) s3Url.value = result.s3Url
    if (result.status !== 'completed' && result.status !== 'failed') {
      pollHandle = setInterval(async () => {
        const s = await getStatus(result.documentId) as { status: string; s3Url?: string }
        status.value = s.status
        if (s.s3Url) s3Url.value = s.s3Url
        if (s.status === 'completed' || s.status === 'failed') stopPolling()
      }, 1500)
    }
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
    <h2>Async Compile + Status Polling</h2>
    <p class="desc">
      Compile with <code>storeToS3: true</code>, get back a <code>documentId</code>
      immediately, then poll <code>GET /status/{id}</code> until it's <code>completed</code>.
    </p>
    <div class="grid-2">
      <div>
        <label>Typst source</label>
        <textarea v-model="source" />
        <div class="row" style="margin-top: 10px">
          <button :disabled="loading" @click="run">{{ loading ? 'Submitting…' : 'Compile (storeToS3)' }}</button>
        </div>
        <div v-if="error" class="status-line error">{{ error }}</div>
      </div>
      <div>
        <label>Status</label>
        <div v-if="documentId">
          <div class="row">
            <span class="pill" :class="status">{{ status || '…' }}</span>
            <span class="status-line muted">{{ documentId }}</span>
          </div>
          <div v-if="s3Url" style="margin-top: 12px">
            <a :href="s3Url" target="_blank" rel="noopener">Download from S3 (presigned URL)</a>
          </div>
        </div>
        <div v-else class="status-line muted">No submission yet</div>
      </div>
    </div>
  </div>
</template>
