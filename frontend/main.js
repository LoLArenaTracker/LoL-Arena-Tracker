const { app, BrowserWindow, ipcMain, shell, session } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const { autoUpdater } = require('electron-updater')

let mainWindow = null
let backendProcess = null
const PORT = process.env.ARENA_PORT || 5173

function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'arena-backend', 'arena-backend.exe')
  }
  return null // dev mode: run backend manually
}

function killOldBackends() {
  return new Promise((resolve) => {
    const { exec } = require('child_process')
    // Kill every arena-backend.exe process (cleans up zombies from previous sessions)
    exec('taskkill /IM arena-backend.exe /F', () => {
      // Wait for OS to release the port before we try to bind it
      setTimeout(resolve, 1000)
    })
  })
}

function startBackend() {
  const backendPath = getBackendPath()
  if (!backendPath) return Promise.resolve()

  return new Promise(async (resolve) => {
    // Kill all old backend processes so zombies from previous sessions don't intercept traffic
    await killOldBackends()

    const fs = require('fs')
    const stderrLog = path.join(
      process.env.APPDATA || require('os').homedir(),
      'arena-tracker', 'backend-stderr.log'
    )
    backendProcess = spawn(backendPath, [], {
      env: { ...process.env, ARENA_PORT: String(PORT) },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    backendProcess.stderr.on('data', (data) => {
      fs.appendFileSync(stderrLog, data.toString())
    })
    backendProcess.on('error', (err) => {
      console.error('Backend error:', err)
      fs.appendFileSync(stderrLog, `spawn error: ${err.message}\n`)
    })
    backendProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`Backend exited with code ${code}`)
        fs.appendFileSync(stderrLog, `Backend exited with code ${code}\n`)
      }
    })
    resolve()
  })
}

function waitForBackend(maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    function tryPing() {
      attempts++
      http.get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
        if (res.statusCode === 200) {
          resolve()
        } else {
          retry()
        }
      }).on('error', () => {
        retry()
      })
    }
    function retry() {
      if (attempts >= maxAttempts) {
        reject(new Error('Backend did not start in time'))
        return
      }
      setTimeout(tryPing, 1000)
    }
    tryPing()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#05070d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'app-icon.png'),
    show: false,
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Ctrl+Shift+I opens DevTools for debugging
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Inject CORS headers so the renderer can POST to the local backend
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Headers': ['Content-Type'],
        'Access-Control-Allow-Methods': ['GET, POST, OPTIONS'],
      },
    })
  })

  await startBackend()
  try {
    await waitForBackend()
  } catch (e) {
    console.log('Backend not reachable, opening anyway (dev mode?)')
  }
  createWindow()

  // Auto-updater: check for new GitHub releases
  if (app.isPackaged) {
    autoUpdater.checkForUpdates()

    autoUpdater.on('update-available', () => {
      mainWindow?.webContents.send('update-status', 'downloading')
    })

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('update-progress', Math.round(progress.percent))
    })

    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update-status', 'ready')
    })

    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall()
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-port', () => PORT)
ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

// Route API calls through main process to bypass any CORS/fetch restrictions
ipcMain.handle('api-request', async (_, { path, method = 'GET', body = null }) => {
  return new Promise((resolve) => {
    const postData = body ? JSON.stringify(body) : null
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    }
    console.log(`[IPC] ${method} ${path} port=${PORT} body=${postData}`)
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        console.log(`[IPC] response ${res.statusCode}: ${data.slice(0, 200)}`)
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) })
        } catch {
          resolve({ ok: false, status: res.statusCode, data: null, error: `Parse error: ${data.slice(0, 100)}` })
        }
      })
    })
    req.on('error', (err) => {
      console.error(`[IPC] request error: ${err.message}`)
      resolve({ ok: false, status: 0, data: null, error: err.message })
    })
    if (postData) req.write(postData)
    req.end()
  })
})
