// 前端启动入口：注册路由、加载全局样式并挂载 Vue 应用。
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import './team.css'
import './endfield.css'
import './motion.css'
import './portfolio.css'
import './theme-palette.css'
import './theme.css'
import { startThemeClock } from './lib/theme'
const stopThemeClock = startThemeClock()
if (import.meta.hot) import.meta.hot.dispose(stopThemeClock)

createApp(App).use(router).mount('#app')

