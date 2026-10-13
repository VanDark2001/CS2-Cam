<!-- 全局页头：提供主要业务页面导航和 Demo 解析入口。 -->
<script setup>
import { RouterLink, useRoute } from 'vue-router'
import EndfieldIcon from './EndfieldIcon.vue'
const route = useRoute()
const navigation = [
  { to: '/matches', icon: 'matches', label: '比赛', names: ['matches'] },
  { to: '/replay', icon: 'replay', label: '2D 回放', names: ['replay'] },
  { to: '/players', icon: 'players', label: '玩家', names: ['players', 'player-detail'] },
  { to: '/weapons', icon: 'weapons', label: '武器', names: ['weapons'] },
  { to: '/maps', icon: 'map', label: '地图', names: ['maps'] },
  { to: '/stats', icon: 'stats', label: '统计', names: ['stats'] },
  { to: '/favorites', icon: 'archive', label: 'POV 录制', names: ['favorites'] },
  { to: '/settings', icon: 'settings', label: '设置', names: ['settings'] },
]
</script>

<template>
  <header class="app-header">
    <RouterLink class="brand" to="/matches" aria-label="返回比赛记录"><span class="logo">⌁</span><div><b>CS2 <i>CAM</i></b><small>TACTICAL DATA TERMINAL</small></div></RouterLink>
    <nav aria-label="主导航">
      <RouterLink v-for="item in navigation" :key="item.to" :to="item.to"
        :class="{'router-link-active': item.names.includes(route.name)}"
        :aria-current="item.names.includes(route.name) ? 'page' : undefined">
        <EndfieldIcon :name="item.icon" />{{ item.label }}
      </RouterLink>
    </nav>
    <div class="header-meta"><span>LIVE / LOCAL DATA</span><RouterLink class="upload ef-button ef-button--primary" to="/parser"><EndfieldIcon name="upload" size="14" />解析 Demo</RouterLink></div>
  </header>
</template>

