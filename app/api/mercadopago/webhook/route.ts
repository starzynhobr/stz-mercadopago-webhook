import { db } from "@/lib/firebase-admin"

export async function GET() {
  return new Response("Webhook endpoint online", { status: 200 })
}

export async function POST(req: Request) {
  try {
    const headersObj = Object.fromEntries(req.headers.entries())
    const rawBody = await req.text()
    const xSignature = req.headers.get("x-signature")
    const validSignature =
      !!xSignature &&
      !!process.env.MP_WEBHOOK_SECRET &&
      xSignature.includes("ts=") &&
      xSignature.includes("v1=")

    await db.collection("mercadoPagoEvents").add({
      receivedAt: new Date().toISOString(),
      headers: headersObj,
      rawBody,
      processed: false,
      source: "manual-or-webhook",
      xSignature,
      validSignature,
    })

    return new Response("ok", { status: 200 })
  } catch (error) {
    console.error("Webhook error:", error)
    return new Response("error", { status: 500 })
  }
}
