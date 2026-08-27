/** Reference to an ephemeral, job-scoped presigned upload. */
export interface UploadRefValue {
  jobId: string
  name: string
}

export interface AssetRef {
  name: string
  base64?: string
  bucket?: string
  key?: string
  assetPath?: string
  uploadRef?: UploadRefValue
}

/** One signed direct-to-S3 PUT. `headers` are signed into the URL and must be echoed back. */
export interface PresignedUpload {
  uploadUrl: string
  contentType: string
  sizeBytes: number
  headers: Record<string, string>
  expiresAt?: string
}

/** Parallel direct-to-S3 PUTs per presign call. */
const UPLOAD_CONCURRENCY = 4

export interface CompileDoc {
  mainTyp?: string
  mainTypS3?: { bucket: string; key: string }
  mainTypAssetPath?: string
  mainTypUploadRef?: UploadRefValue
  main?: string
  extraTyps?: AssetRef[]
  documentId?: string
  data?: string | { bucket: string; key: string } | { assetPath: string } | { uploadRef: UploadRefValue }
  dataFile?: string
  fonts?: AssetRef[]
  assets?: AssetRef[]
  outputS3?: { bucket: string; keyPrefix?: string }
  outputKey?: string
  webhook?: { url: string }
  storeToS3?: boolean
  outputFormat?: 'pdf' | 'svg' | 'png'
  pdfStandard?: string
  /** Pixels per inch for PNG export (e.g. large-format posters). Typst default is 144. */
  ppi?: number
  /** Caps peak memory used while rendering a page to PNG, in mebibytes. */
  maxMemory?: number
  /** PNG compression effort. Defaults to high. */
  pngCompression?: 'no-compression' | 'fastest' | 'fast' | 'balanced' | 'high'
}

export interface CompileResult {
  documentId: string
  status: 'completed' | 'failed'
  pdf?: string
  format?: string
  s3Url?: string
  /** Size of the compiled output in bytes. */
  sizeBytes?: number
  error?: string
}

export interface BatchEnqueueResult {
  batchId: string
  documentIds: string[]
}

export interface StatusResult {
  documentId: string
  status: 'pending' | 'compiling' | 'completed' | 'failed'
  s3_key?: string
  s3Url?: string
  createdAt?: number
  updatedAt?: number
  error?: string
}

export interface BatchStatusResult {
  batchId: string
  results: Array<{ documentId: string; status: string; s3Url?: string; error?: string }>
}

export interface AssetEntry {
  assetPath: string
  size: number
  lastModified: string
}

export interface ApiError {
  error: string
}

function isApiError(body: unknown): body is ApiError {
    return !!body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)
}

export function useApi() {
    const apiBase = useRuntimeConfig().public.apiBase

    async function request<T>(path: string, init?: RequestInit): Promise<T> {
        const res = await fetch(`${apiBase}${path}`, init)
        const body = await res.json().catch(() => ({}))
        if (!res.ok || isApiError(body)) {
            throw new Error(isApiError(body) ? body.error : `Request failed (${res.status})`)
        }
        return body as T
    }

    function compile(doc: CompileDoc): Promise<CompileResult> {
        return request('/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: [doc] })
        })
    }

    function compileMultipart(form: FormData): Promise<CompileResult> {
        return request('/compile', { method: 'POST', body: form })
    }

    function compileBatch(
        docs: CompileDoc[],
        opts?: { storeToS3?: boolean; outputS3?: { bucket: string; keyPrefix?: string } }
    ): Promise<BatchEnqueueResult> {
        return request('/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: docs, ...opts })
        })
    }

    function getStatus(id: string): Promise<StatusResult | BatchStatusResult> {
        return request(`/status/${encodeURIComponent(id)}`)
    }

    function uploadAsset(input: {
    assetPath: string
    base64: string
    contentType?: string
  }): Promise<{ assetPath: string; size?: number }> {
        return request('/assets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        })
    }

    /** PUT a blob to a presigned URL, echoing back the headers that were signed into it. */
    async function putPresigned(upload: PresignedUpload, blob: Blob): Promise<void> {
        const res = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: upload.headers,
            body: blob
        })
        if (!res.ok) {
            throw new Error(`Direct S3 upload failed (${res.status}). The presigned URL may have expired.`)
        }
    }

    /** Run tasks with bounded concurrency so a large batch does not open N sockets at once. */
    async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
        const results = new Array<R>(items.length)
        let next = 0
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++
                const item = items[i]
                if (item === undefined) continue
                results[i] = await fn(item)
            }
        })
        await Promise.all(workers)
        return results
    }

    /**
   * Presign a direct-to-S3 PUT URL for a library asset, then upload the blob
   * straight to S3 — bypasses the API Gateway/Lambda payload limit for large
   * files (e.g. print-resolution poster backgrounds).
   *
   * Objects uploaded here persist in the asset library. For one-off compile
   * inputs use `uploadJobFiles`, whose keys are lifecycle-expired.
   */
    async function uploadAssetDirect(input: {
    assetPath: string
    blob: Blob
    contentType?: string
  }): Promise<{ assetPath: string }> {
        const contentType = input.contentType || input.blob.type || 'application/octet-stream'
        const upload = await request<PresignedUpload>('/assets/presign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetPath: input.assetPath, contentType, sizeBytes: input.blob.size })
        })
        await putPresigned(upload, input.blob)
        return { assetPath: input.assetPath }
    }

    /** Presign and upload several library assets, signing them all in one API call. */
    async function uploadAssetsDirect(
        inputs: Array<{ assetPath: string; blob: Blob; contentType?: string }>
    ): Promise<{ assetPaths: string[] }> {
        if (inputs.length === 0) return { assetPaths: [] }
        const { uploads } = await request<{ uploads: Array<PresignedUpload & { assetPath: string }> }>(
            '/assets/presign',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assets: inputs.map((i) => ({
                        assetPath: i.assetPath,
                        contentType: i.contentType || i.blob.type || 'application/octet-stream',
                        sizeBytes: i.blob.size
                    }))
                })
            }
        )
        const byPath = new Map(inputs.map((i) => [i.assetPath, i.blob]))
        await mapLimit(uploads, UPLOAD_CONCURRENCY, async (upload) => {
            const blob = byPath.get(upload.assetPath)
            if (!blob) throw new Error(`No blob for presigned asset ${upload.assetPath}`)
            await putPresigned(upload, blob)
        })
        return { assetPaths: uploads.map((u) => u.assetPath) }
    }

    /**
   * Presign and upload one-off compile inputs under a job id, in a single API
   * call, then hand back refs to pass to /compile or /batch. These keys are
   * expired by an S3 lifecycle rule, so demo runs don't fill the asset library.
   */
    async function uploadJobFiles(
        files: Array<{ name: string; blob: Blob; contentType?: string }>,
        jobId?: string
    ): Promise<{ jobId: string; refs: Record<string, UploadRefValue> }> {
        const { jobId: id, uploads } = await request<{
      jobId: string
      uploads: Array<PresignedUpload & { name: string; uploadRef: UploadRefValue }>
    }>('/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...(jobId && { jobId }),
            files: files.map((f) => ({
                name: f.name,
                contentType: f.contentType || f.blob.type || 'application/octet-stream',
                sizeBytes: f.blob.size
            }))
        })
    })
        const byName = new Map(files.map((f) => [f.name, f.blob]))
        await mapLimit(uploads, UPLOAD_CONCURRENCY, async (upload) => {
            const blob = byName.get(upload.name)
            if (!blob) throw new Error(`No blob for presigned upload ${upload.name}`)
            await putPresigned(upload, blob)
        })
        return {
            jobId: id,
            refs: Object.fromEntries(uploads.map((u) => [u.name, u.uploadRef]))
        }
    }

    function listAssets(prefix?: string): Promise<{ assets: AssetEntry[] }> {
        const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''
        return request(`/assets${qs}`)
    }

    function downloadAsset(assetPath: string): Promise<{ assetPath: string; downloadUrl: string }> {
        const encodedPath = assetPath.split('/').map(encodeURIComponent).join('/')
        return request(`/assets/download/${encodedPath}`)
    }

    function deleteAsset(assetPath: string): Promise<{ assetPath: string; deleted: boolean }> {
        const encodedPath = assetPath.split('/').map(encodeURIComponent).join('/')
        return request(`/assets/${encodedPath}`, { method: 'DELETE' })
    }

    return {
        apiBase,
        compile,
        compileMultipart,
        compileBatch,
        getStatus,
        uploadAsset,
        uploadAssetDirect,
        uploadAssetsDirect,
        uploadJobFiles,
        listAssets,
        downloadAsset,
        deleteAsset
    }
}
