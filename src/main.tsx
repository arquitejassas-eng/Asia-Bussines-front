import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { recargarPorVersionNueva } from './Utils/nuevaVersion'
import './Style/global.css'

// Vite avisa con este evento cuando no puede precargar un archivo de una
// pantalla (ej. el CSS) porque la pestaña quedó con una versión vieja. Si
// se recarga, se evita que el error llegue a la pantalla (ver ErrorDePantalla).
window.addEventListener('vite:preloadError', (evento) => {
  if (recargarPorVersionNueva()) evento.preventDefault()
})

// El navegador sube o baja el número de un campo con la rueda del mouse si
// el cursor está dentro (así salió una producción de 17 tejas en vez de 20).
// Al girar la rueda encima se suelta el campo: el número no cambia y la
// página baja normal. Las flechas del teclado siguen funcionando.
window.addEventListener('wheel', (evento) => {
  const campo = evento.target
  if (campo instanceof HTMLInputElement && campo.type === 'number' && campo === document.activeElement) campo.blur()
}, { capture: true, passive: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
