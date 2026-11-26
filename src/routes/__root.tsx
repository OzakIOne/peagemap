/// <reference types="vite/client" />
import type { QueryClient } from "@tanstack/solid-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/solid-router";
import { ErrorBoundary, Suspense } from "solid-js";
import type { JSX } from "solid-js";
import { HydrationScript } from "solid-js/web";
import appCss from "../styles/app.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "theme-color", content: "#020617" },
      { name: "color-scheme", content: "dark" },
      { title: "PeageMap — Optimiseur interactif de péages autoroutiers France" },
      {
        name: "description",
        content:
          "Visualisez chaque section de péage sur la carte, optimisez vos sorties en un clic et calculez le meilleur coût de vos trajets autoroutiers en France.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
});

const RootDocument = (props: Readonly<{ children: JSX.Element }>) => (
  <html lang="fr">
    <head>
      <HydrationScript />
      <HeadContent />
    </head>
    <body class="overflow-hidden bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
      <ErrorBoundary
        fallback={(error) => (
          <div class="flex h-dvh w-screen items-center justify-center bg-slate-950 p-6 text-rose-200">
            <div class="max-w-lg rounded-2xl border border-rose-500/40 bg-rose-950/40 p-5">
              <h2 class="text-sm font-bold">Erreur applicative</h2>
              <pre class="mt-2 whitespace-pre-wrap text-xs text-rose-300">
                {error instanceof Error ? error.message : String(error)}
              </pre>
            </div>
          </div>
        )}
      >
        <Suspense>{props.children}</Suspense>
      </ErrorBoundary>
      <Scripts />
    </body>
  </html>
);
