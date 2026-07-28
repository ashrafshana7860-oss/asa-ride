require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const url_mod = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

const JWT_SECRET = process.env.JWT_SECRET || 'ASA_RIDE_2026_SECRET';
const ADMIN_KEY  = process.env.ADMIN_SECRET || 'ASA2025';
const VAPID_PUB  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIV = process.env.VAPID_PRIVATE_KEY || '';

function sign(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' }); }
function verify(token) { return jwt.verify(token, JWT_SECRET); }

function auth(req, res, next) {
  try {
    var t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'Token required' });
    req.user = verify(t);
    next();
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Admin access denied' });
  next();
}

// ============================================================
// PUSH NOTIFICATION HELPERS
// ============================================================
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function fromB64u(str) {
  return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
}

function makeVapidJWT(audience) {
  if (!VAPID_PRIV || !VAPID_PUB) return null;
  try {
    var header  = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    var payload = b64u(JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 86400,
      sub: 'mailto:asaride2026@gmail.com'
    }));
    var d = fromB64u(VAPID_PRIV);
    var pubBytes = fromB64u(VAPID_PUB);
    var x = pubBytes.slice(1, 33);
    var y = pubBytes.slice(33, 65);
    var privKey = crypto.createPrivateKey({
      key: { kty:'EC', crv:'P-256', d: b64u(d), x: b64u(x), y: b64u(y) },
      format: 'jwk'
    });
    var sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), { key: privKey, dsaEncoding: 'ieee-p1363' });
    return header + '.' + payload + '.' + b64u(sig);
  } catch (e) { console.error('VAPID JWT error:', e.message); return null; }
}

function sendPushNotification(sub, payload) {
  return new Promise(function(resolve) {
    try {
      var parsed   = url_mod.parse(sub.endpoint);
      var audience = parsed.protocol + '//' + parsed.host;
      var vapidJWT = makeVapidJWT(audience);
      if (!vapidJWT) return resolve(false);
      var body = Buffer.from(JSON.stringify(payload));
      var lib  = parsed.protocol === 'https:' ? https : http;
      var req  = lib.request({
        hostname: parsed.hostname,
        path:     parsed.path,
        method:  'POST',
        headers: {
          'Authorization':  'vapid t=' + vapidJWT + ',k=' + VAPID_PUB,
          'Content-Type':   'application/json',
          'TTL':            '86400',
          'Content-Length': body.length
        }
      }, function(res2) { resolve(res2.statusCode < 300); });
      req.on('error', function() { resolve(false); });
      req.write(body);
      req.end();
    } catch (e) { resolve(false); }
  });
}

async function pushToGroup(user_type, payload) {
  var { data } = await supabase.from('push_subscriptions').select('*').eq('user_type', user_type);
  var sent = 0;
  for (var s of (data || [])) {
    var ok = await sendPushNotification(s, payload);
    if (ok) sent++;
  }
  return sent;
}

async function pushToUser(user_id, payload) {
  var { data } = await supabase.from('push_subscriptions').select('*').eq('user_id', user_id);
  var sent = 0;
  for (var s of (data || [])) {
    var ok = await sendPushNotification(s, payload);
    if (ok) sent++;
  }
  return sent;
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', function(req, res) {
  res.json({ status: 'ASA RIDE Backend Live', version: '2.0.0', time: new Date().toISOString() });
});

// ============================================================
// PUSH ROUTES
// ============================================================
app.post('/api/push/subscribe', async function(req, res) {
  try {
    var { subscription, user_type, user_id } = req.body;
    if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    var { error } = await supabase.from('push_subscriptions').upsert({
      endpoint:  subscription.endpoint,
      p256dh:    subscription.keys.p256dh,
      auth:      subscription.keys.auth,
      user_type: user_type || 'customer',
      user_id:   user_id   || null
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/push/vapid-key', function(req, res) {
  res.json({ publicKey: VAPID_PUB });
});

app.post('/api/push/send-customers', adminAuth, async function(req, res) {
  var { title, body, link } = req.body;
  var sent = await pushToGroup('customer', { title: title || 'ASA RIDE', body: body || 'New update!', url: link || '/customer_app.html' });
  res.json({ success: true, sent });
});

app.post('/api/push/send-drivers', adminAuth, async function(req, res) {
  var { title, body, link } = req.body;
  var sent = await pushToGroup('driver', { title: title || 'ASA RIDE Driver', body: body || 'Update hai!', url: link || '/driver_app.html' });
  res.json({ success: true, sent });
});

app.post('/api/push/ride-alert', auth, async function(req, res) {
  var { driver_id, pickup, drop, fare, ride_id } = req.body;
  var sent = await pushToUser(driver_id, {
    title:   'New Ride Request - ASA RIDE',
    body:    (pickup || '') + ' to ' + (drop || '') + ' - Rs.' + (fare || ''),
    url:     '/driver_app.html',
    ride_id: ride_id || null
  });
  res.json({ success: true, sent });
});

// ============================================================
// DRIVER ROUTES
// ============================================================
app.post('/api/driver/register', async function(req, res) {
  try {
    var { name, phone, password, vehicle_type, city, state, imei, licence, rc } = req.body;
    if (!name || !phone || !password || !vehicle_type || !imei) return res.status(400).json({ error: 'Sab fields required hain' });
    var { data: ex } = await supabase.from('drivers').select('id').eq('phone', phone).single();
    if (ex) return res.status(409).json({ error: 'Is number se driver already registered hai' });
    var hash = await bcrypt.hash(password, 10);
    var comm = { BIKE:10, AUTO:12, MINI_CAB:15, SEDAN:15, SUV:15, PREMIUM:18, ERICKSHAW:12, INTERCITY:10, RENTAL:10, AIRPORT:12 };
    var { data, error } = await supabase.from('drivers').insert({
      name, phone, password_hash: hash,
      vehicle_type, city, state, imei,
      licence_no: licence, rc_no: rc,
      commission_pct: comm[vehicle_type] || 12,
      status: 'pending',
      rides_count: 0,
      launch_rides_remaining: 100,
      wallet_balance: 0,
      is_online: false,
      created_at: new Date().toISOString()
    }).select().single();
    if (error) throw error;
    res.json({ success: true, message: '24 hours mein approval milegi', driver_id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/driver/login', async function(req, res) {
  try {
    var { phone, password, imei } = req.body;
    var { data: driver } = await supabase.from('drivers').select('*').eq('phone', phone).single();
    if (!driver) return res.status(401).json({ error: 'Driver nahi mila' });
    if (driver.status === 'pending') return res.status(403).json({ error: 'Account approval pending hai. 24 hours mein milegi.' });
    if (driver.status === 'suspended') return res.status(403).json({ error: 'Account suspend hai. Support: +91 97990 60101' });
    if (driver.imei !== imei) return res.status(403).json({ error: 'IMEI mismatch - sirf registered device allowed' });
    var ok = await bcrypt.compare(password, driver.password_hash);
    if (!ok) return res.status(401).json({ error: 'Galat password' });
    var token = sign({ id: driver.id, role: 'driver', phone: driver.phone });
    var { password_hash, ...safe } = driver;
    res.json({ success: true, token, driver: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/driver/status', auth, async function(req, res) {
  var { is_online, lat, lng } = req.body;
  await supabase.from('drivers').update({ is_online, last_lat: lat, last_lng: lng, last_seen: new Date().toISOString() }).eq('id', req.user.id);
  res.json({ success: true, is_online });
});

app.get('/api/driver/earnings', auth, async function(req, res) {
  try {
    var { data: rides } = await supabase.from('rides').select('*').eq('driver_id', req.user.id).eq('status', 'completed').order('created_at', { ascending: false });
    var today = new Date().toDateString();
    var todayRides = (rides || []).filter(function(r) { return new Date(r.created_at).toDateString() === today; });
    res.json({
      today_earn:  todayRides.reduce(function(s,r){ return s+(r.driver_earn||0); }, 0),
      today_rides: todayRides.length,
      total_earn:  (rides||[]).reduce(function(s,r){ return s+(r.driver_earn||0); }, 0),
      total_rides: (rides||[]).length,
      rides: (rides||[]).slice(0, 20)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/driver/payout-request', auth, async function(req, res) {
  try {
    var { amount, upi_id } = req.body;
    var { data: drv } = await supabase.from('drivers').select('wallet_balance').eq('id', req.user.id).single();
    if (!drv || drv.wallet_balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
    var { data } = await supabase.from('payouts').insert({ driver_id: req.user.id, amount, upi_id, status: 'pending' }).select().single();
    await supabase.from('drivers').update({ wallet_balance: drv.wallet_balance - amount }).eq('id', req.user.id);
    res.json({ success: true, payout_id: data.id, message: 'Payout request submitted! 24 hours mein process hoga.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// CUSTOMER ROUTES
// ============================================================
app.post('/api/customer/register', async function(req, res) {
  try {
    var { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'Sab fields required' });
    var { data: ex } = await supabase.from('customers').select('id').eq('phone', phone).single();
    if (ex) return res.status(409).json({ error: 'Number already registered' });
    var hash = await bcrypt.hash(password, 10);
    var { data } = await supabase.from('customers').insert({ name, phone, password_hash: hash, wallet_balance: 0, ride_count: 0, first_ride_done: false, created_at: new Date().toISOString() }).select().single();
    var token = sign({ id: data.id, role: 'customer', phone });
    res.json({ success: true, token, customer_id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/login', async function(req, res) {
  try {
    var { phone, password } = req.body;
    var { data: cust } = await supabase.from('customers').select('*').eq('phone', phone).single();
    if (!cust) return res.status(401).json({ error: 'Customer nahi mila' });
    var ok = await bcrypt.compare(password, cust.password_hash);
    if (!ok) return res.status(401).json({ error: 'Galat password' });
    var token = sign({ id: cust.id, role: 'customer', phone });
    var { password_hash, ...safe } = cust;
    res.json({ success: true, token, customer: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// RIDE ROUTES
// ============================================================
app.post('/api/ride/fare', async function(req, res) {
  var { vehicle_type, distance_km } = req.body;
  var rates = { BIKE:9, AUTO:13, MINI_CAB:15, SEDAN:17, SUV:20, PREMIUM:25, ERICKSHAW:11, INTERCITY:14, AIRPORT:18 };
  var comms = { BIKE:10, AUTO:12, MINI_CAB:15, SEDAN:15, SUV:15, PREMIUM:18, ERICKSHAW:12, INTERCITY:10, AIRPORT:12 };
  var cancel = ['MINI_CAB','SEDAN','SUV','PREMIUM'].includes(vehicle_type) ? 45 : 25;
  var rate   = rates[vehicle_type] || 13;
  var dist   = (parseFloat(distance_km) || 1) + 0.02;
  var base   = Math.round(rate * dist);
  var comm   = comms[vehicle_type] || 12;
  var fee    = Math.round(base * comm / 100);
  var earn   = base - fee;
  res.json({ distance_km: dist, base_fare: base, platform_fee_pct: comm, platform_fee: fee, driver_earn: earn, cancel_charge: cancel, first_ride_disc_pct: vehicle_type.includes('CAB') || vehicle_type === 'SEDAN' || vehicle_type === 'SUV' || vehicle_type === 'PREMIUM' ? 20 : 15 });
});

app.post('/api/ride/book', auth, async function(req, res) {
  try {
    var { pickup, drop, pickup_lat, pickup_lng, drop_lat, drop_lng, vehicle_type, distance_km, fare } = req.body;
    var otp = Math.floor(1000 + Math.random() * 9000).toString();
    var { data: ride } = await supabase.from('rides').insert({
      customer_id: req.user.id,
      pickup_address: pickup, drop_address: drop,
      pickup_lat, pickup_lng, drop_lat, drop_lng,
      vehicle_type, distance_km, fare, otp,
      status: 'searching',
      created_at: new Date().toISOString()
    }).select().single();
    await pushToGroup('driver', {
      title: 'New Ride Request - ASA RIDE',
      body:  (pickup || '') + ' to ' + (drop || '') + ' - Rs.' + (fare || ''),
      url:   '/driver_app.html',
      ride_id: ride.id
    });
    res.json({ success: true, ride_id: ride.id, otp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ride/accept', auth, async function(req, res) {
  try {
    var { ride_id } = req.body;
    var { data: ride } = await supabase.from('rides').select('*').eq('id', ride_id).single();
    if (!ride || ride.status !== 'searching') return res.status(400).json({ error: 'Ride available nahi' });
    await supabase.from('rides').update({ driver_id: req.user.id, status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', ride_id);
    if (ride.customer_id) {
      await pushToUser(ride.customer_id, { title: 'Driver mil gaya!', body: 'Aapka driver aa raha hai. OTP ready rakhein.', url: '/customer_app.html' });
    }
    res.json({ success: true, otp: ride.otp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ride/complete', auth, async function(req, res) {
  try {
    var { ride_id, otp } = req.body;
    var { data: ride } = await supabase.from('rides').select('*').eq('id', ride_id).single();
    if (!ride || ride.otp !== otp) return res.status(400).json({ error: 'Galat OTP' });
    var { data: driver } = await supabase.from('drivers').select('*').eq('id', req.user.id).single();
    var comm_pct  = driver.launch_rides_remaining > 0 ? 0 : driver.commission_pct;
    var drv_earn  = Math.round(ride.fare * (1 - comm_pct / 100));
    var plat_earn = ride.fare - drv_earn;
    await supabase.from('rides').update({ status: 'completed', driver_earn: drv_earn, platform_earn: plat_earn, comm_pct_applied: comm_pct, completed_at: new Date().toISOString() }).eq('id', ride_id);
    var newRem = Math.max(0, (driver.launch_rides_remaining || 0) - 1);
    await supabase.from('drivers').update({ rides_count: (driver.rides_count || 0) + 1, wallet_balance: (driver.wallet_balance || 0) + drv_earn, launch_rides_remaining: newRem }).eq('id', req.user.id);
    if (ride.customer_id) {
      await pushToUser(ride.customer_id, { title: 'Ride Complete!', body: 'Shukriya! Apni rating dijiye.', url: '/customer_app.html' });
    }
    res.json({ success: true, driver_earn: drv_earn, commission_applied: comm_pct + '%', launch_rides_left: newRem });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ride/cancel', auth, async function(req, res) {
  try {
    var { ride_id, reason } = req.body;
    var { data: ride } = await supabase.from('rides').select('*').eq('id', ride_id).single();
    var isCar = ['MINI_CAB','SEDAN','SUV','PREMIUM'].includes(ride && ride.vehicle_type);
    var charge = (ride && ride.status === 'accepted') ? (isCar ? 45 : 25) : 0;
    await supabase.from('rides').update({ status: 'cancelled', cancel_reason: reason, cancel_charge: charge, cancelled_at: new Date().toISOString() }).eq('id', ride_id);
    res.json({ success: true, cancel_charge: charge, message: charge > 0 ? 'Rs.' + charge + ' cancellation charge lagega' : 'Free cancel' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ride/status/:id', auth, async function(req, res) {
  try {
    var { data: ride } = await supabase.from('rides').select('*').eq('id', req.params.id).single();
    if (!ride) return res.status(404).json({ error: 'Ride nahi mili' });
    res.json({ ride });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ADMIN ROUTES
// ============================================================
app.get('/api/admin/drivers', adminAuth, async function(req, res) {
  var { status, vehicle_type } = req.query;
  var q = supabase.from('drivers').select('id,name,phone,vehicle_type,city,state,status,is_online,rides_count,wallet_balance,commission_pct,launch_rides_remaining,created_at').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (vehicle_type) q = q.eq('vehicle_type', vehicle_type);
  var { data } = await q;
  res.json({ drivers: data || [], count: (data || []).length });
});

app.post('/api/admin/driver/approve', adminAuth, async function(req, res) {
  var { driver_id } = req.body;
  await supabase.from('drivers').update({ status: 'approved' }).eq('id', driver_id);
  var { data: drv } = await supabase.from('drivers').select('id').eq('id', driver_id).single();
  if (drv) await pushToUser(driver_id, { title: 'ASA RIDE - Account Approved!', body: 'Congratulations! Ab aap rides le sakte hain.', url: '/driver_app.html' });
  res.json({ success: true, message: 'Driver approved!' });
});

app.post('/api/admin/driver/suspend', adminAuth, async function(req, res) {
  var { driver_id, reason } = req.body;
  await supabase.from('drivers').update({ status: 'suspended' }).eq('id', driver_id);
  res.json({ success: true });
});

app.get('/api/admin/rides', adminAuth, async function(req, res) {
  var { data } = await supabase.from('rides').select('*').order('created_at', { ascending: false }).limit(100);
  res.json({ rides: data || [], count: (data || []).length });
});

app.get('/api/admin/earnings', adminAuth, async function(req, res) {
  var { data: rides } = await supabase.from('rides').select('fare,driver_earn,platform_earn,comm_pct_applied,created_at').eq('status', 'completed');
  var list = rides || [];
  res.json({
    total_rides:          list.length,
    total_fare:           list.reduce(function(s,r){ return s+(r.fare||0); }, 0),
    total_driver_payout:  list.reduce(function(s,r){ return s+(r.driver_earn||0); }, 0),
    total_platform_earn:  list.reduce(function(s,r){ return s+(r.platform_earn||0); }, 0)
  });
});

app.get('/api/admin/payouts', adminAuth, async function(req, res) {
  var { data } = await supabase.from('payouts').select('*').order('requested_at', { ascending: false });
  res.json({ payouts: data || [] });
});

app.post('/api/admin/payout/process', adminAuth, async function(req, res) {
  var { payout_id, txn_id } = req.body;
  await supabase.from('payouts').update({ status: 'processed', txn_id, processed_at: new Date().toISOString() }).eq('id', payout_id);
  res.json({ success: true });
});

app.get('/api/admin/push-stats', adminAuth, async function(req, res) {
  var { data } = await supabase.from('push_subscriptions').select('user_type');
  var stats = { customer: 0, driver: 0, admin: 0, total: 0 };
  (data || []).forEach(function(s) { stats[s.user_type] = (stats[s.user_type] || 0) + 1; stats.total++; });
  res.json(stats);
});

// ============================================================
// REFER & EARN
// ============================================================
app.post('/api/refer/apply', auth, async function(req, res) {
  try {
    var { refer_code } = req.body;
    var { data: referrer } = await supabase.from('customers').select('id,name,refer_count').eq('refer_code', refer_code).single();
    if (!referrer) return res.status(404).json({ error: 'Galat refer code' });
    if ((referrer.refer_count || 0) >= 60) return res.status(400).json({ error: 'Max 60 refers ho gaye' });
    await supabase.from('customers').update({ referred_by: referrer.id }).eq('id', req.user.id);
    await supabase.from('referrals').insert({ referrer_id: referrer.id, referred_id: req.user.id, reward_amount: 500, status: 'pending' });
    res.json({ success: true, message: 'Refer apply hua! Pehli ride complete hone par reward milega.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, function() {
  console.log('ASA RIDE Backend running on port ' + PORT);
});
