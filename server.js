require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Supabase client ──────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://asaride.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    /\.netlify\.app$/,
    /\.railway\.app$/
  ],
  credentials: true
}));
app.use(express.json());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// ── JWT Helper ───────────────────────────────────────────────
const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
const verify = (token) => jwt.verify(token, process.env.JWT_SECRET);

const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token required' });
    req.user = verify(token);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/', (req, res) => res.json({
  status: '✅ ASA RIDE Backend Live',
  version: '1.0.0',
  time: new Date().toISOString()
}));

// ════════════════════════════════════════════════════════════
// DRIVER ROUTES
// ════════════════════════════════════════════════════════════

// Register driver
app.post('/api/driver/register', async (req, res) => {
  try {
    const { name, phone, password, vehicle_type, city, state, imei, licence, rc } = req.body;
    if (!name || !phone || !password || !vehicle_type || !city || !imei)
      return res.status(400).json({ error: 'Sab fields required hain' });

    // Check existing
    const { data: exists } = await supabase
      .from('drivers')
      .select('id')
      .eq('phone', phone)
      .single();
    if (exists) return res.status(409).json({ error: 'Is number se driver already registered hai' });

    const hash = await bcrypt.hash(password, 10);
    const commission_map = { BIKE: 10, AUTO: 12, MINI_CAB: 15, SEDAN: 15, SUV: 15, PREMIUM: 18, ERICKSHAW: 12 };

    const { data, error } = await supabase.from('drivers').insert({
      name, phone, password_hash: hash,
      vehicle_type, city, state, imei,
      licence_no: licence, rc_no: rc,
      commission_pct: commission_map[vehicle_type] || 12,
      status: 'pending',     // pending → approved by admin
      rides_count: 0,
      launch_rides_remaining: 100,  // 0% commission first 100
      wallet_balance: 0,
      is_online: false,
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    res.json({ success: true, message: '24 hours mein approval milegi', driver_id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Driver login
app.post('/api/driver/login', async (req, res) => {
  try {
    const { phone, password, imei } = req.body;
    const { data: driver, error } = await supabase
      .from('drivers').select('*').eq('phone', phone).single();
    if (error || !driver) return res.status(401).json({ error: 'Driver nahi mila' });
    if (driver.status === 'pending') return res.status(403).json({ error: 'Account approval pending hai' });
    if (driver.imei !== imei) return res.status(403).json({ error: '🔒 IMEI mismatch — sirf registered device allowed' });
    const ok = await bcrypt.compare(password, driver.password_hash);
    if (!ok) return res.status(401).json({ error: 'Galat password' });

    const token = sign({ id: driver.id, role: 'driver', phone: driver.phone });
    const { password_hash, ...safe } = driver;
    res.json({ success: true, token, driver: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Driver go online/offline
app.post('/api/driver/status', auth, async (req, res) => {
  const { is_online, lat, lng } = req.body;
  await supabase.from('drivers').update({
    is_online, last_lat: lat, last_lng: lng,
    last_seen: new Date().toISOString()
  }).eq('id', req.user.id);
  res.json({ success: true, is_online });
});

// Driver earnings
app.get('/api/driver/earnings', auth, async (req, res) => {
  try {
    const { data: rides } = await supabase.from('rides')
      .select('*').eq('driver_id', req.user.id).eq('status', 'completed')
      .order('created_at', { ascending: false });

    const today = new Date().toDateString();
    const todayRides = rides.filter(r => new Date(r.created_at).toDateString() === today);

    res.json({
      today_earn: todayRides.reduce((s, r) => s + (r.driver_earn || 0), 0),
      today_rides: todayRides.length,
      total_earn: rides.reduce((s, r) => s + (r.driver_earn || 0), 0),
      total_rides: rides.length,
      rides: rides.slice(0, 20)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// CUSTOMER ROUTES
// ════════════════════════════════════════════════════════════

// Customer register
app.post('/api/customer/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const { data: exists } = await supabase.from('customers').select('id').eq('phone', phone).single();
    if (exists) return res.status(409).json({ error: 'Number already registered' });

    const hash = await bcrypt.hash(password, 10);
    const { data } = await supabase.from('customers').insert({
      name, phone, password_hash: hash,
      wallet_balance: 0, ride_count: 0,
      first_ride_done: false,
      created_at: new Date().toISOString()
    }).select().single();

    const token = sign({ id: data.id, role: 'customer', phone });
    res.json({ success: true, token, customer_id: data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Customer login
app.post('/api/customer/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const { data: cust } = await supabase.from('customers').select('*').eq('phone', phone).single();
    if (!cust) return res.status(401).json({ error: 'Customer nahi mila' });
    const ok = await bcrypt.compare(password, cust.password_hash);
    if (!ok) return res.status(401).json({ error: 'Galat password' });
    const token = sign({ id: cust.id, role: 'customer', phone });
    const { password_hash, ...safe } = cust;
    res.json({ success: true, token, customer: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// RIDE ROUTES
// ════════════════════════════════════════════════════════════

// Calculate fare
app.post('/api/ride/fare', async (req, res) => {
  const { vehicle_type, distance_km } = req.body;
  const rates = { BIKE: 9, AUTO: 13, MINI_CAB: 15, SEDAN: 17, SUV: 20, PREMIUM: 25, ERICKSHAW: 11 };
  const commissions = { BIKE: 10, AUTO: 12, MINI_CAB: 15, SEDAN: 15, SUV: 15, PREMIUM: 18, ERICKSHAW: 12 };
  const cancel_charge = ['MINI_CAB','SEDAN','SUV','PREMIUM'].includes(vehicle_type) ? 45 : 25;

  const rate = rates[vehicle_type] || 13;
  const dist_with_extra = distance_km + 0.02; // +20m GPS rule
  const base_fare = Math.round(rate * dist_with_extra);
  const comm_pct = commissions[vehicle_type] || 12;
  const platform_fee = Math.round(base_fare * comm_pct / 100);
  const driver_earn = base_fare - platform_fee;

  res.json({
    distance_km: dist_with_extra,
    base_fare,
    platform_fee_pct: comm_pct,
    platform_fee,
    driver_earn,
    cancel_charge,
    first_ride_discount_pct: vehicle_type.includes('CAB') ? 20 : 15,
    launch_offer: '0% commission first 100 rides'
  });
});

// Book ride
app.post('/api/ride/book', auth, async (req, res) => {
  try {
    const { pickup, drop, pickup_lat, pickup_lng, drop_lat, drop_lng, vehicle_type, distance_km, fare } = req.body;
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const { data: ride } = await supabase.from('rides').insert({
      customer_id: req.user.id,
      pickup_address: pickup, drop_address: drop,
      pickup_lat, pickup_lng, drop_lat, drop_lng,
      vehicle_type, distance_km, fare,
      otp, status: 'searching',
      created_at: new Date().toISOString()
    }).select().single();

    res.json({ success: true, ride_id: ride.id, otp, status: 'searching' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Accept ride (driver)
app.post('/api/ride/accept', auth, async (req, res) => {
  try {
    const { ride_id } = req.body;
    const { data: ride } = await supabase.from('rides').select('*').eq('id', ride_id).single();
    if (!ride || ride.status !== 'searching') return res.status(400).json({ error: 'Ride available nahi' });

    await supabase.from('rides').update({
      driver_id: req.user.id, status: 'accepted',
      accepted_at: new Date().toISOString()
    }).eq('id', ride_id);

    res.json({ success: true, otp: ride.otp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Complete ride
app.post('/api/ride/complete', auth, async (req, res) => {
  try {
    const { ride_id, otp } = req.body;
    const { data: ride } = await supabase.from('rides').select('*').eq('id', ride_id).single();
    if (!ride || ride.otp !== otp) return res.status(400).json({ error: 'Galat OTP' });

    const { data: driver } = await supabase.from('drivers').select('*').eq('id', req.user.id).single();
    const comm_pct = driver.launch_rides_remaining > 0 ? 0 : driver.commission_pct;
    const driver_earn = Math.round(ride.fare * (1 - comm_pct / 100));
    const platform_earn = ride.fare - driver_earn;

    await supabase.from('rides').update({
      status: 'completed', driver_earn, platform_earn, comm_pct_applied: comm_pct,
      completed_at: new Date().toISOString()
    }).eq('id', ride_id);

    // Update driver stats
    const newRemaining = Math.max(0, (driver.launch_rides_remaining || 0) - 1);
    await supabase.from('drivers').update({
      rides_count: (driver.rides_count || 0) + 1,
      wallet_balance: (driver.wallet_balance || 0) + driver_earn,
      launch_rides_remaining: newRemaining
    }).eq('id', req.user.id);

    res.json({
      success: true,
      driver_earn,
      commission_applied: comm_pct + '%',
      launch_rides_left: newRemaining,
      message: comm_pct === 0 ? '🎉 Launch offer! 0% commission' : `${comm_pct}% commission`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cancel ride
app.post('/api/ride/cancel', auth, async (req, res) => {
  try {
    const { ride_id, reason } = req.body;
    const { data: ride } = await supabase.from('rides').select('*').eq('id', ride_id).single();
    const cancel_charge = ['MINI_CAB','SEDAN','SUV','PREMIUM'].includes(ride?.vehicle_type) ? 45 : 25;
    const charge_applies = ride?.status === 'accepted';

    await supabase.from('rides').update({
      status: 'cancelled', cancel_reason: reason,
      cancel_charge: charge_applies ? cancel_charge : 0,
      cancelled_at: new Date().toISOString()
    }).eq('id', ride_id);

    res.json({
      success: true,
      cancel_charge: charge_applies ? cancel_charge : 0,
      message: charge_applies ? `₹${cancel_charge} cancellation charge lagega` : 'Free cancel — driver ne accept nahi kiya tha'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ════════════════════════════════════════════════════════════

const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Admin access denied' });
  next();
};

// All drivers
app.get('/api/admin/drivers', adminAuth, async (req, res) => {
  const { status, vehicle_type } = req.query;
  let q = supabase.from('drivers').select('id,name,phone,vehicle_type,city,state,status,is_online,rides_count,wallet_balance,commission_pct,launch_rides_remaining,created_at').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (vehicle_type) q = q.eq('vehicle_type', vehicle_type);
  const { data } = await q;
  res.json({ drivers: data, count: data?.length });
});

// Approve driver
app.post('/api/admin/driver/approve', adminAuth, async (req, res) => {
  const { driver_id } = req.body;
  await supabase.from('drivers').update({ status: 'approved' }).eq('id', driver_id);
  res.json({ success: true, message: 'Driver approved!' });
});

// All rides
app.get('/api/admin/rides', adminAuth, async (req, res) => {
  const { data } = await supabase.from('rides').select('*').order('created_at', { ascending: false }).limit(100);
  res.json({ rides: data, count: data?.length });
});

// Earnings summary
app.get('/api/admin/earnings', adminAuth, async (req, res) => {
  const { data: rides } = await supabase.from('rides').select('fare,driver_earn,platform_earn,comm_pct_applied,created_at').eq('status', 'completed');
  const total_fare = rides?.reduce((s, r) => s + (r.fare || 0), 0) || 0;
  const total_driver = rides?.reduce((s, r) => s + (r.driver_earn || 0), 0) || 0;
  const total_platform = rides?.reduce((s, r) => s + (r.platform_earn || 0), 0) || 0;
  res.json({ total_rides: rides?.length, total_fare, total_driver_payout: total_driver, total_platform_earn: total_platform });
});

// ════════════════════════════════════════════════════════════
// REFER & EARN
// ════════════════════════════════════════════════════════════
app.post('/api/refer/apply', auth, async (req, res) => {
  const { refer_code } = req.body;
  const { data: referrer } = await supabase.from('customers').select('id,name,refer_count').eq('refer_code', refer_code).single();
  if (!referrer) return res.status(404).json({ error: 'Galat refer code' });
  if ((referrer.refer_count || 0) >= 10) return res.status(400).json({ error: 'Max 10 refers ho gaye' });
  await supabase.from('customers').update({ referred_by: referrer.id }).eq('id', req.user.id);
  res.json({ success: true, message: 'Refer apply hua! Pehli ride complete hone par ₹500 milega' });
});

app.listen(PORT, () => console.log(`✅ ASA RIDE Backend running on port ${PORT}`));
