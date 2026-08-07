<script setup lang="ts">
import QuickCompile from '~/components/QuickCompile.vue'
import OutputFormats from '~/components/OutputFormats.vue'
import FileUpload from '~/components/FileUpload.vue'
import MultiFile from '~/components/MultiFile.vue'
import DataBinding from '~/components/DataBinding.vue'
import AsyncStatus from '~/components/AsyncStatus.vue'
import BatchCompile from '~/components/BatchCompile.vue'
import AssetLibrary from '~/components/AssetLibrary.vue'
import Webhooks from '~/components/Webhooks.vue'

const { apiBase } = useApi()

const SECTIONS = [
  { key: 'quick', label: 'Quick Compile', component: QuickCompile },
  { key: 'formats', label: 'Output Formats', component: OutputFormats },
  { key: 'upload', label: 'File Upload', component: FileUpload },
  { key: 'multifile', label: 'Multi-file', component: MultiFile },
  { key: 'data', label: 'Data Binding', component: DataBinding },
  { key: 'async', label: 'Async + Status', component: AsyncStatus },
  { key: 'batch', label: 'Batch (SQS)', component: BatchCompile },
  { key: 'assets', label: 'Asset Library', component: AssetLibrary },
  { key: 'webhooks', label: 'Webhooks', component: Webhooks }
] as const

const active = ref<typeof SECTIONS[number]['key']>('quick')
</script>

<template>
  <div class="layout">
    <div class="header">
      <h1>typst-serverless demo</h1>
      <p>
        Every feature of the API, exercised live against
        <code>{{ apiBase || '(no API base configured)' }}</code>
      </p>
    </div>
    <div class="tabs">
      <button
        v-for="s in SECTIONS"
        :key="s.key"
        class="tab"
        :class="{ active: active === s.key }"
        @click="active = s.key"
      >
        {{ s.label }}
      </button>
    </div>
    <component :is="SECTIONS.find((s) => s.key === active)?.component" />
  </div>
</template>
