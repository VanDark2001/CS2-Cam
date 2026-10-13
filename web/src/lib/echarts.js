// ECharts 按需注册与公共主题配置，减少各页面的重复导入和样式定义。
import { use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

export const axisStyle = {
  axisLine: { lineStyle: { color: '#364044' } },
  axisTick: { show: false },
  axisLabel: { color: '#899397' },
  splitLine: { lineStyle: { color: '#283034' } }
}

export const tooltipStyle = {
  backgroundColor: '#171c1f',
  borderColor: '#354044',
  textStyle: { color: '#e5e9ea' }
}

