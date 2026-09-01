import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import webpush from 'npm:web-push@3.6.7';
import { Buffer } from 'node:buffer';
import { createECDH, createHash } from 'node:crypto';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function base64url(value: Uint8Array) {
  return Buffer.from(value).toString('base64url');
}

function deriveVapidKeys(secret: string) {
  const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const digest = createHash('sha256').update(`donezo-vapid-v1:${secret}`).digest();
  const scalar = (BigInt(`0x${digest.toString('hex')}`) % (order - 1n)) + 1n;
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privateBytes);
  return {
    privateKey: base64url(privateBytes),
    publicKey: base64url(ecdh.getPublicKey(undefined, 'uncompressed')),
  };
}

type NotificationEvent = {
  id: string;
  recipient_user_id: string;
  category: string;
  title: string;
  body: string;
  deep_link: string;
  group_key: string;
  metadata: Record<string, unknown> | null;
  attempt_count: number;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Deliberately do not accept recipient/title/body/payload request fields.
  // This endpoint can only wake a bounded drain of server-owned queue rows.
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration missing' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const vapid = deriveVapidKeys(serviceRoleKey);
  webpush.setVapidDetails(
    'https://donezo-lime-two.vercel.app',
    vapid.publicKey,
    vapid.privateKey,
  );

  const { error: scheduleError } = await admin.rpc('enqueue_scheduled_notification_events', {
    at_time: new Date().toISOString(),
  });
  if (scheduleError) {
    console.error('scheduled notification generation failed', scheduleError.message);
    return json({ error: 'Could not generate scheduled notifications' }, 500);
  }

  const { data: claimed, error: claimError } = await admin.rpc('claim_notification_events', {
    batch_limit: 50,
  });
  if (claimError) {
    console.error('notification claim failed', claimError.message);
    return json({ error: 'Could not claim notifications' }, 500);
  }

  let deliveredEvents = 0;
  let suppressedEvents = 0;
  let retriedEvents = 0;
  let failedEvents = 0;
  let prunedSubscriptions = 0;

  for (const event of (claimed || []) as NotificationEvent[]) {
    const { data: subscriptions, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', event.recipient_user_id);

    if (subscriptionError) {
      const retry = Number(event.attempt_count || 0) < 3;
      await admin.from('notification_events').update({
        status: retry ? 'pending' : 'failed',
        processing_started_at: null,
        last_error: 'subscription_lookup_failed',
      }).eq('id', event.id).eq('status', 'processing');
      if (retry) retriedEvents += 1;
      else failedEvents += 1;
      continue;
    }

    const activeSubscriptions = (subscriptions || []) as PushSubscriptionRow[];
    if (activeSubscriptions.length === 0) {
      await admin.from('notification_events').update({
        status: 'suppressed',
        processing_started_at: null,
        last_error: 'no_subscription',
        metadata: { ...(event.metadata || {}), deliveryReason: 'no_subscription' },
      }).eq('id', event.id).eq('status', 'processing');
      suppressedEvents += 1;
      continue;
    }

    const payload = JSON.stringify({
      title: event.title,
      body: event.body,
      url: event.deep_link,
      tag: `donezo-${event.group_key}`,
    });

    let delivered = 0;
    let transientFailures = 0;
    let deadSubscriptions = 0;
    for (const subscription of activeSubscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 60 * 60 });
        delivered += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          const { error: pruneError } = await admin.from('push_subscriptions').delete().eq('id', subscription.id);
          if (pruneError) {
            transientFailures += 1;
            console.error('dead subscription prune failed', pruneError.message);
          } else {
            deadSubscriptions += 1;
            prunedSubscriptions += 1;
          }
        } else {
          transientFailures += 1;
          console.error('push delivery failed', statusCode || error);
        }
      }
    }

    if (delivered > 0) {
      await admin.from('notification_events').update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        processing_started_at: null,
        last_error: transientFailures ? 'partial_delivery' : null,
      }).eq('id', event.id).eq('status', 'processing');
      deliveredEvents += 1;
      continue;
    }

    if (deadSubscriptions === activeSubscriptions.length && transientFailures === 0) {
      await admin.from('notification_events').update({
        status: 'suppressed',
        processing_started_at: null,
        last_error: 'no_live_subscription',
        metadata: { ...(event.metadata || {}), deliveryReason: 'no_live_subscription' },
      }).eq('id', event.id).eq('status', 'processing');
      suppressedEvents += 1;
      continue;
    }

    const retry = Number(event.attempt_count || 0) < 3;
    await admin.from('notification_events').update({
      status: retry ? 'pending' : 'failed',
      processing_started_at: null,
      last_error: 'push_delivery_failed',
    }).eq('id', event.id).eq('status', 'processing');
    if (retry) retriedEvents += 1;
    else failedEvents += 1;
  }

  return json({
    claimed: (claimed || []).length,
    delivered: deliveredEvents,
    suppressed: suppressedEvents,
    retried: retriedEvents,
    failed: failedEvents,
    pruned: prunedSubscriptions,
  });
});
