const VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))

const $ = (sel) => document.querySelector(sel)
const dropArea = $('#drop-area')
const dropText = $('#drop-text')
const input = $('#input-file')
const list = $('#preview')
const listHeader = $('#list-header')
const fileCount = $('#file-count')
const itemTemplate = $('#file-item')
const compressBtn = $('#compress-btn')
const saveBtn = $('#save-btn')
const cleanBtn = $('#clean-btn')
const progress = $('#progress')
const progressBar = $('#progress-bar')
const statusText = $('#status')
const summary = $('#summary')
const formatSel = $('#format')
const qualityInput = $('#quality')
const qualityOut = $('#quality-out')
const maxSizeSel = $('#max-size')

/** @type {Map<string, {file: File, url: string, el: HTMLElement, result: object|null, settingsKey: string|null}>} */
const items = new Map()
let nextId = 0
let busy = false

// ---------- Utilidades ----------

function formatBytes (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function getSettings () {
  return {
    format: formatSel.value,
    quality: Number(qualityInput.value) / 100,
    maxSize: Number(maxSizeSel.value)
  }
}

const settingsKey = (s) => `${s.format}|${s.quality}|${s.maxSize}`

function setStatus (text, tone = '') {
  statusText.textContent = text
  statusText.dataset.tone = tone
}

// ---------- Pool de workers ----------

const workers = []
const pending = new Map()
let taskSeq = 0

function getWorker (i) {
  if (!workers[i]) {
    const w = new Worker('src/worker.js')
    w.onmessage = ({ data }) => {
      const task = pending.get(data.id)
      if (!task) return
      pending.delete(data.id)
      data.error ? task.reject(new Error(data.error)) : task.resolve(data)
    }
    workers[i] = w
  }
  return workers[i]
}

function runInWorker (workerIndex, file, settings) {
  return new Promise((resolve, reject) => {
    const id = ++taskSeq
    pending.set(id, { resolve, reject })
    getWorker(workerIndex).postMessage({ id, file, ...settings })
  })
}

// Procesa la cola con un número limitado de workers en paralelo
async function runPool (tasks, onDone) {
  let cursor = 0
  const lane = async (workerIndex) => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++]
      await task(workerIndex)
      onDone()
    }
  }
  const lanes = Math.min(POOL_SIZE, tasks.length)
  await Promise.all(Array.from({ length: lanes }, (_, i) => lane(i)))
}

// ---------- Gestión de archivos ----------

function addFiles (fileList) {
  const known = new Set([...items.values()].map(({ file }) => `${file.name}|${file.size}|${file.lastModified}`))
  let rejected = 0
  const fragment = document.createDocumentFragment()

  for (const file of fileList) {
    if (!VALID_TYPES.includes(file.type)) {
      rejected++
      continue
    }
    const key = `${file.name}|${file.size}|${file.lastModified}`
    if (known.has(key)) continue
    known.add(key)

    const id = String(nextId++)
    const url = URL.createObjectURL(file)
    const el = itemTemplate.content.firstElementChild.cloneNode(true)
    el.dataset.id = id
    el.querySelector('.thumb').src = url
    el.querySelector('.file-name').textContent = file.name
    el.querySelector('.file-name').title = file.name
    el.querySelector('.file-meta').textContent = formatBytes(file.size)
    fragment.append(el)

    items.set(id, { file, url, el, result: null, settingsKey: null })
  }

  list.append(fragment)
  if (rejected) {
    setStatus(`${rejected} archivo(s) ignorado(s): solo se admiten JPG, PNG y WebP.`, 'warn')
  } else {
    setStatus('')
  }
  refreshUI()
}

function removeItem (id) {
  const item = items.get(id)
  if (!item) return
  URL.revokeObjectURL(item.url)
  item.el.remove()
  items.delete(id)
  refreshUI()
}

function clearAll () {
  for (const { url } of items.values()) URL.revokeObjectURL(url)
  items.clear()
  list.replaceChildren()
  setStatus('')
  refreshUI()
}

function renderItem (item) {
  const meta = item.el.querySelector('.file-meta')
  const saving = item.el.querySelector('.file-saving')
  item.el.classList.remove('is-done', 'is-error', 'is-working', 'is-stale')

  if (item.error) {
    item.el.classList.add('is-error')
    meta.textContent = `${formatBytes(item.file.size)} · Error: ${item.error}`
    saving.textContent = ''
    return
  }
  if (!item.result) {
    meta.textContent = formatBytes(item.file.size)
    saving.textContent = ''
    return
  }

  const { blob, width, height, keptOriginal } = item.result
  const pct = Math.round((1 - blob.size / item.file.size) * 100)
  item.el.classList.add('is-done')
  if (item.settingsKey !== settingsKey(getSettings())) item.el.classList.add('is-stale')
  meta.textContent = `${formatBytes(item.file.size)} → ${formatBytes(blob.size)} · ${width}×${height}` +
    (keptOriginal ? ' · sin cambios' : '')
  saving.textContent = pct > 0 ? `−${pct}%` : `${pct === 0 ? '' : '+'}${Math.abs(pct)}%`
  saving.dataset.tone = pct > 0 ? 'good' : 'bad'
}

function refreshUI () {
  const count = items.size
  const currentKey = settingsKey(getSettings())
  const needsWork = [...items.values()].some((it) => it.settingsKey !== currentKey)
  const done = [...items.values()].filter((it) => it.result)

  listHeader.hidden = count === 0
  fileCount.textContent = count
  dropArea.classList.toggle('compact', count > 0)
  compressBtn.disabled = busy || count === 0 || !needsWork
  saveBtn.disabled = busy || done.length === 0 || needsWork
  cleanBtn.disabled = busy
  formatSel.disabled = qualityInput.disabled = maxSizeSel.disabled = busy

  const allDone = count > 0 && done.length === count && !needsWork
  summary.hidden = !allDone
  if (allDone) {
    const original = done.reduce((a, it) => a + it.file.size, 0)
    const compressed = done.reduce((a, it) => a + it.result.blob.size, 0)
    $('#sum-original').textContent = formatBytes(original)
    $('#sum-compressed').textContent = formatBytes(compressed)
    $('#sum-saved').textContent = `${formatBytes(Math.max(0, original - compressed))} (${Math.round((1 - compressed / original) * 100)}%)`
  }
  compressBtn.textContent = done.length && needsWork ? 'Volver a comprimir' : 'Comprimir'
  saveBtn.textContent = done.length > 1 ? 'Guardar ZIP' : 'Guardar'
}

// ---------- Compresión ----------

async function compressAll () {
  const settings = getSettings()
  const key = settingsKey(settings)
  const queue = [...items.values()].filter((it) => it.settingsKey !== key)
  if (!queue.length) return

  busy = true
  refreshUI()
  progress.hidden = false
  progressBar.style.width = '0%'
  setStatus(`Comprimiendo 0 de ${queue.length}…`)

  const started = performance.now()
  let completed = 0
  let failed = 0

  const tasks = queue.map((item) => async (workerIndex) => {
    item.el.classList.add('is-working')
    try {
      item.result = await runInWorker(workerIndex, item.file, settings)
      item.error = null
    } catch (err) {
      item.result = null
      item.error = err.message
      failed++
    }
    item.settingsKey = key
    if (items.has(item.el.dataset.id)) renderItem(item)
  })

  await runPool(tasks, () => {
    completed++
    progressBar.style.width = `${(completed / queue.length) * 100}%`
    setStatus(`Comprimiendo ${completed} de ${queue.length}…`)
  })

  busy = false
  progress.hidden = true
  const secs = ((performance.now() - started) / 1000).toFixed(1)
  setStatus(
    failed ? `Listo en ${secs}s · ${failed} con error` : `Listo en ${secs}s`,
    failed ? 'warn' : 'ok'
  )
  refreshUI()
}

// ---------- Guardado ----------

function outputName (item, used) {
  const type = item.result.blob.type || item.file.type
  const base = item.file.name.replace(/\.[^.]+$/, '')
  const ext = EXTENSIONS[type] || 'img'
  let name = `${base}.${ext}`
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`
  used.add(name.toLowerCase())
  return name
}

async function save () {
  const done = [...items.values()].filter((it) => it.result)
  if (!done.length) return

  busy = true
  refreshUI()
  try {
    let blob, defaultName
    const used = new Set()
    if (done.length === 1) {
      blob = done[0].result.blob
      defaultName = outputName(done[0], used)
    } else {
      setStatus('Generando ZIP…')
      const zip = new JSZip()
      for (const item of done) zip.file(outputName(item, used), item.result.blob)
      // Las imágenes ya están comprimidas: STORE evita recomprimir en vano
      blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
      defaultName = 'imagenes-comprimidas.zip'
    }

    const savedPath = await window.api.saveFile(defaultName, await blob.arrayBuffer())
    if (savedPath) {
      setStatus('Guardado correctamente. ', 'ok')
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'link-btn'
      link.textContent = 'Mostrar en carpeta'
      link.addEventListener('click', () => window.api.showInFolder(savedPath))
      statusText.append(link)
    } else {
      setStatus('')
    }
  } catch (err) {
    console.error(err)
    setStatus(`No se pudo guardar: ${err.message}`, 'warn')
  } finally {
    busy = false
    refreshUI()
  }
}

// ---------- Eventos ----------

input.addEventListener('change', () => {
  addFiles(input.files)
  input.value = ''
})

dropArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    input.click()
  }
})

// Evita que Electron navegue al archivo si se suelta fuera de la zona
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => e.preventDefault())
}

let dragDepth = 0
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  dropArea.classList.add('active')
  dropText.textContent = 'Suelta para añadir las imágenes'
})
window.addEventListener('dragleave', () => {
  if (--dragDepth > 0) return
  dragDepth = 0
  dropArea.classList.remove('active')
  dropText.textContent = 'Arrastra y suelta imágenes aquí'
})
window.addEventListener('drop', (e) => {
  dragDepth = 0
  dropArea.classList.remove('active')
  dropText.textContent = 'Arrastra y suelta imágenes aquí'
  if (!busy && e.dataTransfer?.files.length) addFiles(e.dataTransfer.files)
})

// Pegar imágenes desde el portapapeles
window.addEventListener('paste', (e) => {
  if (!busy && e.clipboardData?.files.length) addFiles(e.clipboardData.files)
})

list.addEventListener('click', (e) => {
  const btn = e.target.closest('.file-remove')
  if (btn && !busy) removeItem(btn.closest('.file-item').dataset.id)
})

compressBtn.addEventListener('click', compressAll)
saveBtn.addEventListener('click', save)
cleanBtn.addEventListener('click', clearAll)

qualityInput.addEventListener('input', () => {
  qualityOut.textContent = `${qualityInput.value}%`
})
for (const el of [formatSel, qualityInput, maxSizeSel]) {
  el.addEventListener('change', () => {
    for (const item of items.values()) if (item.result) renderItem(item)
    if (!busy) setStatus('')
    refreshUI()
  })
}

refreshUI()
