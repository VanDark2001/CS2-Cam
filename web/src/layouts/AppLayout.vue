<!-- 主布局：组合固定页头、跨页面解析进度和当前子路由页面。 -->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppHeader from '../components/AppHeader.vue'
import ParserProgress from '../components/ParserProgress.vue'
import { observeScrollMotion } from '../lib/motion'

const route = useRoute()
const appRoot = ref(null)
let stopScrollMotion = () => {}

async function refreshScrollMotion() {
  await nextTick()
  stopScrollMotion()
  stopScrollMotion = observeScrollMotion(appRoot.value)
}

onMounted(refreshScrollMotion)
watch(() => route.fullPath, refreshScrollMotion)
onBeforeUnmount(() => stopScrollMotion())
</script>

<template>
  <div ref="appRoot" class="app">
    <AppHeader />
    <ParserProgress />
    <RouterView v-slot="{ Component, route }">
      <Transition name="page" mode="out-in" appear>
        <!-- Keep the page instance when only route params change (for example
             switching /matches/:id).  The match detail pane owns that local
             transition, so the sidebar and header must stay stationary. -->
        <component :is="Component" :key="route.name || route.path" />
      </Transition>
    </RouterView>
  </div>
</template>
