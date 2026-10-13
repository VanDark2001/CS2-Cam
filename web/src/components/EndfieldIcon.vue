<!-- 终末地工业 HUD 线性图标：统一尺寸、描边和 hover 反馈，避免页面散落字符图标。 -->
<script setup>
defineProps({
  name: { type: String, default: 'grid' },
  size: { type: [Number, String], default: 16 },
  label: { type: String, default: '' }
})
</script>

<template>
  <svg class="ef-icon" :class="`ef-icon-${name}`" :width="size" :height="size" viewBox="0 0 24 24" fill="none" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'" role="img">
    <path v-if="name==='crosshair'" d="M12 2v5m0 10v5M2 12h5m10 0h5M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM12 11v2" />
    <path v-else-if="name==='skull'" d="M8 20h8v-4l3-2V9a7 7 0 0 0-14 0v5l3 2v4ZM8 9h2v2H8Zm6 0h2v2h-2Zm-3 5 1-2 1 2m-3 3v3m4-3v3" />
    <path v-else-if="name==='grid'" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    <path v-else-if="name==='matches'" d="M4 7h16M4 12h11M4 17h16M18 10l2 2-2 2" />
    <path v-else-if="name==='replay'" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm5 4v8l6-4-6-4Z" />
    <path v-else-if="name==='players'" d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2.5 2.5 0 1 0 0-5M3 20a5 5 0 0 1 10 0M15 14a4 4 0 0 1 6 3" />
    <path v-else-if="name==='weapons'" d="m5 19 9-9m-5 5 3 3m-1-11 4-4 4 4-4 4M4 20h5" />
    <path v-else-if="name==='map'" d="m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2V6Zm5-2v14m6-12v14" />
    <path v-else-if="name==='stats'" d="M5 19V9m7 10V5m7 14v-7M3 20h18" />
    <path v-else-if="name==='archive'" d="M4 7h16v13H4zM3 4h18v3H3zM9 12h6" />
    <path v-else-if="name==='settings'" d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm0-5.2 1 2.1 2.2.6 1.9-1.1 1.8 1.8-1.1 1.9.6 2.2 2.1 1v2.5l-2.1 1-.6 2.2 1.1 1.9-1.8 1.8-1.9-1.1-2.2.6-1 2.1H9.5l-1-2.1-2.2-.6-1.9 1.1-1.8-1.8 1.1-1.9-.6-2.2-2.1-1v-2.5l2.1-1 .6-2.2-1.1-1.9 1.8-1.8 1.9 1.1 2.2-.6 1-2.1H12Z" />
    <path v-else-if="name==='remove'" d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
    <path v-else-if="name==='upload'" d="M12 16V4m0 0L8 8m4-4 4 4M5 14v5h14v-5" />
    <path v-else-if="name==='download'" d="M12 4v12m0 0 4-4m-4 4-4-4M5 14v5h14v-5" />
    <path v-else-if="name==='edit'" d="m14 5 5 5M4 20l4-1L20 7l-5-5L3 14l1 6Z" />
    <path v-else-if="name==='video'" d="M3 6h12v12H3zM15 10l6-4v12l-6-4" />
    <path v-else-if="name==='play'" d="M8 5v14l11-7L8 5Z" />
    <path v-else-if="name==='pause'" d="M7 5v14M17 5v14" />
    <path v-else-if="name==='previous'" d="M18 5v14L7 12l11-7ZM5 5v14" />
    <path v-else-if="name==='next'" d="M6 5v14l11-7L6 5Zm13 0v14" />
    <path v-else-if="name==='chevron'" d="m9 5 7 7-7 7" />
    <path v-else-if="name==='pulse'" d="M3 12h4l2-6 4 12 2-6h6" />
    <path v-else-if="name==='buy'" d="M3 5h2l2.1 10.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L20 9H7M10 21a1 1 0 1 0 0-.01M17 21a1 1 0 1 0 0-.01" />
    <path v-else d="M4 4h16v16H4zM8 8h8v8H8z" />
  </svg>
</template>

<style scoped>
.ef-icon{display:inline-block;flex:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:square;stroke-linejoin:miter;vertical-align:-.18em;transition:color .15s ease}.ef-icon path{vector-effect:non-scaling-stroke}
</style>
