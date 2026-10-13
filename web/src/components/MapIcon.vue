<!-- 地图图标：按地图代码读取本地资源，加载失败时退化为首字母。 -->
<script setup>
import { computed, ref } from 'vue'
import { assetUrl } from '../lib/presentation'

const props = defineProps({ map: { type: String, default: '' }, label: { type: String, default: '' } })
const failed = ref(false)
const normalized = computed(() => String(props.map || '').toLowerCase().replace(/[^a-z0-9_]/g, ''))
const fallback = computed(() => (props.label || normalized.value.replace('de_', '') || '?').slice(0, 1))
</script>

<template>
  <span class="map-icon" :title="label || normalized">
    <img v-if="normalized && !failed" :src="assetUrl(`/maps/${normalized}.png`)" :alt="label || normalized" @error="failed=true">
    <b v-else>{{ fallback }}</b>
  </span>
</template>
