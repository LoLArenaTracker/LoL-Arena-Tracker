const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return

  const exePath = path.join(context.appOutDir, 'Arena Tracker.exe')
  const icoPath = path.join(context.packager.projectDir, 'assets', 'app-icon.ico')
  const rceditPath = path.join(context.packager.projectDir, 'rcedit.exe')

  if (!fs.existsSync(rceditPath)) {
    console.warn('afterPack: rcedit.exe not found, skipping icon embed')
    return
  }

  try {
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${icoPath}"`)
    console.log('afterPack: icon embedded into', exePath)
  } catch (e) {
    console.error('afterPack: rcedit failed:', e.message)
  }
}
