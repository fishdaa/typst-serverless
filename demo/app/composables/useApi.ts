export interface AssetRef {
  name: string
  base64?: string
  bucket?: string
  key?: string
  assetPath?: string
}

export interface CompileDoc {
  mainTyp?: string
  mainTypS3?: { bucket: string; key: string }
  mainTypAssetPath?: string
  main?: string
  extraTyps?: AssetRef[]
  documentId?: string
  data?: string | { bucket: string; key: string } | { assetPath: string }
  dataFile?: string
  fonts?: AssetRef[]
  assets?: AssetRef[]
  outputS3?: { bucket: string; keyPrefix?: string }
  outputKey?: string
  webhook?: { url: string }
  storeToS3?: boolean
  outputFormat?: 'pdf' | 'svg' | 'png'
  pdfStandard?: string
}

export interface CompileResult {
  documentId: string
  status: 'completed' | 'failed'
  pdf?: string
  format?: string
  s3Url?: string
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
    return request('/compile', {
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

  function listAssets(prefix?: string): Promise<{ assets: AssetEntry[] }> {
    const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''
    return request(`/assets${qs}`)
  }

  function deleteAsset(assetPath: string): Promise<{ assetPath: string; deleted: boolean }> {
    const encodedPath = assetPath.split('/').map(encodeURIComponent).join('/')
    return request(`/assets/${encodedPath}`, { method: 'DELETE' })
  }

  return { apiBase, compile, compileMultipart, compileBatch, getStatus, uploadAsset, listAssets, deleteAsset }
}
