import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SfxProvider } from './sfx'

// Arwes' animator is not compatible with React StrictMode, so the app is
// rendered without it (see arwes/arwes README).
createRoot(document.getElementById('root')!).render(
  <SfxProvider>
    <App />
  </SfxProvider>,
)
