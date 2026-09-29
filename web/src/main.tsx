import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { App } from './App'
import { loadRuntimeConfig } from './config'
import { ConfigContext } from './hooks/useContracts'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

root.render(
  <div className="loading-screen">
    <p role="status">Loading deployment configuration…</p>
  </div>,
)

loadRuntimeConfig()
  .then((config) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    })
    root.render(
      <StrictMode>
        <ConfigContext.Provider value={config}>
          <WagmiProvider config={config.wagmi}>
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </WagmiProvider>
        </ConfigContext.Provider>
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    root.render(
      <div className="loading-screen">
        <div className="stack-tight" role="alert">
          <h1>Unable to start</h1>
          <p>The deployment configuration could not be loaded, so no contract action is available.</p>
          <p className="small mono">{message}</p>
          <p className="small">Reload the page. If it keeps failing, the hosted files are incomplete.</p>
        </div>
      </div>,
    )
  })
