const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron/main')
const fs = require('node:fs/promises')
const path = require('node:path')

if (require('electron-squirrel-startup')) app.quit()

// Recarga automática solo en desarrollo
if (!app.isPackaged) {
  try {
    require('electron-reload')(__dirname, {})
  } catch (err) {
    console.warn('electron-reload no disponible:', err.message)
  }
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.removeMenu()
  win.once('ready-to-show', () => win.show())
  win.loadFile('index.html')

  if (!app.isPackaged && process.argv.includes('--devtools')) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

// Guarda un archivo (ZIP o imagen) usando el diálogo nativo
ipcMain.handle('save-file', async (event, { defaultName, data }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), defaultName)
  })
  if (canceled || !filePath) return null
  await fs.writeFile(filePath, Buffer.from(data))
  return filePath
})

ipcMain.handle('show-in-folder', (_event, filePath) => {
  shell.showItemInFolder(filePath)
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
