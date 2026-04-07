import { createHmac, timingSafeEqual } from "node:crypto"

import { db } from "@/lib/firebase-admin"

function isHex(value: string) {
  return value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
}

export async function GET() {
  return new Response("Webhook endpoint online", { status: 200 })
}

export async function POST(req: Request) {
  try {
    const headersObj = Object.fromEntries(req.headers.entries())
    const rawBody = await req.text()
    const payload = rawBody
      ? ((() => {
          try {
            return JSON.parse(rawBody) as Record<string, unknown>
          } catch {
            return null
          }
        })())
      : null
    const receivedSignature = req.headers.get("x-signature")
    const xRequestId = req.headers.get("x-request-id") ?? ""
    const signatureParts = Object.fromEntries(
      (receivedSignature ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [key, ...rest] = part.split("=")
          return [key, rest.join("=")]
        }),
    )
    const signatureTs =
      typeof signatureParts.ts === "string" ? signatureParts.ts : null
    const signatureV1 =
      typeof signatureParts.v1 === "string"
        ? signatureParts.v1.toLowerCase()
        : null
    const url = new URL(req.url)
    const queryDataId = url.searchParams.get("data.id")
    const payloadData =
      payload && typeof payload.data === "object" && payload.data !== null
        ? (payload.data as Record<string, unknown>)
        : null
    const payloadDataId =
      payloadData && payloadData.id != null ? String(payloadData.id) : null
    const payloadId = payload?.id != null ? String(payload.id) : null
    // Mercado Pago documents the manifest as id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];
    // We prefer the URL query param and only fall back to body fields for compatibility with saved payload variants.
    const notificationId = (queryDataId ?? payloadDataId ?? payloadId ?? "").toLowerCase()
    const signatureManifest = `id:${notificationId};request-id:${xRequestId};ts:${signatureTs ?? ""};`
    const secret = process.env.MP_WEBHOOK_SECRET
    const computedSignature =
      secret && signatureTs
        ? createHmac("sha256", secret).update(signatureManifest).digest("hex")
        : null
    const validSignature =
      !!signatureV1 &&
      !!computedSignature &&
      isHex(signatureV1) &&
      signatureV1.length === computedSignature.length &&
      timingSafeEqual(Buffer.from(signatureV1, "hex"), Buffer.from(computedSignature, "hex"))

    await db.collection("mercadoPagoEvents").add({
      receivedAt: new Date().toISOString(),
      headers: headersObj,
      rawBody,
      receivedSignature,
      signatureTs,
      signatureV1,
      signatureManifest,
      computedSignature,
      validSignature,
      processed: false,
      source: "mercadopago-webhook",
    })

    return new Response("ok", { status: 200 })
  } catch (error) {
    console.error("Webhook error:", error)
    return new Response("error", { status: 500 })
  }
}
