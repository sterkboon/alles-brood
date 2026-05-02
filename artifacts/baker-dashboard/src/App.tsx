import { useEffect } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, Show, useAuth, RedirectToSignIn } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import SignInPage from "@/pages/SignInPage";
import DashboardPage from "@/pages/DashboardPage";
import BakingDaysPage from "@/pages/BakingDaysPage";
import OrdersPage from "@/pages/OrdersPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

function AuthSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
    </>
  );
}

function Home() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 p-8">
          <img src={`${basePath}/logo.svg`} alt="Sourdough" className="w-20 h-20" />
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground">Alles van Afrika</h1>
            <p className="text-muted-foreground mt-1">Sourdough Baker's Dashboard</p>
          </div>
          <a
            href={`${basePath}/sign-in`}
            className="inline-flex items-center px-6 py-3 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            Sign In
          </a>
        </div>
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/dashboard">
        <ProtectedRoute component={DashboardPage} />
      </Route>
      <Route path="/baking-days">
        <ProtectedRoute component={BakingDaysPage} />
      </Route>
      <Route path="/orders">
        <ProtectedRoute component={OrdersPage} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function InnerApp() {
  return (
    <>
      <AuthSync />
      <WouterRouter base={basePath}>
        <Router />
      </WouterRouter>
    </>
  );
}

function App() {
  return (
    <ClerkProvider
      publishableKey={clerkPk}
      afterSignInUrl={`${basePath}/dashboard`}
      afterSignOutUrl={`${basePath}/`}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <InnerApp />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
