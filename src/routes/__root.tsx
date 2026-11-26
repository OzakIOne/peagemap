/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/solid-query'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/solid-router'
import { Suspense } from 'solid-js'
import type { JSX } from 'solid-js'
import { HydrationScript } from 'solid-js/web'
import appCss from '../styles/app.css?url'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'PeageMap — Optimiseur interactif de péages autoroutiers France' },
      {
        name: 'description',
        content:
          'Visualisez chaque section de péage sur la carte, fractionnez vos sorties en un clic et optimisez le coût de vos trajets autoroutiers en France.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
})

const RootDocument = (props: Readonly<{ children: JSX.Element }>) => (
  <html lang="fr">
    <head>
      <HydrationScript />
    </head>
    <body class="bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-200 overflow-hidden">
      <HeadContent />
      <Suspense>{props.children}</Suspense>
      <Scripts />
    </body>
  </html>
)
