import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// No StrictMode: the call engine owns real devices and sockets, and a double
// mount would open (and tear down) a second connection.
createRoot(document.getElementById('root')!).render(<App />)
