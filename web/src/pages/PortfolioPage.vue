<script setup>
import { RouterLink } from 'vue-router'

const capabilityCards = [
  { code: '01', title: '比赛档案', text: '把 Demo 解析成可追溯的比赛、回合、阵容与比分记录。', tags: ['MATCH INDEX', 'ROUND LOG'] },
  { code: '02', title: '战术回放', text: '用 2D 雷达、事件时间轴和 POV 视角还原每一个关键回合。', tags: ['2D REPLAY', 'POV SYNC'] },
  { code: '03', title: '玩家画像', text: '跨场聚合 SteamID，解释阵营差异、地图池与关键能力。', tags: ['PLAYER PROFILE', 'WE / RATING'] },
  { code: '04', title: '数据洞察', text: '围绕地图、武器、高光与残局，快速发现可复盘的模式。', tags: ['MAP META', 'CLUTCH'] }
]

const workflow = [
  { step: '01', title: '导入 Demo', text: '批量上传本地录制，任务队列清楚区分等待、解析、成功与失败。' },
  { step: '02', title: '建立档案', text: '正式回合、队伍、玩家和事件写入 SQLite，保留原始语义与来源。' },
  { step: '03', title: '复盘决策', text: '从比赛索引进入数据面板，再用回放与个人画像定位下一步。' }
]
</script>

<template>
  <main class="portfolio-page">
    <section class="portfolio-hero">
      <div class="portfolio-hero-copy">
        <div class="eyebrow">PROJECT PORTFOLIO / 2026</div>
        <h1>把一场 Demo，<br><em>变成可读的比赛档案。</em></h1>
        <p class="portfolio-lede">CS2 Demo Show 是一个本地优先的比赛分析终端。它把原始 Demo 转译成比赛记录、战术回放与玩家长期表现，让复盘从“记得发生过”变成“知道为什么”。</p>
        <div class="portfolio-actions">
          <RouterLink to="/matches" class="ef-button ef-button--primary">查看比赛档案 <span aria-hidden="true">↗</span></RouterLink>
          <RouterLink to="/stats" class="ef-button ef-button--accent">浏览统计面板</RouterLink>
        </div>
        <div class="portfolio-proof"><span class="proof-dot"></span><span>LOCAL-FIRST / SQLITE SOURCE OF TRUTH</span><span class="proof-line"></span><span>DESKTOP READY</span></div>
      </div>
      <div class="portfolio-hero-terminal" aria-label="产品界面摘要">
        <div class="terminal-top"><span>CS2_CAM / LIVE SESSION</span><span>SYS 01</span></div>
        <div class="terminal-score"><div><small>LAST ANALYZED</small><strong>ANCIENT</strong><span>2026.10.08 / 23:41</span></div><b>13<small>:</small>9</b></div>
        <div class="terminal-bars"><div><span>ROUND CONTROL</span><i><em style="width:78%"></em></i><b>78%</b></div><div><span>CT ECONOMY</span><i><em style="width:62%"></em></i><b>62%</b></div><div><span>CLUTCH RATE</span><i><em style="width:34%"></em></i><b>34%</b></div></div>
        <div class="terminal-foot"><span>5 PLAYERS</span><span>24 ROUNDS</span><span>6 HIGHLIGHTS</span></div>
      </div>
    </section>

    <section class="portfolio-section portfolio-intro">
      <div class="section-kicker">THE WORK / 01</div>
      <div><h2>一个围绕“证据”设计的复盘工具。</h2><p>作品集不只展示界面，也展示我如何把复杂领域规则压缩成清晰的下一步。所有核心统计来自 SQLite；队伍、正式回合、阵营和玩家身份都保留可解释的来源。</p></div>
    </section>

    <section class="portfolio-capabilities">
      <article v-for="card in capabilityCards" :key="card.code" class="portfolio-capability"><span class="cap-code">{{ card.code }}</span><div><h3>{{ card.title }}</h3><p>{{ card.text }}</p><div class="cap-tags"><span v-for="tag in card.tags" :key="tag">{{ tag }}</span></div></div><span class="cap-arrow" aria-hidden="true">↗</span></article>
    </section>

    <section class="portfolio-section portfolio-split">
      <div><div class="section-kicker">THE FLOW / 02</div><h2>从原始文件，到下一次决策。</h2><p>每一步都对应一个明确的用户动作：导入、验证、解释、复盘。状态和异常始终可见，数据不完整时也不会伪装成 0。</p><RouterLink to="/parser" class="text-link">查看解析队列 <span>→</span></RouterLink></div>
      <div class="workflow-list"><article v-for="item in workflow" :key="item.step"><span>{{ item.step }}</span><div><h3>{{ item.title }}</h3><p>{{ item.text }}</p></div></article></div>
    </section>

    <section class="portfolio-proof-grid">
      <div class="proof-panel proof-panel-large"><div class="section-kicker">SIGNATURE DETAIL / 03</div><h2>一条回合时间线，<br>装下整场比赛的节奏。</h2><div class="round-visual"><span v-for="(round, index) in 18" :key="index" :class="['round-block', index % 5 === 0 ? 'round-ct' : index % 3 === 0 ? 'round-neutral' : 'round-t']"></span></div><div class="round-legend"><span><i class="legend-ct"></i> CT 胜</span><span><i class="legend-t"></i> T 胜</span><span><i class="legend-neutral"></i> 未记录</span></div></div>
      <div class="proof-panel"><div class="section-kicker">CRAFT / 04</div><h2>克制的 HUD，<br>服务于阅读。</h2><p>碳黑底、细线框和黄绿色状态线建立层级；阵营色只表达阵营，品牌色只表达操作与状态。</p><div class="craft-swatches"><span class="swatch swatch-bg"></span><span class="swatch swatch-surface"></span><span class="swatch swatch-brand"></span><span class="swatch swatch-text"></span></div></div>
    </section>

    <section class="portfolio-cta"><div><div class="section-kicker">NEXT SCREEN / 05</div><h2>准备好进入一场比赛了吗？</h2><p>从比赛索引开始，沿着真实数据一路走到回放。</p></div><RouterLink to="/matches" class="ef-button ef-button--primary">进入 CS2 CAM <span aria-hidden="true">↗</span></RouterLink></section>
  </main>
</template>
