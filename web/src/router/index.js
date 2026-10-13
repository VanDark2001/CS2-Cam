// 前端路由表：所有业务页面共享 AppLayout，并使用懒加载控制首屏体积。
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'

// 页面组件按路由懒加载，首屏只下载当前页面所需代码。
const MatchesPage = () => import('../pages/MatchesPage.vue')
const PlayersPage = () => import('../pages/PlayersPage.vue')
const PlayerDetailPage = () => import('../pages/PlayerDetailPage.vue')
const WeaponsPage = () => import('../pages/WeaponsPage.vue')
const MapsPage = () => import('../pages/MapsPage.vue')
const StatsPage = () => import('../pages/StatsPage.vue')
const ParserPage = () => import('../pages/ParserPage.vue')
const ReplayPage = () => import('../pages/ReplayPage.vue')
const FavoritesPage = () => import('../pages/FavoritesPage.vue')
const SettingsPage = () => import('../pages/SettingsPage.vue')
const PortfolioPage = () => import('../pages/PortfolioPage.vue')

const router = createRouter({
  // file:// cannot serve clean history URLs after a navigation. Keep clean
  // URLs in the browser and use a hash history only for the desktop shell.
  history: typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? createWebHashHistory()
    : createWebHistory(),
  routes: [{
    path: '/',
    component: AppLayout,
    children: [
      { path: '', redirect: '/matches' },
      { path: 'matches/:id?', name: 'matches', component: MatchesPage },
      { path: 'players', name: 'players', component: PlayersPage },
      { path: 'players/:steamid', name: 'player-detail', component: PlayerDetailPage },
      { path: 'weapons', name: 'weapons', component: WeaponsPage },
      { path: 'maps', name: 'maps', component: MapsPage },
      { path: 'stats', name: 'stats', component: StatsPage },
      { path: 'parser', name: 'parser', component: ParserPage },
      { path: 'replay/:id?', name: 'replay', component: ReplayPage }
      ,{ path: 'favorites', name: 'favorites', component: FavoritesPage }
      ,{ path: 'settings', name: 'settings', component: SettingsPage },
      { path: 'portfolio', name: 'portfolio', component: PortfolioPage }
    ]
  }],
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || false
  }
})

export default router


