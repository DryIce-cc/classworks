<template>
  <v-container class="dev-editor pa-4" fluid>
    <v-card border>
      <v-card-title class="text-subtitle-1">HomeworkEditor（DEV 自查页）</v-card-title>
      <v-card-text>
        <homework-editor
          ref="editorRef"
          :model-value="value"
          @update:model-value="value = $event"
          @selection-change="selection = $event"
        />
        <div class="d-flex ga-2 mt-4">
          <v-btn size="small" variant="tonal" @click="editorRef?.focus()">聚焦</v-btn>
          <v-btn size="small" variant="tonal" @click="loadSample">塞一段示例正文</v-btn>
          <v-btn size="small" variant="tonal" @click="value = ''">清空</v-btn>
          <v-btn size="small" variant="tonal" @click="logSelection">读选区</v-btn>
        </div>
        <div class="mt-4">
          <div class="text-caption text-medium-emphasis mb-1">
            存储文本（content，编号和 # 都在里面）
          </div>
          <pre class="dev-content">{{ value }}</pre>
        </div>
        <div class="mt-2 text-caption text-medium-emphasis">
          选区：{{ selection.from }} … {{ selection.to }}（anchor {{ selection.anchor }} / head {{ selection.head }}）
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref } from 'vue'
import HomeworkEditor from '@/components/HomeworkEditor.vue'

const editorRef = ref(null)
const value = ref('')
const selection = ref({ anchor: 0, head: 0, from: 0, to: 0, empty: true })

function loadSample() {
  value.value = '1. 订正\n2. 默写\n\n#明天的作业\n小白\n'
}

function logSelection() {
  console.log('selection', editorRef.value?.getSelection())
}
</script>

<style scoped>
.dev-content {
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(127, 127, 127, 0.1);
  padding: 8px;
  border-radius: 4px;
  min-height: 3em;
}
</style>
