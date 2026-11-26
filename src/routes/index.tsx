import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/')({
  component: () => (
    <main class="flex h-dvh w-screen items-center justify-center bg-slate-950 text-slate-100">
      <div class="text-center">
        <h1 class="text-2xl font-semibold tracking-tight">PeageMap</h1>
        <p class="mt-2 text-sm text-slate-400">Initialisation en cours…</p>
      </div>
    </main>
  ),
})
