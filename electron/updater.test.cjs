const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const {PortableUpdater,newerVersion,releaseAssets}=require('./updater.cjs')
test('stable versions compare numerically and reject prereleases',()=>{
  assert.ok(newerVersion('v0.10.0','0.9.9'));assert.ok(!newerVersion('v0.1.0','0.1.0'));assert.ok(!newerVersion('v0.0.9','0.1.0'));assert.throws(()=>newerVersion('v0.2.0-beta','0.1.0'))
})
test('release downloads must include a checksum and belong to the project',()=>{
  const asset={name:'CS2-Cam-0.2.0-win-x64.zip',browser_download_url:'https://github.com/VanDark2001/CS2-Cam/releases/download/v0.2.0/CS2-Cam-0.2.0-win-x64.zip'}
  const release={tag_name:'v0.2.0',assets:[asset,{...asset,name:asset.name+'.sha256'}]}
  assert.equal(releaseAssets(release).version,'0.2.0')
  assert.throws(()=>releaseAssets({...release,assets:[asset]}))
  assert.throws(()=>releaseAssets({...release,assets:release.assets.map(a=>({...a,browser_download_url:'https://example.com/file.zip'}))}))
})
test('update check handles current/new/offline states and persists automatic checking',async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'cs2-cam-updater-'))
  try{
    let offline=false
    const updater=new PortableUpdater({appRoot:data,data,currentVersion:'0.1.0',available:true,fetcher:async()=>{if(offline)throw new Error('offline');return new Response(JSON.stringify({tag_name:'v0.1.0',html_url:'https://github.com/VanDark2001/CS2-Cam/releases/tag/v0.1.0'}))}})
    assert.equal((await updater.check()).status,'current')
    updater.setAutoCheck(false)
    assert.equal(JSON.parse(fs.readFileSync(updater.preferences,'utf8')).autoCheck,false)
    offline=true;await assert.rejects(()=>updater.check(),/offline/);assert.equal(updater.state.status,'error')
    const newer={tag_name:'v0.2.0',assets:[{name:'CS2-Cam-0.2.0-win-x64.zip',size:100,browser_download_url:'https://github.com/VanDark2001/CS2-Cam/releases/download/v0.2.0/CS2-Cam-0.2.0-win-x64.zip'},{name:'CS2-Cam-0.2.0-win-x64.zip.sha256',browser_download_url:'https://github.com/VanDark2001/CS2-Cam/releases/download/v0.2.0/CS2-Cam-0.2.0-win-x64.zip.sha256'}]}
    updater.fetcher=async()=>new Response(JSON.stringify(newer));assert.equal((await updater.check()).hasUpdate,true)
    updater.fetcher=async url=>new Response(url.endsWith('.sha256')?'0'.repeat(64)+'  CS2-Cam-0.2.0-win-x64.zip\n':'wrong zip')
    await assert.rejects(()=>updater.prepare(),/SHA-256/);assert.equal(updater.prepared,undefined)
  }finally{fs.rmSync(data,{recursive:true,force:true})}
})
