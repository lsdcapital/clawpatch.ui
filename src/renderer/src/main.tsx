import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { ClawpatchApp } from "./routes/ClawpatchApp";
import { DiffWorkerPoolProvider } from "./components/DiffWorkerPoolProvider";
import "./styles.css";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: ClawpatchApp,
});

const router = createRouter({
  routeTree: rootRoute,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DiffWorkerPoolProvider>
        <RouterProvider router={router} />
      </DiffWorkerPoolProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
