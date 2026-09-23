# Compresor de imágenes

App de escritorio (Electron) para comprimir imágenes JPG, PNG y WebP. Todo se procesa localmente, sin conexión.

## Uso

```bash
npm install
npm start        # arranca con Electron Forge
npm run dev      # arranca con DevTools y recarga automática
npm run make     # genera instaladores
```

1. Arrastra imágenes a la ventana, pégalas (Ctrl+V) o haz clic para seleccionarlas.
2. Elige formato de salida, calidad y tamaño máximo.
3. Pulsa **Comprimir** y luego **Guardar** (una imagen se guarda tal cual; varias, en un ZIP).

## Cómo funciona

- La compresión se hace en Web Workers con `OffscreenCanvas`, en paralelo y sin bloquear la interfaz.
- Si una imagen no se reduce (mismo formato y tamaño), se conserva el archivo original.
- El ZIP se genera sin recomprimir (las imágenes ya están comprimidas), por lo que es casi instantáneo.
