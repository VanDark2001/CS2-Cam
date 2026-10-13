<!-- 玩家头像：通过后端缓存接口加载，并在图片缺失时显示昵称首字母。 -->
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { avatarUrl, hideBrokenAvatar } from '../lib/presentation'
const refreshKey = ref(typeof window === 'undefined' ? '' : localStorage.getItem('cs2-avatar-refresh') || '')
const retries = ref(0)
const updateRefreshKey = () => { refreshKey.value = localStorage.getItem('cs2-avatar-refresh') || String(Date.now()); retries.value = 0 }
onMounted(() => window.addEventListener('cs2-avatars-refreshed', updateRefreshKey))
onUnmounted(() => window.removeEventListener('cs2-avatars-refreshed', updateRefreshKey))
const props = defineProps({ steamid: String, name: String })
const source = computed(() => avatarUrl(props.steamid, `${refreshKey.value}-${retries.value}`))
const onAvatarError = event => {
  if (retries.value < 3) { window.setTimeout(() => { retries.value += 1 }, 1500); return }
  hideBrokenAvatar(event)
}
</script>

<template><span class="avatar"><img :key="source" :src="source" :alt="props.name" @error="onAvatarError">{{ props.name?.slice(0,1) }}</span></template>
