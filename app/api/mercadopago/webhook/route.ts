import { db } from "@/lib/firebase-admin"

export async function GET() {
  return new Response("Webhook endpoint online", { status: 200 })
}

export async function POST(req: Request) {
  try {
    const headersObj = Object.fromEntries(req.headers.entries())
    const rawBody = await req.text()

    await db.collection("mercadoPagoEvents").add({
      receivedAt: new Date().toISOString(),
      headers: headersObj,
      rawBody,
      processed: false,
      source: "manual-or-webhook",
    })

    return new Response("ok", { status: 200 })
  } catch (error) {
    console.error("Webhook error:", error)
    return new Response("error", { status: 500 })
  }
}
