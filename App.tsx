import { Landing } from './Landing'
import { RoomPage } from './Room'
import { usePathname } from './router'

export function App() {
  const path = usePathname()
  const match = path.match(/^\/room\/([a-z0-9-]{6,64})\/?$/)
  if (match) return <RoomPage key={match[1] + location.hash} roomId={match[1]} />
  return <Landing />
}
