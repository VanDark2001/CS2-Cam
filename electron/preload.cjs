const { contextBridge, ipcRenderer } = require('electron')
const argument = process.argv.find(value => value.startsWith('--csdemo-api-port='))
const port = Number(argument?.split('=')[1])
if (Number.isInteger(port) && port > 0 && port <= 65535) {
  const desktop = { apiBase: `http://127.0.0.1:${port}/api` }
  if (ipcRenderer) desktop.settings = Object.freeze({
    get: () => ipcRenderer.invoke('settings:get'),
    setRecording: (key, value) => ipcRenderer.invoke('settings:set-recording', key, value),
    choosePath: key => ipcRenderer.invoke('settings:choose-path', key),
    installTools: key => ipcRenderer.invoke('settings:install-tools', key),
    openRecordingCfg: () => ipcRenderer.invoke('settings:open-recording-cfg'),
  })
  if(ipcRenderer)desktop.updates=Object.freeze({
    get:()=>ipcRenderer.invoke('updates:state'),
    check:()=>ipcRenderer.invoke('updates:check'),
    setAutoCheck:enabled=>ipcRenderer.invoke('updates:auto-check',enabled),
    install:()=>ipcRenderer.invoke('updates:install'),
    openLink:key=>ipcRenderer.invoke('updates:open-link',key),
    subscribe:callback=>{const handler=(_event,state)=>callback(state);ipcRenderer.on('updates:changed',handler);return()=>ipcRenderer.removeListener('updates:changed',handler)},
  })
  contextBridge.exposeInMainWorld('csdemoDesktop', Object.freeze(desktop))
}
