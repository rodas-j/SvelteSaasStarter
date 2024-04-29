import { STRIPE_WEBHOOK_SECRET } from "$env/static/private"
import type Stripe from "stripe"
import type { RequestEvent } from "./$types"
import {
  deletePriceRecord,
  deleteProductRecord,
  manageSubscriptionStatusChange,
  stripe,
  upsertPriceRecord,
  upsertProductRecord,
} from "./stripe-helpers"

const relevantEvents = new Set([
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
])
function toBuffer(ab: ArrayBuffer): Buffer {
  const buf = Buffer.alloc(ab.byteLength)
  const view = new Uint8Array(ab)
  for (let i = 0; i < buf.length; i++) {
    buf[i] = view[i]
  }
  return buf
}

export async function POST({ request }: RequestEvent) {
  // stripe webhook endpoint

  const _rawBody = await request.arrayBuffer()
  const payload = toBuffer(_rawBody)
  const sig = request.headers.get("stripe-signature") || ""
  const webhookSecret = STRIPE_WEBHOOK_SECRET || ""
  let event: Stripe.Event

  try {
    if (!sig || !webhookSecret) {
      return new Response("Webhook secret not found.", { status: 400 })
    }

    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret)
    console.log(`🔔  Webhook received: ${event.type}`)
  } catch (error: any) {
    console.log(`❌ Error message: ${error.message}`)
    return new Response(`Webhook Error: ${error.message}`, { status: 400 })
  }

  if (relevantEvents.has(event.type)) {
    try {
      switch (event.type) {
        case "product.created":
        case "product.updated":
          await upsertProductRecord(event.data.object as Stripe.Product)
          break
        case "price.created":
        case "price.updated":
          await upsertPriceRecord(event.data.object as Stripe.Price)
          break
        case "price.deleted":
          await deletePriceRecord(event.data.object as Stripe.Price)
          break
        case "product.deleted":
          await deleteProductRecord(event.data.object as Stripe.Product)
          break
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          const subscription = event.data.object as Stripe.Subscription
          await manageSubscriptionStatusChange(
            subscription.id,
            subscription.customer as string,
            event.type === "customer.subscription.created",
          )
          break
        case "checkout.session.completed":
          const checkoutSession = event.data.object as Stripe.Checkout.Session
          if (checkoutSession.mode === "subscription") {
            const subscriptionId = checkoutSession.subscription
            await manageSubscriptionStatusChange(
              subscriptionId as string,
              checkoutSession.customer as string,
              true,
            )
          }
          break
        default:
          throw new Error("Unhandled relevant event!")
      }
    } catch (error: any) {
      console.log(error)
      return new Response(`Webhook Error: ${error.message}`, { status: 400 })
    }
  } else {
    return new Response(`Unsupported event type: ${event.type}`, {
      status: 400,
    })
  }
  return new Response(JSON.stringify({ received: true }))
}