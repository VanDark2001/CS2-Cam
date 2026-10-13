// Update only the PE icon resources; validate before replacing the executable.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ResEdit = require('resedit')

function applyAppIcon(executable, iconPath = path.join(__dirname, 'assets', 'app-icon.ico')) {
  const original = ResEdit.NtExecutable.from(fs.readFileSync(executable))
  const digest = data => crypto.createHash('sha256').update(Buffer.from(data)).digest('hex')
  const sections = original.getAllSections().filter(section => section.info.name !== '.rsrc').map(section => ({ name: section.info.name, hash: digest(section.data || []) }))
  const resources = ResEdit.NtExecutableResource.from(original)
  const otherResources = resources.entries.filter(entry => entry.type !== 3 && entry.type !== 14).map(entry => ({ type: entry.type, id: entry.id, lang: entry.lang, hash: digest(entry.bin) }))
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath))
  if (icon.icons.length < 7) throw new Error('Missing desktop icon sizes')
  const groups = resources.entries.filter(entry => entry.type === 14).map(({ id, lang }) => ({ id, lang }))
  if (!groups.length) groups.push({ id: 101, lang: 1033 })
  for (const { id, lang } of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, id, lang, icon.icons.map(item => item.data))
  }
  resources.outputResource(original)
  const binary = Buffer.from(original.generate())
  const updated = ResEdit.NtExecutable.from(binary)
  const updatedResources = ResEdit.NtExecutableResource.from(updated)
  for (const { id, lang } of groups) {
    const group = ResEdit.Resource.IconGroupEntry.fromEntries(updatedResources.entries).find(item => item.id === id && item.lang === lang)
    if (!group || group.icons.length !== icon.icons.length) throw new Error('Executable icon verification failed')
    const actual = group.getIconItemsFromEntries(updatedResources.entries)
    if (actual.length !== icon.icons.length || actual.some((item, i) => !Buffer.from(item.bin).equals(Buffer.from(icon.icons[i].data.bin)))) {
      throw new Error('Embedded icon pixels differ from source')
    }
  }
  for (const section of sections) {
    const other = updated.getAllSections().find(candidate => candidate.info.name === section.name)
    if (!other || section.hash !== digest(other.data || [])) throw new Error(`Section changed: ${section.name}`)
  }
  for (const entry of otherResources) {
    const other = updatedResources.entries.find(candidate => candidate.type === entry.type && candidate.id === entry.id && candidate.lang === entry.lang)
    if (!other || entry.hash !== digest(other.bin)) throw new Error(`Non-icon resource changed: ${entry.type}/${entry.id}`)
  }
  const temporary = `${executable}.icon-tmp`
  fs.writeFileSync(temporary, binary)
  try { fs.renameSync(temporary, executable) } catch (error) { fs.unlinkSync(temporary); throw error }
  console.log(`Updated and verified ${groups.length} icon group(s): ${executable}`)
}

module.exports = { applyAppIcon }
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node electron/app-icon.cjs <closed executable>')
  applyAppIcon(path.resolve(process.argv[2]))
}
