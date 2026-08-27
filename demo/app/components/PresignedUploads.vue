<script setup lang="ts">
import { textToBase64, base64ToBlobUrl } from '~/utils/encoding'
import { formatBytes } from '~/utils/format'
import { generatePosterBackground } from '~/utils/poster-background'
import type { AssetRef, UploadRefValue } from '~/composables/useApi'

const { compile, uploadAssetsDirect, uploadJobFiles, listAssets, deleteAsset, apiBase } = useApi()

// API Gateway caps a request body at 10MB and base64 inflates bytes by ~33%,
// so anything past a few MB has to go straight to S3 instead of through the body.
const REST_BODY_LIMIT = 10 * 1024 * 1024

const DOC = `#set page(width: 300pt, height: 200pt, margin: 16pt)
#set text(size: 11pt)

= Compiled from a presigned upload
#image("background.png", width: 100%)
`

type StepState = 'pending' | 'running' | 'done' | 'failed'
interface Step {
  label: string
  detail: string
  state: StepState
}

const file = ref<File | null>(null)
const generating = ref(false)
const busy = ref(false)
const error = ref('')
const previewUrl = ref('')
const steps = ref<Step[]>([])

const sizeLabel = computed(() => (file.value ? formatBytes(file.value.size) : ''))
const exceedsBodyLimit = computed(() => !!file.value && file.value.size * 1.34 > REST_BODY_LIMIT)

function reset() {
  error.value = ''
  previewUrl.value = ''
  steps.value = []
}

function addStep(label: string): Step {
  const step: Step = { label, detail: '', state: 'running' }
  steps.value = [...steps.value, step]
  return step
}

function finish(step: Step, detail: string, state: StepState = 'done') {
  step.detail = detail
  step.state = state
  steps.value = [...steps.value]
}

function onFilePicked(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] || null
  reset()
}

/** Builds a multi-megabyte PNG in the browser so the size limits are easy to hit. */
async function generateLarge() {
  generating.value = true
  reset()
  try {
    const blob = await generatePosterBackground(3000, 2400, '#7c3aed')
    file.value = new File([blob], 'background.png', { type: 'image/png' })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    generating.value = false
  }
}

async function useSampleLogo() {
  reset()
  const res = await fetch('/samples/logo.png')
  file.value = new File([await res.blob()], 'background.png', { type: 'image/png' })
}

/** Renders a signed URL compactly — the signature itself is noise here. */
function summarizeUrl(url: string): string {
  const [base] = url.split('?')
  return `${base} + signature (expires with the URL)`
}

/**
 * Ephemeral path: POST /uploads mints a jobId, the client PUTs straight to S3,
 * then /compile references each object by { jobId, name }. These keys are
 * expired by an S3 lifecycle rule, so one-off inputs never reach the library.
 */
async function runJobUpload() {
  if (!file.value) return
  busy.value = true
  reset()
  const picked = file.value
  try {
    const presign = addStep('POST /uploads')
    const { jobId, refs } = await uploadJobFiles([
      { name: 'main.typ', blob: new Blob([DOC], { type: 'text/plain' }), contentType: 'text/plain' },
      { name: 'background.png', blob: picked, contentType: picked.type || 'image/png' }
    ])
    finish(presign, `jobId ${jobId} — 2 URLs signed in one call`)

    const put = addStep('PUT direct to S3')
    finish(put, `main.typ + background.png (${formatBytes(picked.size)}) uploaded, bypassing the API entirely`)

    const mainRef = refs['main.typ']
    const bgRef = refs['background.png']
    if (!mainRef || !bgRef) throw new Error('Presign response was missing an upload ref')

    const compileStep = addStep('POST /compile with uploadRef')
    const result = await compile({
      mainTypUploadRef: mainRef as UploadRefValue,
      assets: [{ name: 'background.png', uploadRef: bgRef } as AssetRef]
    })
    finish(compileStep, `status ${result.status} — request body carried refs, not bytes`)
    if (result.pdf) previewUrl.value = base64ToBlobUrl(result.pdf, result.format)
  } catch (e) {
    const failed = steps.value[steps.value.length - 1]
    if (failed) finish(failed, (e as Error).message, 'failed')
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

/**
 * Persistent path: POST /assets/presign signs uploads into the asset library,
 * which never expires — for logos, fonts and templates reused across jobs.
 */
async function runLibraryUpload() {
  if (!file.value) return
  busy.value = true
  reset()
  const picked = file.value
  const assetPath = `demo/presigned-${crypto.randomUUID()}.png`
  try {
    const presign = addStep('POST /assets/presign')
    await uploadAssetsDirect([{ assetPath, blob: picked, contentType: picked.type || 'image/png' }])
    finish(presign, `signed + PUT to assets/${assetPath}`)

    const listStep = addStep('GET /assets')
    const { assets } = await listAssets('demo/')
    const stored = assets.find((a) => a.assetPath === assetPath)
    finish(listStep, stored ? `listed at ${formatBytes(stored.size)} — persists until deleted` : 'not listed yet')

    const compileStep = addStep('POST /compile with assetPath')
    const result = await compile({
      mainTyp: textToBase64(DOC),
      assets: [{ name: 'background.png', assetPath }]
    })
    finish(compileStep, `status ${result.status}`)
    if (result.pdf) previewUrl.value = base64ToBlobUrl(result.pdf, result.format)

    const cleanup = addStep('DELETE /assets/{path}')
    await deleteAsset(assetPath)
    finish(cleanup, 'demo asset removed so the library stays tidy')
  } catch (e) {
    const failed = steps.value[steps.value.length - 1]
    if (failed) finish(failed, (e as Error).message, 'failed')
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

/**
 * Presign, deliberately skip the PUT, then compile: every referenced object is
 * HEAD-checked first, so this is a 400 naming the missing key rather than a 500
 * from deep inside input resolution.
 */
async function runMissingUpload() {
  busy.value = true
  reset()
  try {
    const presign = addStep('POST /uploads (then skip the PUT)')
    const res = await fetch(`${apiBase}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ name: 'main.typ', contentType: 'text/plain', sizeBytes: DOC.length }]
      })
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `Presign failed (${res.status})`)
    finish(presign, `jobId ${body.jobId} — URL signed, nothing uploaded`)

    const compileStep = addStep('POST /compile with the unused ref')
    try {
      await compile({ mainTypUploadRef: { jobId: body.jobId, name: 'main.typ' } })
      finish(compileStep, 'unexpectedly succeeded', 'failed')
    } catch (e) {
      finish(compileStep, `400 — ${(e as Error).message}`)
    }
  } catch (e) {
    const failed = steps.value[steps.value.length - 1]
    if (failed) finish(failed, (e as Error).message, 'failed')
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="card">
    <h2>Presigned Uploads</h2>
    <p class="desc">
      Request bodies are capped at 10MB by API Gateway, 6MB for a sync Lambda invoke and
      <strong>256KB</strong> for an async one — and base64 inflates bytes by ~33%. Presigning moves
      the bytes straight from the client to S3 and sends only a reference in the compile request.
      It is optional: small inputs can still go inline as base64 or multipart.
    </p>

    <div class="row" style="margin-bottom: 14px">
      <div>
        <label for="presign-file">File to upload</label>
        <input id="presign-file" type="file" @change="onFilePicked">
      </div>
      <button class="secondary" :disabled="generating || busy" @click="generateLarge">
        {{ generating ? 'Generating…' : 'Generate a large PNG' }}
      </button>
      <button class="secondary" :disabled="busy" @click="useSampleLogo">Use sample logo</button>
    </div>
    <div v-if="file" class="status-line" :class="exceedsBodyLimit ? 'warning' : 'muted'">
      <strong>{{ file.name }}</strong> — {{ sizeLabel }}.
      {{
        exceedsBodyLimit
          ? 'Base64-encoded, this would exceed the 10MB request limit: presigning is the only way through.'
          : 'Small enough to send inline, but presigning works the same at any size.'
      }}
    </div>

    <div class="grid-2" style="margin-top: 14px">
      <div>
        <h3>Ephemeral job upload</h3>
        <p class="helper">
          <code>POST /uploads</code> → <code>uploads/&lt;jobId&gt;/&lt;name&gt;</code>, expired by an
          S3 lifecycle rule. One call signs every file for the job; refs go to
          <code>/compile</code> or <code>/batch</code> unchanged.
        </p>
        <button :disabled="busy || !file" @click="runJobUpload">Presign, upload, compile</button>
      </div>
      <div>
        <h3>Persistent library asset</h3>
        <p class="helper">
          <code>POST /assets/presign</code> → <code>assets/&lt;assetPath&gt;</code>, kept until you
          delete it. For logos, fonts and templates reused across many jobs.
        </p>
        <button :disabled="busy || !file" @click="runLibraryUpload">Presign, upload, compile</button>
      </div>
    </div>

    <div class="row" style="margin-top: 14px">
      <button class="secondary" :disabled="busy" @click="runMissingUpload">
        Show the missing-upload error
      </button>
      <span class="status-line muted">
        Compiles a ref whose PUT never happened — a 400 naming the absent key, checked before any
        work starts (on <code>/batch</code>, before anything is enqueued).
      </span>
    </div>

    <div v-if="steps.length" class="presign-steps">
      <div v-for="(step, i) in steps" :key="i" class="presign-step" :class="step.state">
        <span class="presign-step-label">{{ step.label }}</span>
        <span class="presign-step-detail">{{ step.detail || '…' }}</span>
      </div>
    </div>
    <div v-if="error" class="status-line error">{{ error }}</div>

    <div v-if="previewUrl" style="margin-top: 14px">
      <label>Preview</label>
      <div class="preview">
        <iframe :src="previewUrl" title="Compiled PDF preview" />
      </div>
    </div>

    <p class="helper" style="margin-top: 16px">
      <code>contentType</code> and <code>sizeBytes</code> are required on both presign endpoints:
      they are signed into the URL, so a leaked URL can only write that content type at that exact
      byte length. The response returns the <code>headers</code> to echo back on the
      <code>PUT</code> — they are part of the signature.
    </p>
  </div>
</template>

<style scoped>
.presign-steps {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.presign-step {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 8px 10px;
  border-radius: 6px;
  border-left: 3px solid #d0d0d8;
  background: rgba(127, 127, 140, 0.08);
  font-size: 13px;
}
.presign-step.running {
  border-left-color: #7c3aed;
}
.presign-step.done {
  border-left-color: #16a34a;
}
.presign-step.failed {
  border-left-color: #dc2626;
}
.presign-step-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  white-space: nowrap;
}
.presign-step-detail {
  color: #666;
  word-break: break-word;
}
</style>
