const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const { execute, readJson, writeJson } = require('./portable-runtime.cjs')
const config = require('./release-config.json')
async function githubFetch(url,options) {
  // Keep the desktop proxy when it works; a throttled proxy must not make a
  // public release inaccessible when a verified direct HTTPS route works.
  if(process.versions.electron){
    try{
      const response=await require('electron').net.fetch(url,options)
      if(![403,429,500,502,503,504].includes(response.status))return response
      await response.body?.cancel()
    }catch(error){if(options?.signal?.aborted)throw error}
  }
  return fetch(url,options)
}

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''))
  if (!match) throw new Error('版本号必须为稳定版本，例如 v0.1.0')
  return match.slice(1).map(Number)
}
function newerVersion(candidate, current) {
  const a=versionParts(candidate), b=versionParts(current)
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i]}
  return false
}
function releaseAssets(release) {
  const version=versionParts(release.tag_name).join('.')
  const name=`CS2-Cam-${version}-win-x64.zip`
  const zip=release.assets?.find(asset=>asset.name===name)
  const checksum=release.assets?.find(asset=>asset.name===`${name}.sha256`)
  if (!zip || !checksum) throw new Error('新版本尚未上传完整的 Windows 发行包和校验文件')
  for(const asset of [zip,checksum]){
    const url=new URL(asset.browser_download_url)
    if(url.origin!=='https://github.com'||!url.pathname.startsWith(`/${config.owner}/${config.repository}/releases/download/`))throw new Error('版本下载地址不属于项目的 GitHub Release')
  }
  return {version,name,zip,checksum}
}

class PortableUpdater extends EventEmitter {
  constructor({appRoot,data,currentVersion,available,fetcher}) {
    super();this.appRoot=path.resolve(appRoot);this.data=data;this.fetcher=fetcher;this.release=null;this.busy=false
    this.directory=path.join(data,'updates');fs.mkdirSync(this.directory,{recursive:true})
    this.preferences=path.join(this.directory,'preferences.json')
    const result=readJson(path.join(this.directory,'install-result.json'),null)
    this.state={available,currentVersion,autoCheck:readJson(this.preferences,{autoCheck:true}).autoCheck!==false,status:result?.success===false?'error':'idle',message:result?.success===false?`上次更新失败，原版本已恢复：${result.message}`:'',progress:0,latestVersion:null,releaseUrl:`${config.homepage}/releases`,hasUpdate:false}
  }
  snapshot(){return {...this.state}}
  publish(values){Object.assign(this.state,values);this.emit('change',this.snapshot());return this.snapshot()}
  setAutoCheck(enabled){if(typeof enabled!=='boolean')throw new Error('无效的更新设置');writeJson(this.preferences,{autoCheck:enabled});return this.publish({autoCheck:enabled})}
  start(){this.initialTimer=setTimeout(()=>{if(this.state.autoCheck)this.check().catch(()=>{})},6000);this.initialTimer.unref();this.timer=setInterval(()=>{if(this.state.autoCheck)this.check().catch(()=>{})},6*60*60*1000);this.timer.unref()}
  stop(){clearTimeout(this.initialTimer);clearInterval(this.timer)}
  async check(){
    if(!this.state.available||this.busy)return this.snapshot()
    this.busy=true;this.publish({status:'checking',message:'正在检查 GitHub 新版本…'})
    try{
      const response=await this.fetcher(`https://api.github.com/repos/${config.owner}/${config.repository}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'CS2-Cam'},signal:AbortSignal.timeout(20000)})
      if(response.status===404)return this.publish({status:'current',hasUpdate:false,message:'项目尚未发布新版本。'})
      if(!response.ok)throw new Error(`GitHub 检查失败（HTTP ${response.status}）`)
      const release=await response.json()
      if(release.draft||release.prerelease)throw new Error('最新记录不是稳定发行版')
      const newer=newerVersion(release.tag_name,this.state.currentVersion)
      this.release=newer?release:null
      if(newer)releaseAssets(release)
      return this.publish({status:newer?'available':'current',hasUpdate:newer,latestVersion:versionParts(release.tag_name).join('.'),releaseUrl:release.html_url,message:newer?`发现新版本 ${release.tag_name}`:'当前已是最新版本。'})
    }catch(error){this.publish({status:'error',message:error.message});throw error}
    finally{this.busy=false}
  }
  async prepare(){
    if(!this.state.available||this.busy||!this.release||!this.state.hasUpdate)throw new Error('请先检查并选择可用的新版本')
    this.busy=true
    const release=this.release
    try{
      const assets=releaseAssets(release), work=path.join(this.directory,`${assets.version}-${Date.now()}`)
      fs.mkdirSync(work,{recursive:true})
      this.publish({status:'downloading',progress:0,message:'正在下载并校验完整更新包…'})
      const sumResponse=await this.fetcher(assets.checksum.browser_download_url,{signal:AbortSignal.timeout(30000)})
      if(!sumResponse.ok)throw new Error('更新校验文件下载失败')
      const sum=await sumResponse.text()
      const match=/^([a-f0-9]{64})\s+\*?([^\r\n]+)\s*$/i.exec(sum.trim())
      if(!match||match[2]!==assets.name)throw new Error('更新校验文件格式错误')
      const response=await this.fetcher(assets.zip.browser_download_url,{signal:AbortSignal.timeout(30*60*1000)})
      if(!response.ok||!response.body)throw new Error('更新包下载失败')
      const archive=path.join(work,assets.name), handle=fs.openSync(archive,'w'), digest=crypto.createHash('sha256')
      const reader=response.body.getReader();let received=0,lastProgress=-1
      try{for(;;){const {done,value}=await reader.read();if(done)break;fs.writeSync(handle,value);digest.update(value);received+=value.byteLength;const progress=Math.min(99,Math.floor(received/assets.zip.size*100));if(progress!==lastProgress){lastProgress=progress;this.publish({progress})}}}finally{fs.closeSync(handle)}
      if(received!==assets.zip.size||digest.digest('hex').toLowerCase()!==match[1].toLowerCase()){fs.unlinkSync(archive);throw new Error('更新包不完整或 SHA-256 校验不通过，请重新下载')}
      this.publish({status:'preparing',progress:100,message:'校验通过，正在准备安装…'})
      const helper=path.join(work,'install-update.ps1')
      fs.copyFileSync(path.join(__dirname,'install-update.ps1'),helper)
      const install={archive,appRoot:this.appRoot,work,expectedVersion:assets.version,parentPid:process.pid,resultFile:path.join(this.directory,'install-result.json')}
      const plan=path.join(work,'install-plan.json');writeJson(plan,install)
      await execute(this.powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Plan',plan,'-PrepareOnly'],{timeout:10*60*1000})
      this.prepared={helper,plan};return this.publish({status:'ready',message:'更新包已准备好，将关闭软件、安装并重新启动。'})
    }catch(error){this.publish({status:'error',message:error.message});throw error}
    finally{this.busy=false}
  }
  powershell(){return path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')}
  launchInstaller(){
    if(!this.prepared)throw new Error('更新包尚未准备好')
    const child=spawn(this.powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.prepared.helper,'-Plan',this.prepared.plan],{detached:true,stdio:'ignore',windowsHide:true})
    return new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})})
  }
}
module.exports={PortableUpdater,newerVersion,releaseAssets,versionParts,githubFetch}
