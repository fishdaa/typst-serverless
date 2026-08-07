<script setup lang="ts">
import { WEBHOOK_DOC } from '~/utils/samples'
import { textToBase64 } from '~/utils/encoding'

const { compile } = useApi()

const webhookUrl = ref('https://webhook.site/')
const loading = ref(false)
const error = ref('')
const sent = ref(false)

async function run() {
  loading.value = true
  error.value = ''
  sent.value = false
  try {
    await compile({ mainTyp: textToBase64(WEBHOOK_DOC), webhook: { url: webhookUrl.value } })
    sent.value = true
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="card">
    <h2>Webhooks</h2>
    <p class="desc">
      Attach a <code>webhook: { url }</code> to any compile and the Lambda fires a
      fire-and-forget POST to it when the job finishes — <code>{ documentId, status,
      pdf, format }</code> on success, or <code>{ documentId, status: "failed", error
      }</code> on failure. Get a free inspectable URL at
      <a href="https://webhook.site" target="_blank" rel="noopener">webhook.site</a>
      to see it land in real time.
    </p>
    <label>Webhook URL</label>
    <input v-model="webhookUrl" type="url">
    <div class="row" style="margin-top: 10px">
      <button :disabled="loading" @click="run">{{ loading ? 'Sending…' : 'Compile with webhook' }}</button>
    </div>
    <div v-if="error" class="status-line error">{{ error }}</div>
    <div v-if="sent" class="status-line success">
      Compile submitted — check your webhook receiver for the delivered payload.
    </div>
  </div>
</template>
