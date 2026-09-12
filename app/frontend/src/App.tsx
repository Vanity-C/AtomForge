import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import PublishedApp from '@/pages/PublishedApp';
import Index from './pages/Index';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import SharedApp from './pages/SharedApp';
import Settings from './pages/Settings';
import Auth from './pages/Auth';
import Account from './pages/Account';
import Agents from './pages/Agents';
import {AgentProvider} from './components/AgentProvider';
import AuthCallback from './pages/AuthCallback';
import AuthError from './pages/AuthError';
// MODULE_IMPORTS_START
// MODULE_IMPORTS_END

const queryClient = new QueryClient();

/** New pages start at the top; back navigation and in-page anchors keep their position. */
function PagePosition() {
  const {pathname, hash} = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP' && !hash) window.scrollTo({top: 0, left: 0, behavior: 'instant'});
  }, [pathname, hash, navigationType]);
  return null;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Index />} />
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/p/:id" element={<Workspace />} />
    <Route path="/s/:slug" element={<SharedApp />} />
    <Route path="/apps/:slug" element={<PublishedApp />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/account" element={<Account />} />
    <Route path="/agents" element={<Agents />} />
    <Route path="/auth" element={<Auth />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/auth/error" element={<AuthError />} />
    {/* MODULE_ROUTES_START */}
    {/* MODULE_ROUTES_END */}
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    {/* MODULE_PROVIDERS_START */}
    {/* MODULE_PROVIDERS_END */}
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <PagePosition />
        <AgentProvider><AppRoutes /></AgentProvider>
      </BrowserRouter>
    </TooltipProvider>
    {/* MODULE_PROVIDERS_CLOSE */}
  </QueryClientProvider>
);

export default App;
export { AppRoutes };
