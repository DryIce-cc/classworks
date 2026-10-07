<template>
  <v-snackbar
    v-model="snackbar"
    :color="colors[message?.type] || colors.info"
    :timeout="2000"
    location="top right"
    multi-line
    variant="tonal"
  >
    <div class="d-flex align-center">
      <v-icon :icon="icons[message?.type] || icons.info" class="mr-2" />
      <div>
        <div class="text-subtitle-2 font-weight-medium">
          {{ message?.title }}
        </div>
        <!-- 有就显示、淡入淡出走通用那套（styles/transitions.scss 的 .fade-*） -->
        <Transition name="fade">
          <div v-if="message?.content" class="text-body-2">
            {{ message?.content }}
          </div>
        </Transition>
      </div>
    </div>
    <template #actions>
      <v-btn icon="mdi-close" variant="text" @click="snackbar = false" />
    </template>
  </v-snackbar>
</template>

<script>
import { defineComponent, ref, nextTick } from 'vue'
import messageService from '@/utils/message'

export default defineComponent({
  name: 'GlobalMessage',
  setup() {
    const snackbar = ref(false)
    const message = ref(null)

    const icons = {
      success: 'mdi-check-circle',
      error: 'mdi-alert-circle',
      warning: 'mdi-alert',
      info: 'mdi-information',
    }

    const colors = {
      success: 'success',
      error: 'error',
      warning: 'warning',
      info: 'info',
    }

    // 新的消息到来时先收起当前这条，避免连点时高亮停在旧内容上
    messageService.onSnackbar(async (msg) => {
      if (!msg) return
      if (snackbar.value) {
        snackbar.value = false
        await nextTick()
      }
      message.value = msg
      snackbar.value = true
    })

    return { snackbar, message, icons, colors }
  },
})
</script>
