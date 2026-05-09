import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Swarm Public</CardTitle>
          <CardDescription>Private credit intelligence layer</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Scaffolded with Next.js 14, Tailwind, shadcn/ui, and Supabase.
        </CardContent>
      </Card>
    </main>
  )
}
