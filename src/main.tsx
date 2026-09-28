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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
