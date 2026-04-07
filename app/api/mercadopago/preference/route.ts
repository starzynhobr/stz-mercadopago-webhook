export async function POST() {
  const accessToken = process.env.MP_ACCESS_TOKEN

  if (!accessToken) {
    return Response.json({ error: "MP_ACCESS_TOKEN ausente" }, { status: 500 })
  }

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          title: "Teste Timon Print",
          quantity: 1,
          unit_price: 10,
          currency_id: "BRL",
        },
      ],
      external_reference: "teste-001",
      notification_url: "https://project-hklk4.vercel.app/api/mercadopago/webhook",
    }),
  })

  const data = await res.json()

  return Response.json(data, { status: res.status })
}
