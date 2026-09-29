import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { useHashRoute } from './hooks/useHashRoute'
import { ClaimPage } from './pages/ClaimPage'
import { PayPage } from './pages/PayPage'
import { StatusPage } from './pages/StatusPage'

export function App() {
  const route = useHashRoute()
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header route={route} />
      <main id="main" className="container" tabIndex={-1}>
        {route === 'status' ? <StatusPage /> : route === 'claim' ? <ClaimPage /> : <PayPage />}
      </main>
      <Footer />
    </>
  )
}
