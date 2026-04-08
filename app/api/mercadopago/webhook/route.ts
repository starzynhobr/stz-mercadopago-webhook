import { createHmac, timingSafeEqual } from "node:crypto"

import { db } from "@/lib/firebase-admin"

function isHex(value: string) {
  return value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
}

function formatAmount(amount: number, currency: string) {
  if (currency === "BRL") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount)
  }

  return `${amount} ${currency}`
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
    const rawNotificationId = queryDataId ?? payloadDataId ?? payloadId ?? ""
    // Mercado Pago documents the manifest as id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];
    // We prefer the URL query param and only fall back to body fields for compatibility with saved payload variants.
    const notificationId = rawNotificationId.toLowerCase()
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

    const eventDocRef = await db.collection("mercadoPagoEvents").add({
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

    const eventType = typeof payload?.type === "string" ? payload.type : null
    const eventAction = typeof payload?.action === "string" ? payload.action : null
    const isPaymentEvent =
      eventType === "payment" ||
      (!!eventAction && eventAction.startsWith("payment."))

    if (validSignature && isPaymentEvent && rawNotificationId) {
      try {
        const accessToken = process.env.MP_ACCESS_TOKEN

        if (!accessToken) {
          throw new Error("Missing MP_ACCESS_TOKEN")
        }

        const paymentRes = await fetch(
          `https://api.mercadopago.com/v1/payments/${encodeURIComponent(rawNotificationId)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            cache: "no-store",
          },
        )

        if (!paymentRes.ok) {
          throw new Error(`Mercado Pago payment lookup failed with status ${paymentRes.status}`)
        }

        const payment = (await paymentRes.json()) as Record<string, unknown>
        const amount =
          typeof payment.transaction_amount === "number"
            ? payment.transaction_amount
            : Number(payment.transaction_amount ?? 0)
        const currency =
          typeof payment.currency_id === "string" ? payment.currency_id : "BRL"
        const status =
          typeof payment.status === "string" ? payment.status : "unknown"
        const payer =
          payment.payer && typeof payment.payer === "object"
            ? (payment.payer as Record<string, unknown>)
            : null
        const customerName = [payer?.first_name, payer?.last_name]
          .filter((part): part is string => typeof part === "string" && !!part.trim())
          .join(" ")
          .trim() || null
        const formattedAmount = formatAmount(amount, currency)
        const message = customerName
          ? `${customerName} pagou ${formattedAmount}`
          : `Pagamento recebido de ${formattedAmount}`

        await db.collection("paymentNotifications").add({
          kind: "payment_notification",
          paymentId: rawNotificationId,
          amount,
          currency,
          customerName,
          status,
          title: "Novo pagamento recebido",
          message,
          createdAt: new Date().toISOString(),
          read: false,
          validSignature: true,
        })

        await eventDocRef.update({
          paymentFetchAttempted: true,
          paymentFetchSuccess: true,
          paymentFetchError: null,
        })
      } catch (fetchError) {
        const paymentFetchError =
          fetchError instanceof Error ? fetchError.message : "Unknown payment fetch error"

        console.error("Payment fetch error:", fetchError)

        await eventDocRef.update({
          paymentFetchAttempted: true,
          paymentFetchSuccess: false,
          paymentFetchError: paymentFetchError.slice(0, 300),
        })
      }
    }

    return new Response("ok", { status: 200 })
  } catch (error) {
    console.error("Webhook error:", error)
    return new Response("error", { status: 500 })
  }
}
