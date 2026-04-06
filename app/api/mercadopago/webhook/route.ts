export async function GET() {
  return new Response("Webhook endpoint online", { status: 200 })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)

  console.log("Webhook recebido:", body)

  return new Response("ok", { status: 200 })
}
