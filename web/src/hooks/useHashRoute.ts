import { useEffect, useState } from 'react'

export type Route = 'pay' | 'status' | 'claim'

export const ROUTES: { route: Route; hash: string; label: string }[] = [
  { route: 'pay', hash: '#/', label: 'Get a spend card' },
  { route: 'status', hash: '#/status', label: 'Order status' },
  { route: 'claim', hash: '#/claim', label: 'Claim card' },
]

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  if (path.startsWith('status')) return 'status'
  if (path.startsWith('claim')) return 'claim'
  return 'pay'
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
