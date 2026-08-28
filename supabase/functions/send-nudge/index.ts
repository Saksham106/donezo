import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import webpush from 'npm:web-push@3.6.7';
import { Buffer } from 'node:buffer';
import { createECDH, createHash } from 'node:crypto';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

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

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server configuration missing' }, 500);

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const vapid = deriveVapidKeys(serviceRoleKey);

    if (action === 'vapid-public-key') {
      return json({ publicKey: vapid.publicKey });
    }

    if (action !== 'send-nudge' || typeof body?.nudgeId !== 'string') {
      return json({ error: 'Invalid action' }, 400);
    }

    const { data: nudge, error: nudgeError } = await admin
      .from('nudges')
      .select('id,circle_id,from_user_id,to_user_id,message')
      .eq('id', body.nudgeId)
      .maybeSingle();
    if (nudgeError) {
      console.error('nudge lookup failed', nudgeError.message);
      return json({ error: 'Could not load nudge' }, 500);
    }
    if (!nudge) return json({ error: 'Nudge not found' }, 404);
    if (nudge.from_user_id !== user.id) return json({ error: 'Forbidden' }, 403);

    const { data: memberships, error: membershipError } = await admin
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', nudge.circle_id)
      .in('user_id', [nudge.from_user_id, nudge.to_user_id]);
    if (membershipError) {
      console.error('membership lookup failed', membershipError.message);
      return json({ error: 'Could not verify circle membership' }, 500);
    }
    if (memberships?.length !== 2) return json({ error: 'Circle membership changed' }, 403);

    const [{ data: sender }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', nudge.from_user_id).maybeSingle(),
      admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', nudge.to_user_id),
    ]);
    if (subscriptionError) return json({ error: 'Could not load push subscriptions' }, 500);

    webpush.setVapidDetails(
      'https://donezo-lime-two.vercel.app',
      vapid.publicKey,
      vapid.privateKey,
    );

    const payload = JSON.stringify({
      title: `${sender?.display_name || 'Your friend'} nudged you ⚡`,
      body: nudge.message,
      url: '/?nudges=1',
      tag: `donezo-nudge-${nudge.id}`,
    });

    let delivered = 0;
    let failed = 0;
    let pruned = 0;
    for (const subscription of subscriptions || []) {
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
            failed += 1;
            console.error('dead subscription prune failed', pruneError.message);
          } else {
            pruned += 1;
          }
        } else {
          failed += 1;
          console.error('push delivery failed', statusCode || error);
        }
      }
    }

    return json({ delivered, failed, pruned });
  },
};
