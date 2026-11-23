import { Landing } from './pages/Landing'
import { RoomPage } from './pages/Room'
import { usePathname } from './lib/router'

export function App() {
  const path = usePathname()
  const match = path.match(/^\/room\/([a-z0-9-]{6,64})\/?$/)
  if (match) return <RoomPage key={match[1] + location.hash} roomId={match[1]} />
  return <Landing />
}
